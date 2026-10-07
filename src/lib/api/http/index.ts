import { browser, storage } from '#imports';
import type {
  EntryPoint,
  GeoAsn,
  GeoCity,
  GeoCountry,
  GeoRegion,
  GeoSearchResult,
  IspIp,
  Membership,
  MembershipStatus,
  ProxyCredentials,
  ResidentialPool,
  Session,
  Traffic,
  User,
} from '../../types';
import { numberIspIps } from '../../format';
import { geoCatalog } from '../../geo/catalog';
import { ApiError, type ShifterApi } from '../types';
import type {
  Envelope,
  WireIspPlan,
  WireMe,
  WireMembership,
  WireMemberships,
  WirePlan,
  WireProxyConfig,
  WireUsage,
  WireUsageMembership,
} from './wire';

export const SHIFTER_BASE_URL = 'https://shifter.io';

const DAY = 86_400_000;
/** proxy-config is reused between the plan list, the ISP picker and connect. */
const PROXY_CONFIG_TTL = 60_000;
/** A plan with no renewal that ends within this window shows as "Expiring soon". */
const EXPIRING_WINDOW = 3 * DAY;

/**
 * Live backend: the Shifter API documented in shifter_docs/.
 *
 * - `/api/v1/user/*` take the key as `Authorization: Bearer`, and wrap
 *   bodies in `{ error, code, data }`.
 * - Locations come from the bundled catalog (lib/geo), built from the
 *   gateway's inventory. The geo endpoints (`X-Api-Key`, plain arrays, day
 *   cache) are only used to name ISP carriers the catalog doesn't know.
 * - Any 401 surfaces as ApiError('unauthorized'); the app signs out.
 */
export class HttpShifterApi implements ShifterApi {
  private apiKey: string | null = null;
  private proxyConfigCache: { at: number; key: string; value: Promise<WireProxyConfig> } | null = null;

  constructor(private readonly baseUrl = SHIFTER_BASE_URL) {}

  useSession(session: Session | null): void {
    if (session?.apiKey !== this.apiKey) this.proxyConfigCache = null;
    this.apiKey = session?.apiKey ?? null;
  }

  async verifyApiKey(apiKey: string): Promise<Session> {
    const key = apiKey.trim();
    const me = await this.user<WireMe>('/api/v1/user/me', key);
    this.useSession({ user: toUser(me), apiKey: key, createdAt: '' });
    return { user: toUser(me), apiKey: key, createdAt: new Date().toISOString() };
  }

  async signOut(): Promise<void> {
    // Nothing to revoke server-side: the key stays valid in the panel.
    this.useSession(null);
  }

  async me(): Promise<User> {
    return toUser(await this.user<WireMe>('/api/v1/user/me'));
  }

  async memberships(): Promise<Membership[]> {
    const [plans, usage, config] = await Promise.all([
      this.user<WireMemberships>('/api/v1/user/memberships'),
      this.user<WireUsage>('/api/v1/user/usage'),
      this.proxyConfig(true),
    ]);
    const usageById = new Map((usage.memberships ?? []).map((u) => [u.id, u]));
    const liveByHash = new Map(config.plans.map((p) => [p.hash, p]));

    return Object.entries(plans ?? {})
      .map(([hash, m]) => toMembership(hash, m, liveByHash.get(hash), usageById.get(hash), this.baseUrl))
      .filter((m): m is Membership => m !== null);
  }

  // ── Locations: the bundled catalog (lib/geo), not the geo endpoints ──

  countries(): Promise<GeoCountry[]> {
    return geoCatalog.countries();
  }

  regions(country: string): Promise<GeoRegion[]> {
    return geoCatalog.regions(country);
  }

  cities(country: string, region?: string): Promise<GeoCity[]> {
    return geoCatalog.cities(country, region);
  }

  asns(country: string, city?: GeoCity): Promise<GeoAsn[]> {
    return geoCatalog.asns(country, city);
  }

  searchGeo(query: string): Promise<GeoSearchResult[]> {
    return geoCatalog.search(query);
  }

  // ── ISP + gateway ───────────────────────────────────────────────────

  async ispIps(membershipId: string): Promise<IspIp[]> {
    const plan = (await this.proxyConfig()).plans.find((p): p is WireIspPlan => p.hash === membershipId && p.type === 'isp');
    if (!plan) return [];
    // proxy-config has the ASN number only. Names come from the catalog, else
    // from the country's ASN list on the geo API (day cache).
    const names = new Map<number, string>();
    const missing = new Set<string>();
    for (const p of plan.proxies) {
      if (!p.asn || names.has(p.asn)) continue;
      const name = await geoCatalog.asnName(p.asn);
      if (name) names.set(p.asn, name);
      else missing.add(p.country.toLowerCase());
    }
    await Promise.all(
      [...missing].map(async (country) => {
        const list = await this.geo<GeoAsn[]>('asns', { country }).catch(() => []);
        for (const a of list) if (!names.has(a.asn)) names.set(a.asn, a.name);
      }),
    );
    return numberIspIps(
      plan.proxies.map((p) => ({
        id: p.username,
        country: p.country.toLowerCase(),
        city: p.city ?? undefined,
        asn: p.asn ?? undefined,
        isp: (p.asn && names.get(p.asn)) || (p.asn ? `AS${p.asn}` : 'ISP proxy'),
      })),
    );
  }

  async credentials(membershipId: string): Promise<ProxyCredentials> {
    const plan = (await this.proxyConfig(true)).plans.find((p) => p.hash === membershipId);
    if (!plan) throw new ApiError('This plan is not active on the gateway yet.', 'validation');
    if (plan.protocol && plan.protocol.toLowerCase() !== 'http') {
      throw new ApiError(`This plan uses ${plan.protocol.toUpperCase()}, which the browser can't authenticate.`, 'validation');
    }
    return {
      type: plan.type,
      host: plan.host,
      port: plan.port,
      username: plan.type === 'residential' ? plan.username : '',
      password: plan.password,
      entryPoints: plan.type === 'residential' ? (plan.entry_points ?? []).map(toEntryPoint) : [],
      stickySessions: plan.type === 'residential' ? (plan.targeting?.sticky_session ?? true) : false,
    };
  }

  // ── Transport ───────────────────────────────────────────────────────

  private proxyConfig(fresh = false): Promise<WireProxyConfig> {
    const key = this.apiKey ?? '';
    const c = this.proxyConfigCache;
    if (!fresh && c && c.key === key && Date.now() - c.at < PROXY_CONFIG_TTL) return c.value;
    const value = this.user<WireProxyConfig>('/api/v1/user/proxy-config').then((d) => ({ plans: d?.plans ?? [] }));
    this.proxyConfigCache = { at: Date.now(), key, value };
    value.catch(() => {
      if (this.proxyConfigCache?.value === value) this.proxyConfigCache = null;
    });
    return value;
  }

  private async user<T>(path: string, key = this.apiKey): Promise<T> {
    if (!key) throw new ApiError('Not signed in', 'unauthorized');
    const body = await this.request<Envelope<T>>(path, { Authorization: `Bearer ${key}` });
    if (body.error) throw new ApiError(body.error, body.code === 401 ? 'unauthorized' : 'server');
    return body.data;
  }

  private async geo<T>(kind: string, params: Record<string, string>): Promise<T> {
    const key = this.apiKey;
    if (!key) throw new ApiError('Not signed in', 'unauthorized');
    const qs = new URLSearchParams(params).toString();
    const path = `/api/v1/residential/geo/${kind}${qs ? `?${qs}` : ''}`;
    const cacheKey = `local:geo:${kind}:${qs}` as const;

    const cached = await storage.getItem<{ at: number; data: T }>(cacheKey);
    if (cached && Date.now() - cached.at < DAY) return cached.data;
    try {
      const data = await this.request<T>(path, { 'X-Api-Key': key });
      await storage.setItem(cacheKey, { at: Date.now(), data });
      return data;
    } catch (err) {
      // A stale list beats an empty picker when the API is briefly down.
      if (cached && !(err instanceof ApiError && err.code === 'unauthorized')) return cached.data;
      throw err;
    }
  }

  private async request<T>(path: string, headers: Record<string, string>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, { headers: { Accept: 'application/json', ...headers } });
    } catch {
      throw new ApiError(await unreachableReason(this.baseUrl), 'network');
    }
    if (res.status === 401) throw new ApiError('Invalid API key', 'unauthorized');
    if (res.status === 429) throw new ApiError('Too many requests. Wait a minute and try again.', 'rate_limited');
    if (!res.ok) throw new ApiError(`Shifter returned ${res.status}. Try again later.`, 'server');
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError('Unexpected response from Shifter.', 'server');
    }
  }
}

/**
 * fetch() only says "failed". Tell apart the cases a customer can fix:
 * no host access to shifter.io (a stale unpacked build, or the popup opened
 * as a normal page, where CORS blocks the API) vs. being offline.
 */
async function unreachableReason(baseUrl: string): Promise<string> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return "You're offline. Check your connection and try again.";
  }
  const granted = await browser.permissions?.contains({ origins: [`${baseUrl}/*`] }).catch(() => false);
  if (!granted) return 'The extension has no access to shifter.io. Reload it in your browser’s extensions page.';
  return "Couldn't reach Shifter. Check your connection and try again.";
}

// ── Mapping ─────────────────────────────────────────────────────────────

function toUser(me: WireMe): User {
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ').trim();
  return {
    id: String(me.user_id),
    email: me.email,
    name: name || me.username,
    username: me.username,
    walletBalance: me.wallet_balance,
    currency: me.currency || 'USD',
  };
}

function toEntryPoint(e: { key: string; host: string; city: string | null; region: string }): EntryPoint {
  return { key: e.key, host: e.host, city: e.city, region: e.region };
}

const POOLS: ResidentialPool[] = ['full', 'country', 'non-geo'];

/**
 * Only the current product lines. Legacy plans are left out: "Static
 * Residential Proxies" (pinned-IP ISP, service static-residential-proxies)
 * has no login in proxy-config, and Special Backconnect is another product.
 */
function productType(m: WireMembership, live: WirePlan | undefined): Membership['type'] | null {
  if (live) return live.type;
  if (m.service === 'static-residential-proxies') return null;
  if (m.pool || /^residential/i.test(m.category)) return 'residential';
  if (/^isp/i.test(m.category)) return 'isp';
  return null; // other product lines can't be used from the browser
}

/**
 * Joins one `/user/memberships` entry with its `/user/usage` row and its
 * `/user/proxy-config` plan (by hash). Returns null for plans the extension
 * can't use or show (other products, and cancelled plans that have ended).
 */
function toMembership(
  hash: string,
  m: WireMembership,
  live: WirePlan | undefined,
  usage: WireUsageMembership | undefined,
  baseUrl: string,
): Membership | null {
  const type = productType(m, live);
  if (!type) return null;
  const ended = new Date(m.expires_at).getTime() <= Date.now();
  if (m.canceled_at && ended) return null;

  const base = {
    id: hash,
    planName: m.product || live?.product || m.name,
    status: statusOf(m, !!live, ended),
    statusLabel: m.status,
    expiresAt: m.expires_at,
    renewsAt: m.renews_at,
    trialEndsAt: m.trial_ends_at,
    // Panel page: /panel/membership/{hash} (MembershipController@view). `uri` is an API path.
    manageUrl: `${baseUrl}/panel/membership/${hash}`,
  };

  if (type === 'isp') {
    const proxies = live?.type === 'isp' ? live.proxies : [];
    return {
      ...base,
      type: 'isp',
      ipCount: proxies.length,
      countries: [...new Set(proxies.map((p) => p.country.toLowerCase()))],
    };
  }

  const res = live?.type === 'residential' ? live : undefined;
  const pool = [m.pool, res?.pool].find((p): p is ResidentialPool => !!p && POOLS.includes(p)) ?? 'full';
  return {
    ...base,
    type: 'residential',
    pool,
    traffic: residentialTraffic(usage),
    gatewayHost: res?.host,
    entryPoints: (res?.entry_points ?? []).map(toEntryPoint),
    stickySessions: res?.targeting?.sticky_session ?? true,
  };
}

function residentialTraffic(usage?: WireUsageMembership): Traffic | null {
  if (!usage) return null;
  const { quota_bytes: quota, used_bytes: used, remaining_bytes: remaining } = usage;
  // Residential plans have an allowance even if the API mislabels them as
  // unmetered. Use the supplied figures; missing usage is not zero usage.
  if (typeof quota !== 'number' || (typeof used !== 'number' && typeof remaining !== 'number')) return null;
  return {
    totalBytes: quota,
    usedBytes: used ?? Math.max(0, quota - remaining!),
    remainingBytes: remaining ?? Math.max(0, quota - used!),
    overageBytes: usage.overage_bytes ?? 0,
    resetsAt: usage.resets_at,
    walletCoversBytes: usage.overage_billed && usage.wallet_covers_gb != null ? usage.wallet_covers_gb * 1e9 : null,
  };
}

/**
 * Usable = listed in proxy-config (live on the gateway) and not past
 * `expires_at`. A cancelled plan keeps working until then, so it reads as
 * "expiring"; unpaid / not-yet-active plans read as "suspended".
 */
function statusOf(m: WireMembership, live: boolean, ended: boolean): MembershipStatus {
  if (ended) return 'expired';
  if (!live) return 'suspended';
  const endsSoon = !m.renews_at && new Date(m.expires_at).getTime() - Date.now() < EXPIRING_WINDOW;
  if (m.canceled_at || m.color === 'warning' || endsSoon) return 'expiring';
  return 'active';
}
