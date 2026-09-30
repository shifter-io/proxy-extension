import type { ResidentialPool, ResidentialTarget } from './types';

/**
 * What each Residential pool lets the user target. Mirrors the panel's
 * App\Support\ResidentialPools (allowsCountry / allowsCityAsn):
 *
 *   Full Geo     country, region, city, ASN
 *   Country Geo  country only
 *   Non-Geo      nothing: random IP from the whole pool
 */
export interface PoolTargeting {
  country: boolean;
  /** Region, city and ASN always come together (allowsCityAsn). */
  subCountry: boolean;
}

export const POOL_TARGETING: Record<ResidentialPool, PoolTargeting> = {
  full: { country: true, subCountry: true },
  country: { country: true, subCountry: false },
  'non-geo': { country: false, subCountry: false },
};

/** One-line explanation shown wherever a limit applies. */
export const POOL_LIMIT_NOTE: Record<ResidentialPool, string | null> = {
  full: null,
  country: 'Your Country Geo plan targets by country. Full Geo adds state, city and ASN targeting.',
  'non-geo': 'Non-Geo plans use random IPs worldwide. Upgrade to Country Geo or Full Geo to pick a location.',
};

/**
 * Drops any level the pool can't serve, so a stored target (or one picked
 * before a plan change) never reaches the gateway with flags it will reject.
 */
export function clampTarget(target: ResidentialTarget, pool: ResidentialPool): ResidentialTarget {
  const caps = POOL_TARGETING[pool];
  if (!caps.country) return { kind: 'residential' };
  if (!caps.subCountry) return { kind: 'residential', country: target.country };
  return target;
}
