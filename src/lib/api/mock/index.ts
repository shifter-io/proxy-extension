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
} from '../../types';
import type { ShifterApi } from '../types';
import { ASNS, CITIES, COUNTRIES, ISP_IPS, MEMBERSHIPS, REGIONS } from './fixtures';

const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-memory backend used until the panel exposes extension endpoints.
 *
 * The email typed at login picks a scenario, so every branch of the UI
 * can be exercised without a server:
 *   single@…   → one Residential membership (skips the picker)
 *   isp@…      → one ISP membership (skips the picker)
 *   none@…     → no active memberships (empty state)
 *   bounce@…   → "undeliverable email" error
 *   anything else → Residential + 2× ISP + 1 expired
 */
export class MockShifterApi implements ShifterApi {
  private email = '';
  private pendingPolls = new Map<string, number>();

  useSession(session: Session | null): void {
    // A reopened popup restores the scenario from the stored session.
    this.email = session?.user.email.toLowerCase() ?? '';
  }

  async checkEmail(email: string): Promise<LoginCheckResult> {
    await delay(700);
    const normalized = email.trim().toLowerCase();
    if (normalized.startsWith('bounce@')) return { flow: 'undeliverable_email' };
    this.email = normalized;
    const requestId = `mlr_${Math.random().toString(36).slice(2, 10)}`;
    this.pendingPolls.set(requestId, 0);
    return { flow: 'magic_link_sent', requestId };
  }

  async magicLinkStatus(requestId: string): Promise<MagicLinkStatus> {
    await delay(150);
    const polls = this.pendingPolls.get(requestId);
    if (polls === undefined) return { status: 'expired' };
    // Pretend the user clicks the email link on the ~2nd poll.
    if (polls < 1) {
      this.pendingPolls.set(requestId, polls + 1);
      return { status: 'pending' };
    }
    this.pendingPolls.delete(requestId);
    return {
      status: 'confirmed',
      session: {
        user: this.user(),
        token: `mock_${requestId}`,
        createdAt: new Date().toISOString(),
      },
    };
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
    const local = this.email.split('@')[0];
    if (local === 'single') return MEMBERSHIPS.filter((m) => m.id === 'm_res_1');
    if (local === 'isp') return MEMBERSHIPS.filter((m) => m.id === 'm_isp_us');
    if (local === 'none') return MEMBERSHIPS.filter((m) => m.status === 'expired');
    return MEMBERSHIPS;
  }

  async countries(): Promise<GeoCountry[]> {
    await delay(200);
    return COUNTRIES;
  }

  async regions(country: string): Promise<GeoRegion[]> {
    await delay(200);
    return REGIONS[country] ?? [];
  }

  async cities(country: string, region?: string): Promise<GeoCity[]> {
    await delay(200);
    const all = CITIES[country] ?? [];
    return region ? all.filter((c) => c.regionSlug === region) : all;
  }

  async asns(country: string): Promise<GeoAsn[]> {
    await delay(200);
    return ASNS[country] ?? [];
  }

  async searchGeo(query: string): Promise<GeoSearchResult[]> {
    await delay(150);
    const q = query.trim().toLowerCase().replace(/^as(?=\d)/, '');
    if (!q) return [];
    const hit = (s: string) => s.toLowerCase().includes(q);
    const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
    const out: GeoSearchResult[] = [];

    for (const country of COUNTRIES) {
      if (hit(country.name) || country.code === q) out.push({ kind: 'country', country });
    }
    for (const [code, regions] of Object.entries(REGIONS)) {
      const country = byCode.get(code)!;
      for (const region of regions) if (hit(region.name)) out.push({ kind: 'region', country, region });
    }
    for (const [code, cities] of Object.entries(CITIES)) {
      const country = byCode.get(code)!;
      for (const city of cities) {
        if (!hit(city.name)) continue;
        const region = REGIONS[code]?.find((r) => r.slug === city.regionSlug);
        out.push({ kind: 'city', country, region, city });
      }
    }
    for (const [code, asns] of Object.entries(ASNS)) {
      const country = byCode.get(code)!;
      for (const asn of asns) {
        if (hit(asn.name) || String(asn.asn).startsWith(q)) out.push({ kind: 'asn', country, asn });
      }
    }
    return out.slice(0, 40);
  }

  async ispIps(membershipId: string): Promise<IspIp[]> {
    await delay(300);
    return ISP_IPS[membershipId] ?? [];
  }

  async credentials(membershipId: string): Promise<ProxyCredentials> {
    await delay(200);
    return {
      host: 'p.shifter.io',
      port: 443,
      username: `mock-${membershipId}`,
      password: 'mock-password',
    };
  }

  private user(): User {
    const email = this.email || 'demo@example.invalid';
    return { id: 'u_mock', email };
  }
}
