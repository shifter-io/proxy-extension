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
  /** "First Last", or the username when the panel has no name. */
  name?: string;
  username?: string;
  walletBalance?: number;
  currency?: string;
}

export interface Session {
  user: User;
  /** The user's panel API key (users.api_token). Sent on every API call. */
  apiKey: string;
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
  /**
   * Plan title exactly as the API returns it: "Spark", "Starter", "Pro" for
   * Residential; "25 ISP Proxies", "50 ISP Proxies", "100 ISP Proxies" for ISP.
   * Shown verbatim; the product type is shown separately as a badge.
   */
  planName: string;
  status: MembershipStatus;
  /** Panel status text ("Active, Recurring", "Canceled", "Pending Payment"…). */
  statusLabel?: string;
  /** ISO date the plan is paid until. */
  expiresAt: string;
  /** Next automatic renewal; null when the plan does not renew (one-time or cancelled). */
  renewsAt: string | null;
  /** Set while a free trial runs. */
  trialEndsAt?: string | null;
  /** Panel page for this plan (renew / manage). */
  manageUrl?: string;
}

/** Traffic allowance; `null` on a membership means unmetered (no cap to show). */
export interface Traffic {
  totalBytes: number;
  usedBytes: number;
  remainingBytes: number;
  overageBytes: number;
  /** When the allowance resets (next billing cycle). */
  resetsAt?: string | null;
  /** Extra traffic the wallet pays for when overage is billed. */
  walletCoversBytes?: number | null;
}

/** Gateway entry point ("auto" = nearest region). */
export interface EntryPoint {
  key: string;
  host: string;
  city: string | null;
  region: string;
}

export interface ResidentialMembership extends MembershipBase {
  type: 'residential';
  pool: ResidentialPool;
  /** Null when there's nothing to show: see `unmetered`. */
  traffic: Traffic | null;
  /** True only when usage says the plan has no traffic cap ("Unlimited"). A plan with no usage row yet is not unmetered. */
  unmetered: boolean;
  /** Gateway picked in the panel (proxy-config `host`), used when no entry point is chosen. */
  gatewayHost?: string;
  /** Gateway regions the customer can pin; empty when the plan isn't live yet. */
  entryPoints: EntryPoint[];
  /** False when the gateway doesn't allow sticky sessions on this plan. */
  stickySessions: boolean;
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
 * chain so selecting it produces a complete ResidentialTarget; an `asn` hit
 * with a city is a city+ISP combination.
 */
export interface GeoSearchResult {
  kind: 'country' | 'region' | 'city' | 'asn';
  country: GeoCountry;
  region?: GeoRegion;
  city?: GeoCity;
  asn?: GeoAsn;
}

// ── ISP ─────────────────────────────────────────────────────────────────

/**
 * One ISP proxy of a plan. proxy-config has no address per proxy, so the
 * exit IP is only shown while connected (from the IP check).
 */
export interface IspIp {
  /** The proxy's own gateway username (each ISP IP has one). */
  id: string;
  country: string; // iso2
  city?: string;
  asn?: number;
  isp: string; // carrier / ASN owner, e.g. "Comcast", or "AS9009" when unknown
  /** 1-based position among the plan's IPs with the same country, city and ASN ("#2"). */
  seq: number;
  /** How many IPs share that country, city and ASN; no "#n" when 1. */
  seqOf: number;
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
  /** Only the exact city / ASN, never a wider area (`-strict-true`). */
  strict: boolean;
  /** Residential gateway entry point key; null = the gateway picked in the panel. */
  entryPoint: string | null;
  /** Hostnames that always bypass the proxy. */
  bypassList: string[];
  /** Block WebRTC from leaking the real IP while connected. */
  webrtcProtection: boolean;
}

export interface ProxyCredentials {
  type: ProductType;
  /** Gateway the customer picked in the panel (HTTP, even on port 443). */
  host: string;
  port: number;
  /** Residential: base username the targeting is appended to. ISP: each IP has its own (IspIp.id). */
  username: string;
  password: string;
  /** Residential gateway regions; the chosen one replaces `host`. */
  entryPoints: EntryPoint[];
  /** False when the plan doesn't allow `sid-` sticky sessions. */
  stickySessions: boolean;
}

export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting'; membershipId: string; target: Target }
  | {
      status: 'connected';
      membershipId: string;
      target: Target;
      since: string;
      /** Exit IP from the IP check; the only place an ISP proxy's address is shown. */
      exitIp: string;
      /** iso2 of the exit, from the IP check. */
      exitCountry?: string;
      /** 'unavailable' = the toggle is on but another extension or a policy controls WebRTC. */
      webrtc?: 'protected' | 'off' | 'unavailable';
      /** Firefox: every gateway address already remembers another login; the change fully applies after a restart. */
      loginStale?: boolean;
    }
  | { status: 'error'; message: string };
