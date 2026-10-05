// Tests the real browser toolbar APIs against local, mock connection states.
// Run: node e2e/toolbar.mjs [chrome|firefox]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { drivers } from './drivers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const selected = process.argv.slice(2);
const connected = {
  status: 'connected', membershipId: 'm_res_1',
  target: { kind: 'residential', country: { code: 'us', name: 'United States' } },
  exitIp: '192.0.2.10', exitCountry: 'ro', since: new Date().toISOString(),
};

for (const name of selected.length ? selected : Object.keys(drivers)) {
  const driver = drivers[name];
  assert.ok(driver, `Unknown browser: ${name}`);
  execFileSync('npx', ['wxt', 'build', ...(name === 'firefox' ? ['-b', 'firefox'] : [])], {
    cwd: root, stdio: 'pipe',
    env: { ...process.env, WXT_USE_MOCK: 'true', WXT_SHIFTER_BASE_URL: 'http://127.0.0.1:18080', WXT_OUT_DIR: 'build-test/toolbar' },
  });
  const { browser, page } = await driver.launch(`${root}build-test/toolbar/${driver.build}`);
  try {
    const set = (connection) => page.evaluate(async (connection) => {
      const api = globalThis.browser ?? globalThis.chrome;
      await api.storage.local.set({ connection });
    }, connection);
    const expect = async (text, title, color) => {
      await page.waitForFunction(async ({ text, title }) => {
        const api = globalThis.browser ?? globalThis.chrome;
        const action = api.action ?? api.browserAction;
        return await action.getBadgeText({}) === text && (await action.getTitle({})).includes(title);
      }, { timeout: 5000 }, { text, title });
      if (color) {
        const actual = await page.evaluate(async () => {
          const api = globalThis.browser ?? globalThis.chrome;
          const action = api.action ?? api.browserAction;
          return { background: await action.getBadgeBackgroundColor({}), text: await action.getBadgeTextColor({}) };
        });
        assert.deepEqual(actual, { background: color, text: [255, 255, 255, 255] });
      }
    };

    await expect('', 'Not connected');
    await set({ status: 'connecting', membershipId: 'm_res_1', target: connected.target });
    await expect('…', 'Connecting', [180, 83, 9, 255]);
    await set(connected);
    await expect('RO', 'Connected · RO · 192.0.2.10', [21, 128, 61, 255]);
    console.log(`PASS ${name}: live badge uses actual exit country, with white text on green`);

    await set({ ...connected, exitCountry: 'de', exitIp: '192.0.2.11' });
    await expect('DE', 'Connected · DE · 192.0.2.11');
    await set({ ...connected, exitCountry: undefined });
    await expect('ON', 'Connected · 192.0.2.10');
    await set({ ...connected, exitCountry: 'invalid' });
    await expect('ON', 'Connected · 192.0.2.10');
    await set({ status: 'error', message: 'Test connection failure' });
    await expect('!', 'Connection failed: Test connection failure', [185, 28, 28, 255]);
    await set({ status: 'disconnected' });
    await expect('', 'Not connected');
    console.log(`PASS ${name}: exit changes, unknown country, connection errors, and disconnect`);

    // Rapid state changes must finish on the latest state, not an old country.
    await page.evaluate(async (connection) => {
      const api = globalThis.browser ?? globalThis.chrome;
      await api.storage.local.set({ connection });
      await api.storage.local.set({ connection: { status: 'disconnected' } });
    }, connected);
    await expect('', 'Not connected');

    if (name === 'chrome') {
      await set(connected);
      await expect('RO', 'Connected');
      // Deliberately erase the badge, restart the worker, and ensure it is restored.
      await page.evaluate(() => chrome.action.setBadgeText({ text: '' }));
      const cdp = await page.createCDPSession();
      await cdp.send('ServiceWorker.enable');
      await cdp.send('ServiceWorker.stopAllWorkers');
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'proxy:check' }));
      await expect('RO', 'Connected');
      await cdp.detach();
      console.log('PASS chrome: worker restart restores the badge from saved connection state');

      const target = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      const worker = await target.worker();
      await page.close();
      await worker.evaluate(async (connection) => chrome.storage.local.set({ connection }), { ...connected, exitCountry: 'gb' });
      let badge;
      for (let i = 0; i < 50; i++) {
        badge = await worker.evaluate(() => chrome.action.getBadgeText({}));
        if (badge === 'GB') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(badge, 'GB');
      console.log('PASS chrome: badge updates with the popup closed');
    }
    console.log(`PASS ${name}: toolbar checks passed`);
  } finally {
    await browser.close();
  }
}
