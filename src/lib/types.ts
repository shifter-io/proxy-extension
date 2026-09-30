/**
 * Domain models shared by the UI, the mock API and (later) the real HTTP API.
 *
 * Shapes follow the Shifter Panel where one already exists:
 * - geo lists mirror GeoDataService (countries/regions/cities/asns)
 * - residential pools mirror App\Support\ResidentialPools
 * - targeting flags mirror the endpoint builder username grammar
 *   (country-<iso2> region-<slug> city-<slug> asn-<num> sid-<id> ttl-<s>)
 */

export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface Session {
  user: User;
  /** Opaque bearer token issued by the panel once the magic link is confirmed. */
  token: string;
  createdAt: string;
}

// ── Memberships ─────────────────────────────────────────────────────────

export type ProductType = 'residential' | 'isp';

/** Residential pool, see ResidentialPools in the panel. */
export type ResidentialPool = 'full' | 'country' | 'non-geo';

export type MembershipStatus = 'active' | 'expiring' | 'expired' | 'suspended';

interface MembershipBase {
  id: string;
  type: ProductType;
  /** Product title as shown in the panel, e.g. "Residential Proxies · Pro 50 GB". */
  planName: string;
  status: MembershipStatus;
  /** ISO date. */
  expiresAt: string;
  autoRenew: boolean;
}

export interface ResidentialMembership extends MembershipBase {
  type: 'residential';
  pool: ResidentialPool;
  trafficTotalBytes: number;
  trafficUsedBytes: number;
}

export interface IspMembership extends MembershipBase {
  type: 'isp';
  /** ISP is unlimited bandwidth; targeting = pick one of the assigned static IPs. */
  ipCount: number;
  countries: string[]; // iso2, lowercase
}

export type Membership = ResidentialMembership | IspMembership;

// ── Geo catalog (residential) ───────────────────────────────────────────

export interface GeoCountry {
  code: string; // iso2, lowercase
  name: string;
}

export interface GeoRegion {
  slug: string;
  name: string;
}

export interface GeoCity {
  slug: string;
  name: string;
  regionSlug?: string;
}

export interface GeoAsn {
  asn: number;
  name: string;
}

/**
 * One hit from the cross-level location search. Carries the full parent
 * chain so selecting it produces a complete ResidentialTarget.
 * Proposed panel endpoint: GET /geo/search?q=<query>
 */
export interface GeoSearchResult {
  kind: 'country' | 'region' | 'city' | 'asn';
  country: GeoCountry;
  region?: GeoRegion;
  city?: GeoCity;
  asn?: GeoAsn;
}

// ── ISP ─────────────────────────────────────────────────────────────────

export interface IspIp {
  id: string;
  ip: string;
  country: string; // iso2
  city?: string;
  isp: string; // carrier / ASN owner, e.g. "Comcast"
}

// ── Targeting / connection ──────────────────────────────────────────────

/** A residential target. Every level below country is optional. */
export interface ResidentialTarget {
  kind: 'residential';
  country?: GeoCountry; // undefined = random worldwide
  region?: GeoRegion;
  city?: GeoCity;
  asn?: GeoAsn;
}

export interface IspTarget {
  kind: 'isp';
  ip: IspIp;
}

export type Target = ResidentialTarget | IspTarget;

export type SessionMode = 'sticky' | 'rotating';

export interface ProxySettings {
  sessionMode: SessionMode;
  /** Sticky session lifetime in seconds (gateway `ttl-` flag). */
  ttlSeconds: number;
  /** Fail instead of widening the location when the exact target is unavailable. */
  strict: boolean;
  /** Hostnames that always bypass the proxy. */
  bypassList: string[];
  /** Block WebRTC from leaking the real IP while connected. */
  webrtcProtection: boolean;
}

export interface ProxyCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting'; membershipId: string; target: Target }
  | {
      status: 'connected';
      membershipId: string;
      target: Target;
      since: string;
      /** Exit IP as reported by the gateway / an IP check. */
      exitIp: string;
    }
  | { status: 'error'; message: string };

// ── Auth flow ───────────────────────────────────────────────────────────

/** Mirrors the `flow` values returned by the panel's POST /login/check. */
export type LoginCheckFlow =
  | 'magic_link_sent'
  | 'rate_limited'
  | 'undeliverable_email'
  | 'invalid_email';

export interface LoginCheckResult {
  flow: LoginCheckFlow;
  /** Handle used to poll the confirmation status. */
  requestId?: string;
  newAccount?: boolean;
}

/** Mirrors GET /login/magic/status. */
export type MagicLinkStatus =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'confirmed'; session: Session };
