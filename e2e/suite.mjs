// The end-to-end checks, shared by every browser. The extension runs for real
// (popup, background worker, proxy, login answering, WebRTC policy) against
// the stand-in Shifter from fake-shifter.mjs.
import { KEY, dropTunnels, log } from './fake-shifter.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Popup helpers (DOM-driven: Firefox can't send input events to extension pages) ──

const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 200 }, arg);
const text = (page) => page.evaluate(() => document.body.innerText);

async function click(page, selector) {
  await waitFor(page, (s) => !!document.querySelector(s), selector);
  await page.evaluate((s) => document.querySelector(s).click(), selector);
}

async function signIn(page, key) {
  await waitFor(page, () => !!document.querySelector('input[aria-label="API key"]'));
  await page.evaluate((k) => {
    const input = document.querySelector('input[aria-label="API key"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, k);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('button[type=submit]').click();
  }, key);
}

/** Runs `fn(ext, arg)` in the popup with the extension API (`browser` on Firefox, `chrome` on Chromium). */
const ext = (page, fn, arg) =>
  page.evaluate(`(${fn})(globalThis.browser ?? globalThis.chrome, ${JSON.stringify(arg ?? null)})`);

const connectedUsername = (page) =>
  ext(page, (x) => x.storage.local.get(['activeProxy', 'connection']).then((s) => (s.connection?.status === 'connected' ? s.activeProxy?.username : null)));

const ipChecks = () => log.filter((l) => l.target.startsWith('ip-info.com'));
const sidOf = (user) => /-sid-([a-z0-9]+)/.exec(user ?? '')?.[1];

// ── Suites ─────────────────────────────────────────────────────────────

/** Bad key against the real https://shifter.io: proves the extension can call the API (no CORS block). */
export async function runLive(driver, extDir, check) {
  const { browser, page } = await driver.launch(extDir);
  try {
    await signIn(page, 'x'.repeat(64));
    await waitFor(page, () => /Invalid API key|Couldn't reach|no access|offline/.test(document.body.innerText), undefined, 20000);
    const t = await text(page);
    check('reaches the real shifter.io (bad key -> "Invalid API key")', t.includes('Invalid API key'), t.match(/Invalid API key|Couldn't reach Shifter|no access to shifter.io|offline/)?.[0]);
  } finally {
    await browser.close();
  }
}

export async function runSuite(driver, extDir, check) {
  const { browser, page } = await driver.launch(extDir);
  const front = () => driver.focus(page);
  try {
    // Sign-in
    await signIn(page, 'x'.repeat(64));
    await waitFor(page, () => document.body.innerText.includes('Invalid API key'));
    check('bad key rejected', true);
    await signIn(page, KEY);
    await waitFor(page, () => !!document.querySelector('button[aria-label="Connect"]'));
    const home = await text(page);
    check('valid key -> Home with the plan', home.includes('Spark') && home.includes('Full Geo'), home.split('\n').slice(0, 3).join(' | '));
    check('traffic from /user/usage', home.includes('3.8 GB') && home.includes('5 GB'), home.match(/[\d.]+ GB/g)?.join(' '));

    // Connect: proxy + login + IP check
    await click(page, 'button[aria-label="Connect"]');
    await waitFor(page, () => /Connected\n|Connection failed/.test(document.body.innerText), undefined, 30000);
    const t = await text(page);
    const ip = t.match(/\b\d{1,3}(\.\d{1,3}){3}\b/)?.[0];
    check('connects and shows the exit IP', t.includes('Connected') && !!ip, ip ?? t.split('\n').slice(2, 5).join(' | '));
    const first = ipChecks()[0];
    check('IP check goes through the gateway with the login', !!first, first?.user);
    check('username = base + sticky sid + ttl', /^customer-test-sid-[a-z0-9]{12}-ttl-600$/.test(first?.user ?? ''), first?.user);

    const rtc = await ext(page, (x) => x.privacy.network.webRTCIPHandlingPolicy.get({}));
    check('WebRTC policy on and controlled by us', rtc.value === 'disable_non_proxied_udp' && rtc.levelOfControl === 'controlled_by_this_extension', `${rtc.value} / ${rtc.levelOfControl}`);

    // Settings change while connected (written the way the Settings screen does)
    await ext(page, async (x) => {
      const { settings } = await x.storage.local.get('settings');
      await x.storage.local.set({
        settings: { ...(settings ?? {}), sessionMode: 'sticky', ttlSeconds: 600, entryPoint: null, webrtcProtection: true, strict: true, bypassList: ['*.example.com', '192.168.0.0/16'] },
      });
    });
    await sleep(4000);
    const strictUser = ipChecks().at(-1)?.user ?? '';
    check('strict -> IP check reconnects with -strict-true, same sid', strictUser.endsWith('-strict-true') && sidOf(strictUser) === sidOf(first?.user), strictUser);

    if (driver.name === 'chrome') {
      const cfg = await ext(page, (x) => x.proxy.settings.get({}));
      const list = cfg.value?.rules?.bypassList ?? [];
      check('Chrome bypassList: *.example.com + example.com + range + shifter.io', ['*.example.com', 'example.com', '192.168.0.0/16', 'shifter.io'].every((h) => list.includes(h)), list.join(', '));
    }

    // Bypass list and the new login on real sites
    const n1 = log.length;
    const tab = await browser.newPage();
    await tab.goto('http://example.com/', { timeout: 20000 }).catch(() => undefined);
    await tab.goto('https://example.org/', { timeout: 20000 }).catch(() => undefined);
    await tab.evaluate(() => {
      document.cookie = 'keepme=1; max-age=3600';
    });
    const seen = log.slice(n1);
    check('bypassed site goes direct (example.com never reaches the gateway)', !seen.some((l) => /(^|[^.])example\.com/.test(l.target)), seen.map((l) => l.target).join(' '));
    const org = seen.find((l) => l.target.startsWith('example.org'));
    check('other sites use the gateway with the NEW login (strict)', !!org && org.user.endsWith('-strict-true'), org?.user);

    // New IP x8 on the same open site: every new session must reach the gateway
    let ok = 0;
    const sids = [];
    for (let i = 0; i < 8; i++) {
      await front();
      const before = await connectedUsername(page);
      await click(page, 'button[aria-label="Get a new IP"]');
      await waitFor(
        page,
        (prev) =>
          (globalThis.browser ?? globalThis.chrome).storage.local
            .get(['activeProxy', 'connection'])
            .then((s) => s.connection?.status === 'connected' && s.activeProxy?.username !== prev),
        before,
        30000,
      );
      const want = await connectedUsername(page);
      const n = log.length;
      await tab.reload({ timeout: 20000 }).catch(() => undefined);
      const got = log.slice(n).find((l) => l.target.startsWith('example.org'))?.user;
      sids.push(sidOf(got)?.slice(0, 4) ?? '-');
      if (got === want) ok++;
    }
    check('New IP x8: the open site reconnects with each new session', ok === 8, `${ok}/8 ${sids.join(',')}`);
    check("a site's own cookie survives gateway switches", (await tab.evaluate(() => document.cookie)).includes('keepme=1'));
    await tab.close();

    const latency = await ext(page, (x) => x.storage.local.get('gatewayLatency').then((s) => s.gatewayLatency));
    check('latency measured for every entry point', !!latency && Object.keys(latency.ms).length >= 4, JSON.stringify(latency?.ms));

    // 15-second exit re-check (tunnels dropped, like a network change, so it shows in the log)
    await front();
    dropTunnels();
    const c0 = ipChecks().length;
    await sleep(17000);
    check('exit IP re-checked every 15 s', ipChecks().length > c0, `${c0} -> ${ipChecks().length}`);

    // Disconnect
    await click(page, 'button[aria-label="Disconnect"]');
    await waitFor(page, () => document.body.innerText.includes('Not connected'));
    const n3 = log.length;
    const t4 = await browser.newPage();
    await t4.goto('https://example.org/', { timeout: 20000 }).catch(() => undefined);
    await t4.close();
    check('disconnect: sites no longer use the gateway', !log.slice(n3).some((l) => l.target.startsWith('example.org')), JSON.stringify(log.slice(n3)));
    const rtcAfter = await ext(page, (x) => x.privacy.network.webRTCIPHandlingPolicy.get({}));
    check('disconnect: WebRTC policy released', rtcAfter.levelOfControl === 'controllable_by_this_extension' && rtcAfter.value !== 'disable_non_proxied_udp', `${rtcAfter.value} / ${rtcAfter.levelOfControl}`);
    if (driver.name === 'chrome') {
      const cfg = await ext(page, (x) => x.proxy.settings.get({}));
      check('disconnect: Chrome proxy setting released', cfg.levelOfControl === 'controllable_by_this_extension', `${cfg.value?.mode} / ${cfg.levelOfControl}`);
    }
  } finally {
    await browser.close();
  }
}
