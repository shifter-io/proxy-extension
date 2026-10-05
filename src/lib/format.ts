import type { IspIp, Membership, ResidentialMembership, Target } from './types';

/** Decimal units, same as the panel and the API (1 GB = 1,000,000,000 bytes). */
export function formatBytes(bytes: number, digits = 1): string {
  const gb = bytes / 1e9;
  if (gb >= 1000) return `${trim(gb / 1000, digits)} TB`;
  if (gb >= 1) return `${trim(gb, digits)} GB`;
  return `${trim(bytes / 1e6, 0)} MB`;
}

export function formatMoney(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

function trim(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString();
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "in 23 days", "tomorrow", "6 days ago" */
export function relativeDays(iso: string): string {
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = seconds / 3600;
  return `${trim(h, 1)} h`;
}

/** Traffic left on a metered plan; null when the plan has no cap. */
export function trafficLeft(m: ResidentialMembership) {
  if (!m.traffic) return null;
  const { totalBytes, remainingBytes } = m.traffic;
  const left = Math.max(0, remainingBytes);
  const ratio = totalBytes > 0 ? left / totalBytes : 0;
  return { left, ratio, total: totalBytes };
}

/** "Comcast #2" when several of the plan's IPs share country, city and ASN. */
export function ispIpLabel(ip: IspIp): string {
  return ip.seqOf > 1 ? `${ip.isp} #${ip.seq}` : ip.isp;
}

export function ispIpPlace(ip: IspIp): string {
  return [ip.city ?? countryName(ip.country), ip.asn ? `AS${ip.asn}` : ''].filter(Boolean).join(' · ');
}

/** Numbers IPs that share country + city + ASN (#1, #2…), in list order. */
export function numberIspIps(list: Omit<IspIp, 'seq' | 'seqOf'>[]): IspIp[] {
  const key = (ip: Omit<IspIp, 'seq' | 'seqOf'>) => `${ip.country}|${ip.city ?? ''}|${ip.asn ?? ''}`;
  const totals = new Map<string, number>();
  for (const ip of list) totals.set(key(ip), (totals.get(key(ip)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return list.map((ip) => {
    const seq = (seen.get(key(ip)) ?? 0) + 1;
    seen.set(key(ip), seq);
    return { ...ip, seq, seqOf: totals.get(key(ip))! };
  });
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** English country name for an iso2 code ("us" -> "United States"). */
export function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function isUsable(m: Membership): boolean {
  return m.status === 'active' || m.status === 'expiring';
}

export const PRODUCT_LABEL: Record<Membership['type'], string> = {
  residential: 'Residential',
  isp: 'ISP',
};

/** Shown above the full A–Z list in the location picker. */
export const POPULAR_COUNTRIES = ['us', 'gb', 'de', 'fr', 'ca'];

export const POOL_LABEL = {
  full: 'Full Geo',
  country: 'Country Geo',
  'non-geo': 'Non-Geo',
} as const;

/** Primary + secondary label for a target, most specific first. */
export function describeTarget(target: Target | undefined): { title: string; subtitle: string } {
  if (!target) return { title: 'Choose location', subtitle: 'No location selected' };
  if (target.kind === 'isp') {
    return {
      title: ispIpLabel(target.ip),
      subtitle: ispIpPlace(target.ip),
    };
  }
  if (!target.country) return { title: 'Random location', subtitle: 'Worldwide · best available' };
  const title = target.city?.name ?? target.region?.name ?? target.country.name;
  const trail = [target.city && target.region?.name, (target.city || target.region) && target.country.name]
    .filter(Boolean)
    .join(', ');
  const asn = target.asn ? `AS${target.asn.asn}` : '';
  return { title, subtitle: [trail || 'Any city', asn].filter(Boolean).join(' · ') };
}

export function targetCountryCode(target: Target | undefined): string | undefined {
  if (!target) return undefined;
  return target.kind === 'isp' ? target.ip.country : target.country?.code;
}

export function sameTarget(a: Target, b: Target): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'isp' && b.kind === 'isp') return a.ip.id === b.ip.id;
  const ra = a as Extract<Target, { kind: 'residential' }>;
  const rb = b as Extract<Target, { kind: 'residential' }>;
  return (
    ra.country?.code === rb.country?.code &&
    ra.region?.slug === rb.region?.slug &&
    ra.city?.slug === rb.city?.slug &&
    ra.asn?.asn === rb.asn?.asn
  );
}
