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
} from '../../types';
import { ApiError, type ShifterApi } from '../types';
import { geoCatalog } from '../../geo/catalog';
import { ENTRY_POINTS, ISP_IPS, MEMBERSHIPS } from './fixtures';

const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-memory backend used until the panel exposes extension endpoints.
 *
 * Any key of 32+ letters/digits is accepted (real panel keys are 64). Its
 * prefix picks a scenario, so every branch of the UI can be exercised:
 *   single…   → one Residential Full Geo membership (skips the picker)
 *   country…  → one Residential Country Geo membership
 *   nongeo…   → one Residential Non-Geo membership
 *   isp…      → one ISP membership (skips the picker)
 *   none…     → no active memberships (empty state)
 *   invalid…  → rejected as an unknown key
 *   anything else → Full Geo + Country Geo + Non-Geo + 2× ISP + 1 expired
 */
export class MockShifterApi implements ShifterApi {
  private scenario = '';

  useSession(session: Session | null): void {
    // A reopened popup restores the scenario from the stored key.
    this.scenario = session ? scenarioOf(session.apiKey) : '';
  }

  async verifyApiKey(apiKey: string): Promise<Session> {
    await delay(650);
    const key = apiKey.trim();
    if (!/^[A-Za-z0-9]{32,}$/.test(key) || key.toLowerCase().startsWith('invalid')) {
      throw new ApiError('Invalid API key', 'unauthorized');
    }
    this.scenario = scenarioOf(key);
    return { user: this.user(), apiKey: key, createdAt: new Date().toISOString() };
  }

  async signOut(): Promise<void> {
    await delay(150);
  }

  async me(): Promise<User> {
    await delay();
    return this.user();
  }

  async memberships(): Promise<Membership[]> {
    await delay(500);
    const local = this.scenario;
    if (local === 'single') return MEMBERSHIPS.filter((m) => m.id === 'm_res_1');
    if (local === 'country') return MEMBERSHIPS.filter((m) => m.id === 'm_res_country');
    if (local === 'nongeo') return MEMBERSHIPS.filter((m) => m.id === 'm_res_nongeo');
    if (local === 'isp') return MEMBERSHIPS.filter((m) => m.id === 'm_isp_us');
    if (local === 'none') return MEMBERSHIPS.filter((m) => m.status === 'expired');
    return MEMBERSHIPS;
  }

  // Same bundled catalog as the live API.
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

  async ispIps(membershipId: string): Promise<IspIp[]> {
    await delay(300);
    return ISP_IPS[membershipId] ?? [];
  }

  async credentials(membershipId: string): Promise<ProxyCredentials> {
    await delay(200);
    const isp = membershipId.startsWith('m_isp');
    return {
      type: isp ? 'isp' : 'residential',
      host: isp ? 'isp.shifter.io' : 'p.shifter.io',
      port: 443,
      username: isp ? '' : `customer-mock-${membershipId}`,
      password: 'mock-password',
      entryPoints: isp ? [] : ENTRY_POINTS,
      stickySessions: !isp,
    };
  }

  private user(): User {
    const email = this.scenario ? `${this.scenario}@example.invalid` : 'demo@example.invalid';
    return { id: 'u_mock', email, name: 'Demo User', username: 'demo', walletBalance: 440.5, currency: 'USD' };
  }
}

function scenarioOf(key: string): string {
  const k = key.toLowerCase();
  return ['single', 'country', 'nongeo', 'isp', 'none'].find((p) => k.startsWith(p)) ?? '';
}
