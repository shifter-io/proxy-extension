import { browser } from '#imports';

import type { Membership } from '@/lib/types';

export const SHIFTER_URLS = {
  panel: 'https://shifter.io/panel',
  /** Profile → API Key section. */
  apiKey: 'https://shifter.io/user/profile',
  /** Login creates new accounts too (email, Google or GitHub). */
  register: 'https://shifter.io/login',
  order: 'https://shifter.io/order',
  support: 'https://shifter.io/contact',
  /** The plan's panel page: /panel/membership/{hash} (renew, invoices, settings). */
  renew: (m: Membership) => m.manageUrl ?? `https://shifter.io/panel/membership/${m.id}`,
};

/** Popups close on navigation, so external links always open a new tab. */
export function openExternal(url: string) {
  void browser.tabs.create({ url });
}
