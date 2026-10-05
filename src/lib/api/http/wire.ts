/**
 * Response shapes of the Shifter API, exactly as documented in
 * shifter_docs/shifter-extension-api.md. Only `api/http` reads these;
 * everything else works with the domain models in `lib/types.ts`.
 */

/** `/api/v1/user/*` wrap every body like this. */
export interface Envelope<T> {
  error: string | null;
  code: number;
  data: T;
}

export interface WireMe {
  user_id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  wallet_balance: number;
  currency: string;
  created_at: string;
}

export type WireColor = 'success' | 'warning' | 'danger' | 'info';

export interface WireMembership {
  name: string;
  status: string;
  color: WireColor;
  service: string;
  uri: string;
  membership_id: number;
  product: string;
  category: string;
  is_recurring: boolean;
  is_trial: boolean;
  created_at: string;
  expires_at: string;
  renews_at: string | null;
  trial_ends_at: string | null;
  canceled_at: string | null;
  /** Residential plans only; null for every other product. */
  pool?: 'full' | 'country' | 'non-geo' | null;
  pool_label?: string | null;
}

/** Keyed by the plan's short id (hash). */
export type WireMemberships = Record<string, WireMembership>;

export interface WireUsageMembership {
  id: string;
  plan: string;
  service: string;
  status: string;
  metered: boolean;
  quota_bytes: number | null;
  used_bytes: number | null;
  remaining_bytes: number | null;
  overage_bytes: number | null;
  used_percent: number | null;
  resets_at: string | null;
  overage_billed: boolean;
  overage_rate_per_gb: number | null;
  wallet_balance: number | null;
  wallet_covers_gb: number | null;
}

export interface WireUsage {
  memberships: WireUsageMembership[];
}

export interface WireEntryPoint {
  key: string;
  host: string;
  city: string | null;
  region: string;
}

interface WirePlanBase {
  membership_id: number;
  hash: string;
  product: string;
  status: string;
  protocol: string;
  host: string;
  port: number;
  password: string;
}

export interface WireResidentialPlan extends WirePlanBase {
  type: 'residential';
  pool: 'full' | 'country' | 'non-geo';
  pool_label: string;
  entry_points: WireEntryPoint[];
  username: string;
  targeting: { country: boolean; region: boolean; city: boolean; asn: boolean; sticky_session: boolean };
  username_format: string;
}

export interface WireIspPlan extends WirePlanBase {
  type: 'isp';
  proxies: { username: string; country: string; city: string | null; asn: number | null }[];
}

export type WirePlan = WireResidentialPlan | WireIspPlan;

export interface WireProxyConfig {
  plans: WirePlan[];
}
