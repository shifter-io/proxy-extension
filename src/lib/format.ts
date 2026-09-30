import type { Membership, ResidentialMembership, Target } from './types';

export function formatBytes(bytes: number, digits = 1): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${trim(gb, digits)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${trim(mb, 0)} MB`;
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

export function trafficLeft(m: ResidentialMembership) {
  const left = Math.max(0, m.trafficTotalBytes - m.trafficUsedBytes);
  const ratio = m.trafficTotalBytes > 0 ? left / m.trafficTotalBytes : 0;
  return { left, ratio };
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
      title: target.ip.ip,
      subtitle: [target.ip.city, target.ip.isp].filter(Boolean).join(' · '),
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
