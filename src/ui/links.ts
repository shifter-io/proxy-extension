import { browser } from '#imports';

export const SHIFTER_URLS = {
  panel: 'https://shifter.io/panel',
  /** Panel → Profile → API Key section. */
  apiKey: 'https://shifter.io/panel/profile#api-key',
  /** /register redirects to the email-first login, which creates new accounts. */
  register: 'https://shifter.io/register',
  order: 'https://shifter.io/order/residential-proxies',
  support: 'https://shifter.io/contact',
  renew: (membershipId: string) => `https://shifter.io/panel/membership/${membershipId}`,
};

/** Popups close on navigation, so external links always open a new tab. */
export function openExternal(url: string) {
  void browser.tabs.create({ url });
}
