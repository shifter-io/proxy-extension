// Local regression for shifter.io cookies and cached proxy credentials.
// No real account or public website is contacted. Runs Chrome and Edge builds
// in Chrome for Testing; pass an installed Edge binary as EDGE_EXECUTABLE
// to additionally exercise Edge itself.
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drivers } from './drivers.mjs';
import { API_URL, GATEWAY_PORTS, KEY, log, start, stop } from './fake-shifter.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const certDir = mkdtempSync(join(tmpdir(), 'shifter-cookie-test-'));
execFileSync(process.env.OPENSSL ?? (process.platform === 'darwin' ? '/usr/bin/openssl' : 'openssl'), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(certDir, 'key.pem'),
  '-out', join(certDir, 'cert.pem'), '-days', '1', '-subj', '/CN=shifter.io'], { stdio: 'ignore' });
const dashboardRequests = [];
const cookies = {
  shifter_session: 'session-fixture', remember_web: 'remember-fixture',
  _ga: 'analytics-fixture', _gcl_aw: 'attribution-fixture', language: 'en',
};
const server = https.createServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.headers.host?.startsWith('ip-info.com')) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ip: '192.0.2.10', country: 'US' }));
  }
  if (req.headers.host?.startsWith('shifter.io')) {
    if (req.url === '/login') {
      res.setHeader('Set-Cookie', Object.entries(cookies).map(([name, value]) =>
        `${name}=${value}; Domain=shifter.io; Path=/; Secure; SameSite=Lax; Max-Age=3600${name === 'shifter_session' || name === 'remember_web' ? '; HttpOnly' : ''}`));
    }
    dashboardRequests.push(req.headers.cookie ?? '');
    return res.end(req.headers.cookie?.includes('shifter_session=session-fixture') ? 'Signed in' : 'Login');
  }
  res.end('Proxied test page');
});
await new Promise(resolve => server.listen(18443, '127.0.0.1', resolve));

try {
  for (const name of ['chrome', 'edge']) {
    execFileSync('npx', ['wxt', 'build', '-b', name], {
      cwd: root, stdio: 'pipe', env: { ...process.env, WXT_USE_MOCK: 'false', WXT_SHIFTER_BASE_URL: API_URL,
        WXT_GATEWAY_PORTS: GATEWAY_PORTS.join(','), WXT_OUT_DIR: 'build-test/cookies' },
    });
    const launchOptions = {
      // Resolver overrides apply only to this isolated test browser profile.
      args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP *.shifter.io 127.0.0.1, MAP shifter.io 127.0.0.1, MAP example.org 127.0.0.1'],
      ...(name === 'edge' && process.env.EDGE_EXECUTABLE ? { executablePath: process.env.EDGE_EXECUTABLE } : {}),
    };
    await start({ gatewayHosts: ['p.shifter.io', 'fra.p.shifter.io', 'ams.p.shifter.io', 'lon.p.shifter.io'], tunnelPort: 18443 });
    const { browser, page } = await drivers.chrome.launch(`${root}build-test/cookies/${name}-mv3`, launchOptions);
    try {
      const call = (fn, arg) => page.evaluate(fn, arg);
      await page.waitForSelector('input[aria-label="API key"]');
      await call(key => {
        const input = document.querySelector('input[aria-label="API key"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, key);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('button[type=submit]').click();
      }, KEY);
      await page.waitForSelector('button[aria-label="Connect"]');
      const permissions = await call(() => chrome.runtime.getManifest().permissions);
      assert.ok(!permissions.includes('browsingData'));
      const dashboard = await browser.newPage();
      await dashboard.goto('https://shifter.io:18443/login');
      const baseline = (await dashboard.cookies()).sort((a, b) => a.name.localeCompare(b.name));
      assert.equal(baseline.length, Object.keys(cookies).length);
      const verifyCookies = async label => {
        await dashboard.goto('https://shifter.io:18443/dashboard');
        assert.equal(await dashboard.evaluate(() => document.body.innerText), 'Signed in');
        assert.deepEqual((await dashboard.cookies()).sort((a, b) => a.name.localeCompare(b.name)), baseline);
        for (const [key, value] of Object.entries(cookies)) assert.ok(dashboardRequests.at(-1).includes(`${key}=${value}`));
        console.log(`PASS ${name}: dashboard session and all five cookies survive ${label}`);
      };
      const site = await browser.newPage();
      const connect = async country => {
        const target = { kind: 'residential', country: { code: country, name: country.toUpperCase() } };
        const response = await call(target => chrome.runtime.sendMessage({ type: 'proxy:connect', membershipId: 'DEMO1', target }), target);
        assert.equal(response.ok, true, response.error);
        const { activeProxy } = await call(() => chrome.storage.local.get('activeProxy'));
        assert.ok(activeProxy.username.includes(`-country-${country}`));
        const before = log.length;
        await site.goto('https://example.org:18443/');
        const observed = log.slice(before).find(entry => entry.target === 'example.org:18443');
        assert.equal(observed?.user, activeProxy.username, 'new and previously open sites must use the new credentials');
        return activeProxy;
      };
      const first = await connect('us');
      await verifyCookies('connect');
      const second = await connect('de');
      assert.notEqual(second.host, first.host);
      await verifyCookies('first location switch');
      const third = await connect('ro');
      assert.notEqual(third.host, second.host);
      await verifyCookies('second location switch');
      const fourth = await connect('ro');
      assert.notEqual(fourth.username, third.username);
      await verifyCookies('new session');

      // A settings change reuses the sticky session but changes its username.
      await page.bringToFront();
      await call(async () => {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, sessionMode: 'rotating' } });
      });
      await page.waitForFunction(async () => {
        const { connection, activeProxy } = await chrome.storage.local.get(['connection', 'activeProxy']);
        return connection?.status === 'connected' && !activeProxy.username.includes('-sid-');
      }, { polling: 200 });
      const { activeProxy: rotating } = await call(() => chrome.storage.local.get('activeProxy'));
      const beforeRotating = log.length;
      await site.reload();
      assert.equal(log.slice(beforeRotating).find(entry => entry.target === 'example.org:18443')?.user, rotating.username);
      await verifyCookies('switch to rotating sessions');

      await call(() => chrome.runtime.sendMessage({ type: 'proxy:disconnect' }));
      await verifyCookies('disconnect');
      const beforeDisconnect = log.length;
      await site.reload();
      assert.equal(log.slice(beforeDisconnect).filter(entry => entry.target === 'example.org:18443').length, 0);
      const config = await call(() => chrome.proxy.settings.get({}));
      assert.notEqual(config.levelOfControl, 'controlled_by_this_extension');
      console.log(`PASS ${name}: disconnect stops proxy use by an already open site`);

      // Exhaustion must fail explicitly, never report a stale location as live.
      await call(async () => {
        const rememberedLogins = {};
        for (const host of ['p.shifter.io', 'fra.p.shifter.io', 'ams.p.shifter.io', 'lon.p.shifter.io']) {
          for (const port of [18081, 18082, 18083]) rememberedLogins[`${host}:${port}`] = { username: 'old-login', at: 1 };
        }
        await chrome.storage.local.set({ rememberedLogins });
      });
      const exhausted = await call(() => chrome.runtime.sendMessage({ type: 'proxy:connect', membershipId: 'DEMO1', target: { kind: 'residential' } }));
      assert.equal(exhausted.ok, false);
      assert.match(exhausted.error, /Restart your browser/);
      await verifyCookies('exhausted gateway pool');
      console.log(`PASS ${name}: exhausted addresses require restart; no stale connection is reported`);
    } finally {
      await browser.close();
      stop();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  rmSync(certDir, { recursive: true, force: true });
}
