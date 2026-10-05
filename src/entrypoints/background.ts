import { api, ApiError, USE_MOCK } from '@/lib/api';
import {
  BrowserProxyController,
  MockProxyController,
  routeFirefoxRequest,
  type ProxyController,
  type ProxyEndpoint,
} from '@/lib/proxy/controller';
import { isProxyMessage, type ProxyMessage, type ProxyReply } from '@/lib/proxy/messages';
import {
  addressPool,
  forgetLogins,
  gatewayHostsItem,
  gatewayLatencyItem,
  measureGateways,
  pickAddress,
  rememberLogin,
} from '@/lib/proxy/gateways';
import { buildResidentialUsername, newSid } from '@/lib/proxy/username';
import {
  activeProxyItem,
  connectionItem,
  sessionItem,
  settingsItem,
  withDefaults,
} from '@/lib/storage';
import type { ConnectionState, ProxyCredentials, ProxySettings, Target } from '@/lib/types';
import { watchToolbarConnection } from '@/lib/toolbar';

const controller: ProxyController = USE_MOCK ? new MockProxyController() : new BrowserProxyController();

/**
 * Proxy auth challenges already answered, keyed by request id + URL, with
 * the username we sent. The browser keeps the request id across redirects
 * and http→https upgrades (each may ask again legitimately); the same URL
 * asking again for the same username means the gateway rejected it.
 */
const answered = new Map<string, string>();
const REJECTED = 'Shifter rejected the proxy login. Check your plan is active and has traffic left.';
/** Set when the gateway rejects the login; read by connect() to explain a failed IP check. */
let loginRejected = false;

/** Serializes connect/disconnect so quick taps can't interleave. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

function handle(message: ProxyMessage): Promise<ProxyReply> {
  if (message.type === 'proxy:check') return recheckExit().then(() => ({ ok: true }) as const);
  return serial(() => (message.type === 'proxy:disconnect' ? disconnect() : connect(message.membershipId, message.target)));
}

// ── Exit-IP watch ───────────────────────────────────────────────────────
// Residential exits can change under the same session (the peer goes away,
// a rotating session gets a new IP per request), so while connected the
// exit is re-checked every 15 s and the shown IP / flag follow it.

const EXIT_CHECK_MS = 15_000;
let exitTimer: ReturnType<typeof setInterval> | null = null;
let checking = false;

function watchExit(on: boolean) {
  if (on && !exitTimer) exitTimer = setInterval(() => void recheckExit(), EXIT_CHECK_MS);
  if (!on && exitTimer) {
    clearInterval(exitTimer);
    exitTimer = null;
  }
}

async function recheckExit() {
  if (checking) return;
  checking = true;
  try {
    const before = await connectionItem.getValue();
    if (before.status !== 'connected') return watchExit(false);
    watchExit(true);
    // A failed check keeps the last IP: one slow response isn't a dead connection.
    const exit = await controller.checkExit().catch(() => null);
    if (!exit) return;
    const now = await connectionItem.getValue();
    // Only if nothing changed meanwhile (a reconnect or disconnect wins).
    if (now.status !== 'connected' || now.since !== before.since) return;
    if (now.exitIp === exit.ip && now.exitCountry === exit.country) return;
    await connectionItem.setValue({ ...now, exitIp: exit.ip, exitCountry: exit.country ?? now.exitCountry });
  } finally {
    checking = false;
  }
}

async function disconnect(): Promise<ProxyReply> {
  await controller.clear().catch(() => undefined);
  await connectionItem.setValue({ status: 'disconnected' });
  return { ok: true };
}

/**
 * Connects (or re-connects) to `target`. A fresh sticky session id means a
 * fresh exit IP; `keepSid` re-applies the same session after a settings
 * change.
 */
async function connect(membershipId: string, target: Target, keepSid = false): Promise<ProxyReply> {
  const previous = await activeProxyItem.getValue();
  await connectionItem.setValue({ status: 'connecting', membershipId, target });
  try {
    api.useSession(await sessionItem.getValue());
    const [credentials, settings] = await Promise.all([api.credentials(membershipId), settingsItem.getValue().then(withDefaults)]);
    const sid = keepSid && previous?.sid ? previous.sid : newSid();
    const endpoint = toEndpoint(credentials, target, settings, sid);
    const loginStale = await chooseAddress(endpoint, credentials, target, settings);

    answered.clear();
    loginRejected = false;
    const { webrtc } = await controller.apply(endpoint);
    const exit = await controller.checkExit().catch(() => null);
    if (!exit) {
      await controller.clear();
      throw new Error(
        loginRejected
          ? REJECTED
          : target.kind === 'residential' && target.country
          ? 'No IP is available for this location right now. Try a wider area.'
          : 'The Shifter gateway did not respond. Check your plan has traffic left.',
      );
    }

    await connectionItem.setValue({
      status: 'connected',
      membershipId,
      target,
      exitIp: exit.ip,
      exitCountry: exit.country,
      webrtc,
      loginStale,
      since: new Date().toISOString(),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'unauthorized') {
      // The key was revoked or regenerated: sign out (the watcher below clears the proxy).
      await sessionItem.setValue(null);
    }
    // A failed switch must not leave a half-applied proxy behind.
    await controller.clear().catch(() => undefined);
    const error = err instanceof Error ? err.message : 'Could not connect';
    await connectionItem.setValue({ status: 'error', message: error });
    return { ok: false, error };
  }
}

/**
 * Send this username to a gateway address whose remembered
 * login is exactly this username, or that has none yet (see lib/proxy/gateways).
 * Returns true for Firefox when every address remembers another username,
 * preserving its restart warning. Chromium refuses stale credentials.
 */
async function chooseAddress(endpoint: ProxyEndpoint, c: ProxyCredentials, target: Target, settings: ProxySettings) {
  const entryPoints = target.kind === 'residential' ? c.entryPoints : [];
  void gatewayHostsItem.setValue([...new Set([c.host, ...entryPoints.map((e) => e.host)])]);
  void refreshLatencyIfOld();
  const pinned = settings.entryPoint ? entryPoints.find((e) => e.key === settings.entryPoint)?.host : undefined;
  const latency = (await gatewayLatencyItem.getValue())?.ms;
  const pool = addressPool(c.host, c.port, entryPoints, pinned, latency);
  const { address, fresh } = await pickAddress(pool, endpoint.username);
  if (!fresh && !import.meta.env.FIREFOX) {
    throw new Error(
      'Restart your browser to change the proxy location or session: all available gateway addresses have cached credentials.',
    );
  }
  endpoint.host = address.host;
  endpoint.port = address.port;
  return !fresh;
}

const HOUR = 3_600_000;
async function refreshLatencyIfOld() {
  const last = await gatewayLatencyItem.getValue();
  if (!last || Date.now() - last.at > HOUR) await measureGateways().catch(() => undefined);
}

function toEndpoint(c: ProxyCredentials, target: Target, settings: ProxySettings, sid: string): ProxyEndpoint {
  const shared = { port: c.port, password: c.password, bypassList: settings.bypassList, webrtcProtection: settings.webrtcProtection };
  if (target.kind === 'isp') {
    // Each ISP IP has its own username on the plan's host.
    return { ...shared, host: c.host, username: target.ip.id };
  }
  const entry = settings.entryPoint ? c.entryPoints.find((e) => e.key === settings.entryPoint) : undefined;
  const sticky = settings.sessionMode === 'sticky' && c.stickySessions;
  return {
    ...shared,
    host: entry?.host ?? c.host,
    username: buildResidentialUsername(c.username, target, { ...settings, sessionMode: sticky ? 'sticky' : 'rotating' }, sid),
    sid: sticky ? sid : undefined,
  };
}

/** Answers the gateway's 407 with the stored login; a second challenge for the same request means it was rejected. */
async function answerAuth(details: {
  requestId: string;
  url: string;
  isProxy: boolean;
  challenger?: { host: string; port: number };
}) {
  if (!details.isProxy) return {};
  const active = await activeProxyItem.getValue();
  if (!active) return {};
  const key = `${details.requestId} ${details.url}`;
  if (answered.get(key) === active.username) {
    loginRejected = true;
    void markRejected();
    return { cancel: true };
  }
  if (answered.size > 1000) answered.clear();
  answered.set(key, active.username);
  // The browser will now remember this login for the gateway address it asked from.
  if (details.challenger) await rememberLogin(details.challenger, active.username);
  return { authCredentials: { username: active.username, password: active.password } };
}

let rejecting = false;
async function markRejected() {
  if (rejecting) return;
  rejecting = true;
  try {
    const c = await connectionItem.getValue();
    if (c.status !== 'connected') return;
    await controller.clear();
    await connectionItem.setValue({ status: 'error', message: REJECTED });
  } finally {
    rejecting = false;
  }
}

/** Firefox-only `proxy.onRequest`, missing from the Chrome-based typings. */
interface FirefoxProxy {
  onRequest: {
    addListener(listener: (details: { url: string }) => Promise<object>, filter: { urls: string[] }): void;
  };
}

export default defineBackground(() => {
  watchToolbarConnection();

  // Listeners are registered synchronously so a restarted service worker
  // still answers proxy logins.
  if (import.meta.env.FIREFOX) {
    // Firefox: blocking listeners may return a Promise; routing is per request.
    browser.webRequest.onAuthRequired.addListener(
      (details) => answerAuth(details) as never,
      { urls: ['<all_urls>'] },
      ['blocking'],
    );
    (browser.proxy as unknown as FirefoxProxy).onRequest.addListener((details) => routeFirefoxRequest(details.url), {
      urls: ['<all_urls>'],
    });
  } else {
    // Chrome MV3: async answers go through the callback.
    browser.webRequest.onAuthRequired.addListener(
      (details, callback) => {
        answerAuth(details).then(
          (r) => callback?.(r),
          () => callback?.({}),
        );
      },
      { urls: ['<all_urls>'] },
      ['asyncBlocking'],
    );
  }

  // Gateway latency: hourly (the user may travel) and at browser start,
  // which is also when the browser forgets remembered proxy logins.
  browser.alarms.create('gateway-ping', { periodInMinutes: 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'gateway-ping') void measureGateways().catch(() => undefined);
  });
  browser.runtime.onStartup.addListener(() => {
    void forgetLogins().then(() => measureGateways().catch(() => undefined));
  });

  // End-to-end test builds only (WXT_SHIFTER_BASE_URL set; stripped from real
  // builds): open the popup in a tab, since Firefox automation can't navigate
  // to extension pages itself.
  if (import.meta.env.WXT_SHIFTER_BASE_URL) {
    browser.runtime.onInstalled.addListener(() => void browser.tabs.create({ url: browser.runtime.getURL('/popup.html') }));
  }

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isProxyMessage(message)) return;
    handle(message).then(sendResponse);
    return true; // keep the channel open for the async reply
  });

  // A worker that died mid-connect, or a browser restart after an error,
  // must not leave a stale proxy applied.
  void connectionItem.getValue().then((c: ConnectionState) => {
    if (c.status === 'connecting') void serial(disconnect);
    if (c.status === 'error' || c.status === 'disconnected') void controller.clear().catch(() => undefined);
  });

  // Start / stop the 15 s exit check with the connection. A restarted
  // worker picks it up here too, and when the popup opens (proxy:check).
  connectionItem.watch((c) => watchExit(c?.status === 'connected'));
  void connectionItem.getValue().then((c) => watchExit(c.status === 'connected'));

  // Signing out anywhere tears the proxy down.
  sessionItem.watch((session) => {
    if (!session) void handle({ type: 'proxy:disconnect' });
  });

  // Session, TTL, strict, entry point, bypass list and WebRTC apply live.
  settingsItem.watch(() => {
    void serial(async () => {
      const c = await connectionItem.getValue();
      if (c.status === 'connected') await connect(c.membershipId, c.target, true);
    });
  });
});
