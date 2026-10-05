import type {
  GeoAsn,
  GeoCity,
  GeoCountry,
  GeoRegion,
  GeoSearchResult,
  IspIp,
  Membership,
  ProxyCredentials,
  Session,
  User,
} from '../types';

/**
 * The contract the UI talks to. Today it is backed by `MockShifterApi`;
 * the API phase adds an HTTP implementation against the panel and swaps it
 * in `api/index.ts` without touching any screen.
 */
export interface ShifterApi {
  /** Attach (or clear) the signed-in session; the HTTP client sends its API key. */
  useSession(session: Session | null): void;

  // Auth: the user pastes their panel API key; it is verified instantly.
  /** Resolves with a session for a valid key, rejects with ApiError('unauthorized') otherwise. */
  verifyApiKey(apiKey: string): Promise<Session>;
  signOut(): Promise<void>;

  // Account
  me(): Promise<User>;
  memberships(): Promise<Membership[]>;

  // Residential locations (bundled catalog built from the gateway inventory, lib/geo)
  countries(): Promise<GeoCountry[]>;
  regions(country: string): Promise<GeoRegion[]>;
  cities(country: string, region?: string): Promise<GeoCity[]>;
  /** ISPs in the country, or only those with enough IPs in `city`. */
  asns(country: string, city?: GeoCity): Promise<GeoAsn[]>;
  /** Search countries, states, cities, ISPs and city+ISP combinations in one go. */
  searchGeo(query: string): Promise<GeoSearchResult[]>;

  // ISP
  ispIps(membershipId: string): Promise<IspIp[]>;

  // Gateway credentials for a membership (never logged, never rendered)
  credentials(membershipId: string): Promise<ProxyCredentials>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: 'unauthorized' | 'rate_limited' | 'network' | 'server' | 'validation' = 'server',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
