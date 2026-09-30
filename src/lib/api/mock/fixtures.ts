import { slugify } from '../../proxy/slug';
import type { GeoAsn, GeoCity, GeoCountry, GeoRegion, IspIp, Membership } from '../../types';

const GB = 1024 ** 3;
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

// ── Memberships ─────────────────────────────────────────────────────────

export const MEMBERSHIPS: Membership[] = [
  {
    id: 'm_res_1',
    type: 'residential',
    planName: 'Residential Proxies · Pro',
    pool: 'full',
    status: 'active',
    expiresAt: days(23),
    autoRenew: true,
    trafficTotalBytes: 50 * GB,
    trafficUsedBytes: 17.6 * GB,
  },
  {
    id: 'm_isp_us',
    type: 'isp',
    planName: 'ISP Proxies · US 25',
    status: 'active',
    expiresAt: days(11),
    autoRenew: true,
    ipCount: 25,
    countries: ['us'],
  },
  {
    id: 'm_isp_eu',
    type: 'isp',
    planName: 'ISP Proxies · EU Mix 10',
    status: 'expiring',
    expiresAt: days(2),
    autoRenew: false,
    ipCount: 10,
    countries: ['de', 'gb', 'nl'],
  },
  {
    id: 'm_res_country',
    type: 'residential',
    planName: 'Country Geo Starter',
    pool: 'country',
    status: 'expired',
    expiresAt: days(-6),
    autoRenew: false,
    trafficTotalBytes: 5 * GB,
    trafficUsedBytes: 5 * GB,
  },
];

// ── Residential geo catalog ─────────────────────────────────────────────

export const COUNTRIES: GeoCountry[] = [
  ['us', 'United States'], ['gb', 'United Kingdom'], ['de', 'Germany'], ['fr', 'France'],
  ['ca', 'Canada'], ['au', 'Australia'], ['nl', 'Netherlands'], ['es', 'Spain'],
  ['it', 'Italy'], ['ro', 'Romania'], ['br', 'Brazil'], ['mx', 'Mexico'],
  ['in', 'India'], ['jp', 'Japan'], ['kr', 'South Korea'], ['sg', 'Singapore'],
  ['se', 'Sweden'], ['no', 'Norway'], ['dk', 'Denmark'], ['fi', 'Finland'],
  ['pl', 'Poland'], ['pt', 'Portugal'], ['ie', 'Ireland'], ['ch', 'Switzerland'],
  ['at', 'Austria'], ['be', 'Belgium'], ['cz', 'Czech Republic'], ['gr', 'Greece'],
  ['tr', 'Turkey'], ['ua', 'Ukraine'], ['il', 'Israel'], ['ae', 'United Arab Emirates'],
  ['sa', 'Saudi Arabia'], ['za', 'South Africa'], ['ng', 'Nigeria'], ['eg', 'Egypt'],
  ['ar', 'Argentina'], ['cl', 'Chile'], ['co', 'Colombia'], ['pe', 'Peru'],
  ['id', 'Indonesia'], ['th', 'Thailand'], ['vn', 'Vietnam'], ['ph', 'Philippines'],
  ['my', 'Malaysia'], ['hk', 'Hong Kong'], ['tw', 'Taiwan'], ['nz', 'New Zealand'],
].map(([code, name]) => ({ code: code!, name: name! }));

const r = (...names: string[]): GeoRegion[] => names.map((name) => ({ name, slug: slugify(name) }));

export const REGIONS: Record<string, GeoRegion[]> = {
  us: r('California', 'Florida', 'Georgia', 'Illinois', 'Massachusetts', 'Michigan', 'New Jersey', 'New York', 'North Carolina', 'Ohio', 'Pennsylvania', 'Texas', 'Virginia', 'Washington'),
  gb: r('England', 'Scotland', 'Wales', 'Northern Ireland'),
  de: r('Bavaria', 'Berlin', 'Hamburg', 'Hesse', 'North Rhine-Westphalia', 'Saxony'),
  fr: r('Île-de-France', 'Auvergne-Rhône-Alpes', "Provence-Alpes-Côte d'Azur", 'Occitanie'),
  ca: r('Alberta', 'British Columbia', 'Ontario', 'Quebec'),
  ro: r('Bucharest', 'Cluj', 'Ilfov', 'Iasi', 'Timis'),
  au: r('New South Wales', 'Queensland', 'Victoria', 'Western Australia'),
};

const c = (region: string, ...names: string[]): GeoCity[] =>
  names.map((name) => ({ name, slug: slugify(name), regionSlug: slugify(region) }));

export const CITIES: Record<string, GeoCity[]> = {
  us: [
    ...c('California', 'Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento'),
    ...c('Texas', 'Houston', 'Dallas', 'Austin', 'San Antonio'),
    ...c('New York', 'New York', 'Buffalo', 'Rochester'),
    ...c('Florida', 'Miami', 'Orlando', 'Tampa', 'Jacksonville'),
    ...c('Illinois', 'Chicago', 'Springfield'),
    ...c('Washington', 'Seattle', 'Spokane'),
    ...c('Georgia', 'Atlanta', 'Savannah'),
    ...c('Massachusetts', 'Boston', 'Cambridge'),
  ],
  gb: [...c('England', 'London', 'Manchester', 'Birmingham', 'Leeds', 'Bristol'), ...c('Scotland', 'Edinburgh', 'Glasgow'), ...c('Wales', 'Cardiff')],
  de: [...c('Berlin', 'Berlin'), ...c('Bavaria', 'Munich', 'Nuremberg'), ...c('Hamburg', 'Hamburg'), ...c('Hesse', 'Frankfurt am Main'), ...c('North Rhine-Westphalia', 'Cologne', 'Düsseldorf')],
  fr: [...c('Île-de-France', 'Paris'), ...c('Auvergne-Rhône-Alpes', 'Lyon'), ...c("Provence-Alpes-Côte d'Azur", 'Marseille', 'Nice'), ...c('Occitanie', 'Toulouse')],
  ca: [...c('Ontario', 'Toronto', 'Ottawa'), ...c('Quebec', 'Montreal'), ...c('British Columbia', 'Vancouver'), ...c('Alberta', 'Calgary')],
  ro: [...c('Bucharest', 'Bucharest'), ...c('Cluj', 'Cluj-Napoca'), ...c('Ilfov', 'Voluntari', 'Otopeni'), ...c('Iasi', 'Iasi'), ...c('Timis', 'Timisoara')],
  au: [...c('New South Wales', 'Sydney'), ...c('Victoria', 'Melbourne'), ...c('Queensland', 'Brisbane'), ...c('Western Australia', 'Perth')],
};

export const ASNS: Record<string, GeoAsn[]> = {
  us: [
    { asn: 7922, name: 'Comcast Cable Communications' },
    { asn: 7018, name: 'AT&T Services' },
    { asn: 701, name: 'Verizon Business' },
    { asn: 20115, name: 'Charter Communications' },
    { asn: 22773, name: 'Cox Communications' },
    { asn: 21928, name: 'T-Mobile USA' },
  ],
  gb: [
    { asn: 2856, name: 'British Telecommunications' },
    { asn: 5089, name: 'Virgin Media' },
    { asn: 5607, name: 'Sky UK' },
  ],
  de: [
    { asn: 3320, name: 'Deutsche Telekom' },
    { asn: 3209, name: 'Vodafone GmbH' },
    { asn: 6805, name: 'Telefonica Germany' },
  ],
  fr: [
    { asn: 3215, name: 'Orange' },
    { asn: 12322, name: 'Free SAS' },
    { asn: 5410, name: 'Bouygues Telecom' },
  ],
  ro: [
    { asn: 8708, name: 'RCS & RDS' },
    { asn: 9050, name: 'Orange Romania' },
  ],
};

// ── ISP static IPs ──────────────────────────────────────────────────────

function ips(prefix: string, country: string, city: string, isp: string, count: number, start = 10): IspIp[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${country}-${prefix}-${start + i}`,
    ip: `${prefix}.${start + i}`,
    country,
    city,
    isp,
  }));
}

export const ISP_IPS: Record<string, IspIp[]> = {
  m_isp_us: [
    ...ips('104.28.41', 'us', 'New York', 'Comcast', 8),
    ...ips('172.58.12', 'us', 'Los Angeles', 'AT&T', 7, 40),
    ...ips('68.183.77', 'us', 'Dallas', 'Verizon', 6, 120),
    ...ips('73.162.9', 'us', 'Miami', 'Spectrum', 4, 200),
  ],
  m_isp_eu: [
    ...ips('91.64.18', 'de', 'Frankfurt', 'Deutsche Telekom', 4, 30),
    ...ips('86.14.201', 'gb', 'London', 'Virgin Media', 4, 60),
    ...ips('145.53.8', 'nl', 'Amsterdam', 'KPN', 2, 90),
  ],
};
