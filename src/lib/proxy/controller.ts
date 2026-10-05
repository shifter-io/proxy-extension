import { browser } from '#imports';
import { activeProxyItem } from '../storage';
import { chromeBypassList, isBypassed } from './bypass';

/** Everything needed to route the browser through one gateway login. */
export interface ProxyEndpoint {
  host: string;
  port: number;
  /** Full gateway username, targeting included. */
  username: string;
  password: string;
  bypassList: string[];
  webrtcProtection: boolean;
  /** Sticky session id in the username, kept when settings re-apply the same connection. */
  sid?: string;
}

export interface ExitInfo {
  ip: string;
  /** iso2, lowercase */
  country?: string;
}

/**
 * Applies / clears the browser-level proxy. Runs in the background worker
 * only. The popup never sees credentials; it asks the worker by message.
 */
/** WebRTC protection after apply: on, off by choice, or blocked by another extension / policy. */
export type WebRtcState = 'protected' | 'off' | 'unavailable';

export interface ProxyController {
  apply(endpoint: ProxyEndpoint): Promise<{ webrtc: WebRtcState }>;
  clear(): Promise<void>;
  /** Asks an IP service which address the browser now appears from. */
  checkExit(): Promise<ExitInfo>;
}


const IP_CHECK_URL = 'https://ip-info.com/json';
const IP_CHECK_TIMEOUT = 12_000;

/**
 * Live controller.
 * - Chrome: `proxy.settings` with fixed_servers (HTTP on the gateway port,
 *   even when it's 443) and the bypass list.
 * - Firefox: `proxy.onRequest` (see `routeFirefoxRequest`), since Firefox's
 *   proxy.settings needs private-browsing access and has no per-host bypass
 *   wildcards.
 * Credentials are answered in the background worker's onAuthRequired
 * handler from `activeProxyItem`; WebRTC is kept to the proxied route with
 * `privacy.network.webRTCIPHandlingPolicy`.
 */
export class BrowserProxyController implements ProxyController {
  async apply(endpoint: ProxyEndpoint): Promise<{ webrtc: WebRtcState }> {
    await activeProxyItem.setValue(endpoint);

    if (!import.meta.env.FIREFOX) {
      const current = await browser.proxy.settings.get({});
      if (current.levelOfControl === 'controlled_by_other_extensions') {
        throw new Error('Another extension controls your proxy settings. Turn it off and try again.');
      }
      if (current.levelOfControl === 'not_controllable') {
        throw new Error('Your browser policy does not allow extensions to change the proxy.');
      }
      await browser.proxy.settings.set({
        scope: 'regular',
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: { scheme: 'http', host: endpoint.host, port: endpoint.port },
            bypassList: chromeBypassList(endpoint.bypassList),
          },
        },
      });
    }

    return { webrtc: await setWebRtcPolicy(endpoint.webrtcProtection) };
  }

  async clear(): Promise<void> {
    await activeProxyItem.setValue(null);
    if (!import.meta.env.FIREFOX) {
      await browser.proxy.settings.clear({ scope: 'regular' });
    }
    await setWebRtcPolicy(false);
  }

  async checkExit(): Promise<ExitInfo> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IP_CHECK_TIMEOUT);
    try {
      const res = await fetch(IP_CHECK_URL, { cache: 'no-store', signal: ctrl.signal, credentials: 'omit' });
      if (!res.ok) throw new Error(`IP check returned ${res.status}`);
      const body = (await res.json()) as { ip?: string; country?: string };
      if (!body.ip) throw new Error('IP check returned no address');
      return { ip: body.ip, country: body.country?.toLowerCase() };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Sets (or releases) the WebRTC policy, then reads it back: the browser
 * silently ignores the change when another extension or a policy controls it.
 */
async function setWebRtcPolicy(protect: boolean): Promise<WebRtcState> {
  const policy = browser.privacy?.network?.webRTCIPHandlingPolicy;
  if (!policy) return protect ? 'unavailable' : 'off';
  try {
    if (!protect) {
      await policy.clear({});
      return 'off';
    }
    await policy.set({ value: 'disable_non_proxied_udp' });
    const now = await policy.get({});
    return now.levelOfControl === 'controlled_by_this_extension' && now.value === 'disable_non_proxied_udp'
      ? 'protected'
      : 'unavailable';
  } catch {
    return protect ? 'unavailable' : 'off';
  }
}

/** Firefox `proxy.onRequest` handler: send everything but the bypass list to the gateway. */
export async function routeFirefoxRequest(url: string) {
  const active = await activeProxyItem.getValue();
  if (!active) return { type: 'direct' };
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return { type: 'direct' };
  }
  if (isBypassed(host, active.bypassList)) return { type: 'direct' };
  // Connections are isolated by username, so a location / session / strict
  // change opens new tunnels. Known limit: Firefox still re-sends the login it
  // remembers for this gateway address on them (no extension API clears it),
  // so the new username only applies to sites first opened after the change
  // until Firefox restarts. A hostname per session on the gateway side (e.g.
  // wildcard DNS) removes this; verified with a local stand-in.
  return { type: 'http', host: active.host, port: active.port, connectionIsolationKey: active.username };
}

/** Pretends to connect; used by the mock build (`npm run build:mock`). */
export class MockProxyController implements ProxyController {
  private lastUsername = '';
  private exitIp = '';

  async apply(endpoint: ProxyEndpoint): Promise<{ webrtc: WebRtcState }> {
    this.lastUsername = endpoint.username;
    this.exitIp = '';
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return { webrtc: endpoint.webrtcProtection ? 'protected' : 'off' };
  }

  async clear(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  /** Same IP until reconnect, except rotating sessions (no sid), which change on every check. */
  async checkExit(): Promise<ExitInfo> {
    const country = /-country-([a-z]{2})/.exec(this.lastUsername)?.[1];
    const octet = () => Math.floor(Math.random() * 254) + 1;
    if (!this.exitIp || !this.lastUsername.includes('-sid-')) this.exitIp = `192.0.2.${octet()}`;
    return { ip: this.exitIp, country };
  }
}
