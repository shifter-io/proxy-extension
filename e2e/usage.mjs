// Usage API -> membership list and home screen, in isolated test browsers.
// Run: node e2e/usage.mjs [chrome|firefox]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { drivers } from './drivers.mjs';
import { API_URL, KEY, MEMBERSHIPS, PROXY_CONFIG, USAGE, start, stop } from './fake-shifter.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const selected = process.argv.slice(2);
const options = {
  memberships: {
    ...MEMBERSHIPS,
    isp: { ...MEMBERSHIPS.YG7L, membership_id: 4, product: '25 ISP Proxies', category: 'ISP Proxies', service: 'isp' },
  },
  proxyConfig: {
    plans: [...PROXY_CONFIG.plans, {
      membership_id: 4, hash: 'isp', product: '25 ISP Proxies', status: 'Active', protocol: 'http', type: 'isp',
      host: '127.0.0.1', port: 18081, password: 'pw-secret',
      proxies: [{ username: '192.0.2.10', country: 'us', city: null, asn: null }],
    }],
  },
};
const cases = [
  { name: 'documented residential quota', patch: {}, balance: /3\.8 GB\s*\/\s*5 GB/ },
  { name: 'live null response is unavailable, not unlimited or wallet allowance', patch: {
    metered: false, quota_bytes: null, used_bytes: null, remaining_bytes: null,
    overage_billed: true, wallet_covers_gb: 219.7,
  } },
  { name: 'byte figures survive incorrect metered flag', patch: { metered: false }, balance: /3\.8 GB\s*\/\s*5 GB/ },
  { name: 'quota without usage is unavailable', patch: { used_bytes: null, remaining_bytes: null } },
  { name: 'remaining balance works without used bytes', patch: { used_bytes: null }, balance: /3\.8 GB\s*\/\s*5 GB/ },
  { name: 'zero balance stays exhausted', patch: { used_bytes: 5e9, remaining_bytes: 0 }, balance: /0 MB\s*\/\s*5 GB/ },
  { name: 'overage never produces negative remaining traffic', patch: { used_bytes: 6e9, remaining_bytes: null, overage_bytes: 1e9 }, balance: /0 MB\s*\/\s*5 GB/ },
  { name: 'missing usage row is unavailable', missing: true },
];

await start(options);
try {
  for (const name of selected.length ? selected : Object.keys(drivers)) {
    const driver = drivers[name];
    assert.ok(driver, `Unknown browser: ${name}`);
    execFileSync('npx', ['wxt', 'build', ...(name === 'firefox' ? ['-b', 'firefox'] : [])], {
      cwd: root, stdio: 'pipe',
      env: { ...process.env, WXT_USE_MOCK: 'false', WXT_SHIFTER_BASE_URL: API_URL, WXT_OUT_DIR: 'build-test/usage' },
    });
    options.usage = structuredClone(USAGE);
    const { browser, page } = await driver.launch(`${root}build-test/usage/${driver.build}`);
    const wait = (fn) => page.waitForFunction(fn, { timeout: 15000, polling: 100 });
    const choose = (title) => page.evaluate((title) => {
      [...document.querySelectorAll('[role="button"]')].find(el => el.querySelector('h3')?.textContent === title).click();
    }, title);
    const list = async () => {
      await wait(() => document.querySelector('h3') || document.querySelector('button[aria-label="Switch membership"]'));
      await page.evaluate(() => document.querySelector('button[aria-label="Switch membership"]')?.click());
      await wait(() => !!document.querySelector('h3'));
    };
    try {
      await wait(() => !!document.querySelector('input[aria-label="API key"]'));
      await page.evaluate((key) => {
        const input = document.querySelector('input[aria-label="API key"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, key);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('button[type="submit"]').click();
      }, KEY);
      await list();

      for (const scenario of cases) {
        options.usage = { memberships: scenario.missing ? [] : [{ ...USAGE.memberships[0], ...scenario.patch }] };
        // Firefox masks extension URLs from navigation events. Reload inside
        // the page and wait for a fresh document before checking the new data.
        await page.evaluate(() => {
          document.body.dataset.previousUsage = 'true';
          location.reload();
        });
        await wait(() => !document.body.dataset.previousUsage);
        await list();
        const cards = await page.evaluate(() => Object.fromEntries(
          [...document.querySelectorAll('[role="button"]')].filter(el => el.querySelector('h3'))
            .map(el => [el.querySelector('h3').textContent, el.innerText]),
        ));
        assert.doesNotMatch(cards.Spark, /Unlimited|219\.7/);
        assert.match(cards.Spark, scenario.balance ?? /Traffic left\s*—/i);
        assert.match(cards['25 ISP Proxies'], /Unlimited/);
        await choose('Spark');
        await wait(() => !!document.querySelector('button[aria-label="Connect"]'));
        const home = await page.evaluate(() => document.body.innerText);
        assert.doesNotMatch(home, /Unlimited|219\.7/);
        assert.match(home, scenario.balance ?? /Traffic left\s*—\s*Not available yet/i);
        console.log(`PASS ${name}: ${scenario.name} (home + plan list)`);
      }

      await list();
      await choose('25 ISP Proxies');
      await wait(() => !!document.querySelector('button[aria-label="Connect"]'));
      assert.match(await page.evaluate(() => document.body.innerText), /Bandwidth\s*Unlimited/i);
      console.log(`PASS ${name}: ISP remains unlimited`);
    } finally {
      await browser.close();
    }
  }
} finally {
  stop();
}
