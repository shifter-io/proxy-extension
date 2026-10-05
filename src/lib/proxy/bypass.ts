/**
 * Bypass-list rules, shared by Settings (validation), Chrome (proxy.settings
 * bypassList) and Firefox (proxy.onRequest matching), so every browser treats
 * an entry the same way.
 *
 * Accepted entries:
 *   example.com        that host only
 *   *.example.com      example.com and all its subdomains
 *   192.168.1.10       one IPv4 address
 *   192.168.0.0/16     an IPv4 range (CIDR)
 */

/** Always direct: the API must stay reachable, and loopback never goes to a remote gateway. */
export const ALWAYS_BYPASS = ['localhost', '*.localhost', '127.0.0.1', '[::1]', 'shifter.io', '*.shifter.io'];

/** Private and link-local IPv4 ranges (router pages, NAS, printers…), on by default. */
export const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'];

const HOST = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Cleans what the user typed ("https://Example.com/path" -> "example.com")
 * and returns the rule, or null when it isn't one of the accepted forms.
 */
export function normalizeRule(input: string): string | null {
  let v = input.trim().toLowerCase();
  const hadScheme = /^[a-z]+:\/\//.test(v);
  v = v.replace(/^[a-z]+:\/\//, '');
  // Keep a CIDR suffix ("/16"), drop a URL path.
  const cidr = !hadScheme ? /^([\d.]+)\/(\d{1,2})$/.exec(v) : null;
  if (cidr) {
    const bits = Number(cidr[2]);
    return ipv4ToInt(cidr[1]!) !== null && bits <= 32 ? `${cidr[1]}/${bits}` : null;
  }
  v = v.replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  if (IPV4.test(v)) return ipv4ToInt(v) !== null ? v : null;
  return HOST.test(v) ? v : null;
}

/**
 * Chrome's `*.example.com` covers only subdomains, so the bare domain is
 * added too; the result matches Firefox's behaviour below.
 */
export function chromeBypassList(userRules: string[]): string[] {
  const out: string[] = [];
  for (const rule of [...ALWAYS_BYPASS, ...userRules]) {
    out.push(rule);
    if (rule.startsWith('*.')) out.push(rule.slice(2));
  }
  return [...new Set(out)];
}

/** Firefox: does `host` (a URL hostname) match `rule`? */
export function matchesRule(host: string, rule: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const r = rule.toLowerCase().replace(/^\[|\]$/g, '');
  if (r.includes('/')) {
    const [base, bits] = r.split('/');
    const ip = ipv4ToInt(h);
    const net = ipv4ToInt(base!);
    if (ip === null || net === null) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
  }
  if (r.startsWith('*.')) return h === r.slice(2) || h.endsWith(r.slice(1));
  return h === r;
}

export function isBypassed(host: string, userRules: string[]): boolean {
  return [...ALWAYS_BYPASS, ...userRules].some((rule) => matchesRule(host, rule));
}

function ipv4ToInt(ip: string): number | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}
