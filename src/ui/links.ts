import { browser } from '#imports';

export const SHIFTER_URLS = {
  panel: 'https://shifter.io/panel',
  order: 'https://shifter.io/order/residential-proxies',
  support: 'https://shifter.io/contact',
  renew: (membershipId: string) => `https://shifter.io/panel/membership/${membershipId}`,
};

/** Popups close on navigation, so external links always open a new tab. */
export function openExternal(url: string) {
  void browser.tabs.create({ url });
}
