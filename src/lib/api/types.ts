import type {
  GeoAsn,
  GeoCity,
  GeoCountry,
  GeoRegion,
  GeoSearchResult,
  IspIp,
  LoginCheckResult,
  MagicLinkStatus,
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
  /** Attach (or clear) the signed-in session; the HTTP client sends its token. */
  useSession(session: Session | null): void;

  // Auth (email-first magic link, same flow as shifter.io/login)
  checkEmail(email: string): Promise<LoginCheckResult>;
  magicLinkStatus(requestId: string): Promise<MagicLinkStatus>;
  signOut(): Promise<void>;

  // Account
  me(): Promise<User>;
  memberships(): Promise<Membership[]>;

  // Residential geo catalog (panel: ResidentialGeoController)
  countries(): Promise<GeoCountry[]>;
  regions(country: string): Promise<GeoRegion[]>;
  cities(country: string, region?: string): Promise<GeoCity[]>;
  asns(country: string): Promise<GeoAsn[]>;
  /** Search countries, regions, cities and ASNs in one go (VPN-style search box). */
  searchGeo(query: string): Promise<GeoSearchResult[]>;

  // ISP
  ispIps(membershipId: string): Promise<IspIp[]>;

  // Gateway credentials for a membership (never logged, never rendered)
  credentials(membershipId: string): Promise<ProxyCredentials>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: 'unauthorized' | 'network' | 'server' | 'validation' = 'server',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
