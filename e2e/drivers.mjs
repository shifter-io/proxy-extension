// How to launch each browser with the extension and get hold of its popup.
// Test builds open the popup in a tab on install (see background.ts), since
// Firefox automation can't navigate to extension pages itself.
import puppeteer from 'puppeteer';

const FIREFOX_UUID = '5a1f0000-0000-4000-8000-00000000abcd';

async function findPopup(browser, prefix) {
  for (let i = 0; i < 40; i++) {
    for (const p of await browser.pages()) {
      // Firefox reports extension tabs as about:blank to automation; ask the page.
      const href = await p.evaluate(() => location.href).catch(() => '');
      if (href.startsWith(prefix)) return p;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('extension popup tab did not open');
}

export const drivers = {
  /** Chrome for Testing: same engine and extension APIs as Chrome, Edge and Brave. */
  chrome: {
    name: 'chrome',
    build: 'chrome-mv3',
    async launch(extDir, options = {}) {
      const browser = await puppeteer.launch({ headless: true, pipe: true, enableExtensions: [extDir], ...options });
      const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      const page = await findPopup(browser, `chrome-extension://${new URL(sw.url()).host}/popup.html`);
      return { browser, page };
    },
    // Background tabs are throttled; bring the popup forward before driving it.
    focus: (page) => page.bringToFront(),
  },

  firefox: {
    name: 'firefox',
    build: 'firefox-mv2',
    async launch(extDir) {
      const browser = await puppeteer.launch({
        browser: 'firefox',
        headless: true,
        // Lets automation script extension pages.
        args: ['-remote-allow-system-access'],
        extraPrefsFirefox: {
          // Fixed moz-extension:// host, so the popup tab can be recognised.
          'extensions.webextensions.uuids': JSON.stringify({ 'extension@shifter.io': FIREFOX_UUID }),
        },
      });
      await browser.installExtension(extDir);
      const page = await findPopup(browser, `moz-extension://${FIREFOX_UUID}/popup.html`);
      return { browser, page };
    },
    focus: async () => undefined,
  },
};
