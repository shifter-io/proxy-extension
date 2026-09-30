import type { ProxySettings, ResidentialTarget } from '../types';

/**
 * Builds the residential gateway username. Same grammar as the panel's
 * endpoint builder and the residential VPN app (shifter_username_builder.dart):
 *
 *   <base>[-country-<iso2>][-region-<slug>][-city-<slug>][-asn-<num>][-sid-<id>][-ttl-<s>][-strict-true]
 *
 * NEVER log or render the result next to the password.
 */
export function buildResidentialUsername(
  base: string,
  target: ResidentialTarget,
  settings: Pick<ProxySettings, 'sessionMode' | 'ttlSeconds' | 'strict'>,
  sid?: string,
): string {
  const parts = [base];
  if (target.country) parts.push('country', target.country.code);
  if (target.region) parts.push('region', target.region.slug);
  if (target.city) parts.push('city', target.city.slug);
  if (target.asn) parts.push('asn', String(target.asn.asn));
  if (settings.sessionMode === 'sticky' && sid) {
    parts.push('sid', sid);
    if (settings.ttlSeconds > 0) parts.push('ttl', String(settings.ttlSeconds));
  }
  if (settings.strict) parts.push('strict', 'true');
  return parts.join('-');
}

/** Fresh opaque session id; a new one pins a new exit IP. */
export function newSid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
