import { slugify } from '../../proxy/slug';
import { numberIspIps } from '../../format';
import type { EntryPoint, IspIp, Membership, Traffic } from '../../types';

const GB = 1e9;
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

// ── Memberships ─────────────────────────────────────────────────────────

const traffic = (totalGb: number, usedGb: number): Traffic => ({
  totalBytes: totalGb * GB,
  usedBytes: usedGb * GB,
  remainingBytes: (totalGb - usedGb) * GB,
  overageBytes: 0,
  resetsAt: days(23),
});

export const ENTRY_POINTS: EntryPoint[] = [
  { key: 'auto', host: 'p.shifter.io', city: null, region: 'Automatic' },
  { key: 'fra', host: 'fra.p.shifter.io', city: 'Frankfurt', region: 'Europe' },
  { key: 'ams', host: 'ams.p.shifter.io', city: 'Amsterdam', region: 'Europe' },
  { key: 'lon', host: 'lon.p.shifter.io', city: 'London', region: 'Europe' },
  { key: 'nyc', host: 'nyc.p.shifter.io', city: 'New York', region: 'North America' },
  { key: 'tor', host: 'tor.p.shifter.io', city: 'Toronto', region: 'North America' },
  { key: 'sgp', host: 'sgp.p.shifter.io', city: 'Singapore', region: 'Asia Pacific' },
  { key: 'blr', host: 'blr.p.shifter.io', city: 'Bangalore', region: 'Asia Pacific' },
  { key: 'syd', host: 'syd.p.shifter.io', city: 'Sydney', region: 'Asia Pacific' },
];

const live = { gatewayHost: 'p.shifter.io', entryPoints: ENTRY_POINTS, stickySessions: true };

export const MEMBERSHIPS: Membership[] = [
  {
    id: 'm_res_1',
    type: 'residential',
    planName: 'Pro',
    pool: 'full',
    status: 'active',
    expiresAt: days(23),
    renewsAt: days(23),
    traffic: traffic(50, 17.6),
    ...live,
  },
  {
    id: 'm_isp_us',
    type: 'isp',
    planName: '25 ISP Proxies',
    status: 'active',
    expiresAt: days(11),
    renewsAt: days(11),
    ipCount: 25,
    countries: ['us'],
  },
  {
    id: 'm_isp_eu',
    type: 'isp',
    planName: '50 ISP Proxies',
    status: 'expiring',
    expiresAt: days(2),
    renewsAt: null,
    ipCount: 50,
    countries: ['de', 'gb', 'nl'],
  },
  {
    id: 'm_res_country',
    type: 'residential',
    planName: 'Starter',
    pool: 'country',
    status: 'active',
    expiresAt: days(17),
    renewsAt: days(17),
    traffic: traffic(10, 3.2),
    ...live,
  },
  {
    id: 'm_res_nongeo',
    type: 'residential',
    planName: 'Spark',
    pool: 'non-geo',
    status: 'active',
    expiresAt: days(29),
    renewsAt: days(29),
    traffic: traffic(5, 4.4),
    ...live,
  },
  {
    id: 'm_isp_expired',
    type: 'isp',
    planName: '100 ISP Proxies',
    status: 'expired',
    expiresAt: days(-6),
    renewsAt: null,
    ipCount: 100,
    countries: ['us'],
  },
];

// ── ISP static IPs ──────────────────────────────────────────────────────

/** Shaped like proxy-config's ISP `proxies` (username, country, city, ASN). */
function proxies(country: string, city: string, asn: number, isp: string, count: number): Omit<IspIp, 'seq' | 'seqOf'>[] {
  const tag = slugify(city);
  return Array.from({ length: count }, (_, i) => ({
    id: `${country}-${tag}-${tag}-as${asn}-${(0x1f2e3 * (i + 7)).toString(36).slice(-5)}`,
    country,
    city,
    asn,
    isp,
  }));
}

export const ISP_IPS: Record<string, IspIp[]> = {
  m_isp_us: numberIspIps([
    ...proxies('us', 'New York', 7922, 'Comcast', 8),
    ...proxies('us', 'Los Angeles', 7018, 'AT&T', 7),
    ...proxies('us', 'Dallas', 701, 'Verizon', 6),
    ...proxies('us', 'Miami', 20115, 'Spectrum', 4),
  ]),
  m_isp_eu: numberIspIps([
    ...proxies('de', 'Frankfurt', 3320, 'Deutsche Telekom', 20),
    ...proxies('gb', 'London', 5089, 'Virgin Media', 20),
    ...proxies('nl', 'Amsterdam', 1136, 'KPN', 1),
  ]),
};
