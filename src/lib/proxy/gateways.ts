import { storage } from '#imports';
import type { EntryPoint } from '../types';

/**
 * Gateway addresses and latency.
 *
 * Every residential entry point (p.shifter.io = nearest by DNS, plus
 * fra/ams/lon/nyc/tor/sgp/blr/syd.p.shifter.io) is the same gateway on
 * ports 443, 80 and 8080, with the same login. The extension pings them
 * hourly and when the browser starts, so it knows which are closest.
 *
 * Browsers remember the proxy login per gateway address and
 * re-sends it on new connections without asking the extension, and no
 * extension API clears that memory. So a new username (location, New IP,
 * strict, session) must go to an address whose remembered login is exactly
 * that username, or to one Firefox hasn't logged in to yet. `pickAddress`
 * does that, nearest addresses first; `rememberLogin` records what the browser
 * remembers (from the logins we answer). Browsers forget on restart, and so
 * does this record (`forgetLogins` on runtime.onStartup).
 */

/** Ports every residential entry point answers on (test builds may override). */
export const GATEWAY_PORTS: number[] = String(import.meta.env.WXT_GATEWAY_PORTS || '443,80,8080')
  .split(',')
  .map(Number);

export interface GatewayAddress {
  host: string;
  port: number;
}

const key = (a: GatewayAddress) => `${a.host.toLowerCase()}:${a.port}`;

/** Round-trip time per hostname, in ms (lower = closer). */
export const gatewayLatencyItem = storage.defineItem<{ at: number; ms: Record<string, number> } | null>(
  'local:gatewayLatency',
  { fallback: null },
);

/** Entry point hosts seen in proxy-config, so the hourly ping works without the API. */
export const gatewayHostsItem = storage.defineItem<string[]>('local:gatewayHosts', { fallback: [] });

/** address -> the username the browser remembers for it (since the browser started). */
export const rememberedLoginsItem = storage.defineItem<Record<string, { username: string; at: number }>>(
  'local:rememberedLogins',
  { fallback: {} },
);

const PING_TIMEOUT = 4000;

/**
 * Round trip to the gateway, direct (*.shifter.io is always bypassed). The
 * gateway answers a plain request with 407 at once; Firefox hands that back,
 * Chrome turns it into a network error after the same round trip, so both
 * count. Only a timeout means unreachable. The first request warms up DNS;
 * the result is the best of the next two.
 */
async function pingHost(host: string): Promise<number | null> {
  let best: number | null = null;
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT);
    const t0 = performance.now();
    let ms: number | null = null;
    try {
      await fetch(`http://${host}:${GATEWAY_PORTS[0]}/?ping=${Date.now()}`, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
      ms = performance.now() - t0;
    } catch {
      ms = ctrl.signal.aborted ? null : performance.now() - t0;
    } finally {
      clearTimeout(timer);
    }
    if (ms === null) return best; // unreachable: stop trying
    if (i > 0) best = best === null ? Math.round(ms) : Math.min(best, Math.round(ms));
  }
  return best;
}

export async function measureGateways(hosts?: string[]): Promise<void> {
  const list = [...new Set(hosts ?? (await gatewayHostsItem.getValue()))];
  if (!list.length) return;
  const results = await Promise.all(list.map(async (h) => [h, await pingHost(h)] as const));
  const ms: Record<string, number> = {};
  for (const [h, v] of results) if (v !== null) ms[h] = v;
  await gatewayLatencyItem.setValue({ at: Date.now(), ms });
}

/**
 * Addresses to use, nearest first. A pinned entry point limits the pool to
 * that host; "Plan default" puts the plan's host first, then every entry
 * point by latency.
 */
export function addressPool(
  planHost: string,
  planPort: number,
  entryPoints: EntryPoint[],
  pinned: string | undefined,
  latency: Record<string, number> = {},
): GatewayAddress[] {
  const hosts = pinned
    ? [pinned]
    : [planHost, ...entryPoints.map((e) => e.host).filter((h) => h !== planHost)].sort((a, b) => {
        if (a === planHost || b === planHost) return a === planHost ? -1 : 1;
        return (latency[a] ?? 1e6) - (latency[b] ?? 1e6);
      });
  // Entry points answer on all gateway ports; a plan without entry points only on its own port.
  const ports = entryPoints.length ? [planPort, ...GATEWAY_PORTS.filter((p) => p !== planPort)] : [planPort];
  const out: GatewayAddress[] = [];
  for (const port of ports) for (const host of hosts) out.push({ host, port });
  return out;
}

/**
 * The address to use for `username`: one the browser already remembers
 * exactly this username for, else the nearest one it has no login for.
 * `fresh: false` means every address remembers another username; then the
 * oldest is used and the new username may not apply until a browser restart.
 */
export async function pickAddress(pool: GatewayAddress[], username: string): Promise<{ address: GatewayAddress; fresh: boolean }> {
  const remembered = await rememberedLoginsItem.getValue();
  const same = pool.find((a) => remembered[key(a)]?.username === username);
  if (same) return { address: same, fresh: true };
  const unused = pool.find((a) => !remembered[key(a)]);
  if (unused) return { address: unused, fresh: true };
  const oldest = [...pool].sort((a, b) => remembered[key(a)]!.at - remembered[key(b)]!.at)[0]!;
  return { address: oldest, fresh: false };
}

/** Logins are answered in bursts (one per new connection): write the record one at a time. */
let writes: Promise<unknown> = Promise.resolve();

/** Called when we answer a proxy login: the browser now remembers `username` for this address. */
export function rememberLogin(address: GatewayAddress, username: string): Promise<void> {
  const next = writes.then(async () => {
    const remembered = await rememberedLoginsItem.getValue();
    if (remembered[key(address)]?.username === username) return;
    await rememberedLoginsItem.setValue({ ...remembered, [key(address)]: { username, at: Date.now() } });
  });
  writes = next.catch(() => undefined);
  return next;
}

export async function forgetLogins(): Promise<void> {
  await rememberedLoginsItem.setValue({});
}
