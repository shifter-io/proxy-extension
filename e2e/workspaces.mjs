// Local workspace regression: real popup and gateway, synthetic accounts only.
// Run: node e2e/workspaces.mjs [chrome|firefox]
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drivers } from './drivers.mjs';
import { API_URL, GATEWAY_PORTS, KEY, MEMBERSHIPS, PROXY_CONFIG, USAGE, log, start, stop } from './fake-shifter.mjs';

const evidence = process.env.WORKSPACE_TEST_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'shifter-workspaces-'));
writeFileSync(join(scratch, 'owner.json'), JSON.stringify({ owner: 'e2e/workspaces.mjs', purpose: 'Disposable local test build and TLS fixture', expires: new Date(Date.now() + 3600000).toISOString() }));
const personal = { id: 'personal', name: 'Personal', role: 'owner', personal: true };
const teams = [['viewer', 'Acme Ltd'], ['billing', 'Northstar'], ['admin', 'Studio']].map(([role, name]) => ({ id: role, name, role, personal: false }));
const empty = { id: 'empty', name: 'Workspace without plans', role: 'viewer', personal: false };
const opts = { requireWorkspaceOptIn: true };
const requests = [];
opts.onRequest = (url, headers) => requests.push({ path: url.pathname, query: url.search, ...headers });
function fixture() {
  opts.memberships = { DEMO1: { ...MEMBERSHIPS.DEMO1, workspace: personal } };
  opts.proxyConfig = { workspaces: [empty, ...teams, personal], plans: [{ ...PROXY_CONFIG.plans[0], workspace: personal }] };
  opts.usage = structuredClone(USAGE);
  for (const workspace of teams) {
    opts.memberships[workspace.id] = { ...MEMBERSHIPS.DEMO1, workspace };
    opts.proxyConfig.plans.push({ ...PROXY_CONFIG.plans[0], hash: workspace.id, username: `customer-${workspace.role}`, workspace });
    opts.usage.memberships.push({ ...USAGE.memberships[0], id: workspace.id, quota_bytes: 10e9, used_bytes: 2e9, remaining_bytes: 8e9 });
  }
  opts.memberships.isp = { ...MEMBERSHIPS.DEMO1, product: MEMBERSHIPS.YG7L.product, category: 'ISP Proxies', service: 'isp', pool: null, workspace: teams[0] };
  opts.proxyConfig.plans.push({ ...PROXY_CONFIG.plans[0], hash: 'isp', product: MEMBERSHIPS.YG7L.product, type: 'isp', host: 'localhost', proxies: [10, 11, 12, 13].map(ip => ({ username: `192.0.2.${ip}`, country: 'us', city: null, asn: null })), workspace: teams[0] });
}
let tls;
try {
  execFileSync(process.platform === 'darwin' ? '/usr/bin/openssl' : 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(scratch, 'key.pem'), '-out', join(scratch, 'cert.pem'), '-days', '1', '-subj', '/CN=ip-info.com'], { stdio: 'ignore' });
  tls = https.createServer({ key: readFileSync(join(scratch, 'key.pem')), cert: readFileSync(join(scratch, 'cert.pem')) }, (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ip: '192.0.2.20', country: 'US' }));
  });
  await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve));
  opts.tunnelPort = tls.address().port;
  await start(opts);
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(drivers)) {
    const driver = drivers[name];
    assert.ok(driver, `Unknown browser ${name}`);
    fixture();
    requests.length = 0;
    execFileSync('npx', ['wxt', 'build', ...(name === 'firefox' ? ['-b', 'firefox'] : [])], {
      cwd: root, stdio: 'pipe', env: { ...process.env, WXT_USE_MOCK: 'false', WXT_SHIFTER_BASE_URL: API_URL, WXT_GATEWAY_PORTS: GATEWAY_PORTS.join(','), WXT_OUT_DIR: join(scratch, 'build') },
    });
    const { browser, page } = await driver.launch(join(scratch, 'build', driver.build), { acceptInsecureCerts: true });
    const wait = (fn, arg) => page.waitForFunction(fn, { timeout: 20000, polling: 100 }, arg);
    const body = () => page.evaluate(() => document.body.innerText);
    const capture = async label => {
      // Firefox automation cannot capture privileged extension pages.
      if (!evidence || name !== 'chrome') return;
      await page.evaluate(() => document.fonts.ready);
      await wait(() => document.getAnimations().every(animation =>
        animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
      await page.screenshot({ path: join(evidence, `${name}-${label}.png`), clip: { x: 0, y: 0, width: 380, height: 600 } });
    };
    const call = (fn, arg) => page.evaluate(`(${fn})(globalThis.browser ?? globalThis.chrome, ${JSON.stringify(arg ?? null)})`);
    const list = async () => {
      await wait(() => document.querySelector('h3') || document.querySelector('button[aria-label="Switch membership"]'));
      await page.evaluate(() => document.querySelector('button[aria-label="Switch membership"]')?.click());
      await wait(() => !!document.querySelector('h3'));
    };
    const choose = async (title, workspaceName) => {
      await page.evaluate(({ title, workspaceName }) => {
        const section = [...document.querySelectorAll('section[aria-label]')].find(el => el.getAttribute('aria-label') === workspaceName);
        [...section.querySelectorAll('[role="button"]')].find(el => el.querySelector('h3')?.textContent === title).click();
      }, { title, workspaceName });
      await wait(() => !!document.querySelector('button[aria-label="Connect"]'));
    };
    const reload = async () => {
      await page.evaluate(() => { document.body.dataset.old = 'true'; location.reload(); });
      await wait(() => !document.body.dataset.old);
    };
    try {
      await wait(() => !!document.querySelector('input[aria-label="API key"]'));
      await page.evaluate(key => {
        const input = document.querySelector('input[aria-label="API key"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, key);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('button[type=submit]').click();
      }, KEY);
      await list();
      assert.deepEqual(await page.$$eval('h2', nodes => nodes.map(n => n.textContent)), ['Personal', 'Acme Ltd', 'Northstar', 'Studio', 'Workspace without plans']);
      assert.match(await body(), /Workspace without plans\s*No active Residential or ISP plans/);
      assert.deepEqual(await page.$$eval('h3', nodes => nodes.map(n => n.textContent)), ['Spark', 'Spark', '4 ISP Proxies', 'Spark', 'Spark']);
      console.log(`PASS ${name}: API product names stay unchanged across workspace groups`);
      await capture('workspaces');
      if (evidence && name === 'chrome') {
        await page.evaluate(() => document.querySelector('section[aria-label="Workspace without plans"]').scrollIntoView({ block: 'end' }));
        await capture('empty-workspace');
        await page.evaluate(() => document.querySelector('section[aria-label="Personal"]').scrollIntoView({ block: 'start' }));
      }
      console.log(`PASS ${name}: all workspaces retained, Personal first, empty team visible`);
      for (const workspace of teams) {
        await choose(MEMBERSHIPS.DEMO1.product, workspace.name);
        const selectedTitle = `${MEMBERSHIPS.DEMO1.product} (${workspace.name})`;
        assert.equal(await page.$eval('button[aria-label="Switch membership"] span[title]', el => el.textContent), selectedTitle);
        assert.match(await body(), /8 GB\s*\/\s*10 GB/);
        assert.ok((await body()).includes(`Traffic uses ${workspace.name}’s plan and wallet.`));
        if (workspace.role === 'viewer') await capture('selected-plan');
        const before = requests.length;
        const result = await call((api, id) => api.runtime.sendMessage({ type: 'proxy:connect', membershipId: id, target: { kind: 'residential' } }), workspace.id);
        assert.equal(result.ok, true, result.error);
        if (workspace.role === 'viewer') await capture('connected');
        assert.ok(log.some(row => row.user.startsWith(`customer-${workspace.role}-`)));
        assert.ok(requests.slice(before).some(r => r.path.endsWith('/proxy-config') && r.query === '?workspaces=all'));
        await call(api => api.runtime.sendMessage({ type: 'proxy:disconnect' }));
        await list();
        console.log(`PASS ${name}: ${workspace.role} connects with team credentials, usage and wallet attribution`);
      }
      await choose(MEMBERSHIPS.YG7L.product, teams[0].name);
      assert.equal(await page.$eval('button[aria-label="Switch membership"] span[title]', el => el.textContent), `${MEMBERSHIPS.YG7L.product} (${teams[0].name})`);
      await page.evaluate(() => document.querySelector('button[aria-label="Connect"]').click());
      await wait(() => document.body.innerText.includes('ISP proxy'));
      assert.match(await body(), /ISP proxy/);
      const ispResult = await call(api => api.runtime.sendMessage({ type: 'proxy:connect', membershipId: 'isp', target: { kind: 'isp', ip: { id: '192.0.2.10', country: 'us', isp: 'ISP proxy' } } }));
      assert.equal(ispResult.ok, true, ispResult.error);
      assert.ok(log.some(row => row.user === '192.0.2.10'));
      await call(api => api.runtime.sendMessage({ type: 'proxy:disconnect' }));
      console.log(`PASS ${name}: team ISP picker and gateway credentials`);

      // Team-only account with a single plan: auto-select it, retain access to empty workspaces.
      opts.memberships = { viewer: opts.memberships.viewer };
      opts.proxyConfig.plans = opts.proxyConfig.plans.filter(p => p.hash === 'viewer');
      await reload();
      await wait(() => !!document.querySelector('button[aria-label="Connect"]'));
      assert.ok((await body()).includes('Spark (Acme Ltd)'));
      await list();
      assert.match(await body(), /Personal\s*No active Residential or ISP plans/);
      console.log(`PASS ${name}: team-only account and single-plan workspace navigation`);
      // Revoked access removes the saved selected plan on popup reopen.
      opts.memberships = {};
      opts.proxyConfig = { plans: [], workspaces: [personal] };
      await reload();
      await wait(() => document.body.innerText.includes('No active memberships'));
      assert.equal((await call(api => api.storage.local.get('activeMembership'))).activeMembership ?? null, null);
      const revoked = await call(api => api.runtime.sendMessage({ type: 'proxy:connect', membershipId: 'viewer', target: { kind: 'residential' } }));
      assert.equal(revoked.ok, false);
      console.log(`PASS ${name}: removed access clears selection and rejects fresh credentials`);
      // A pre-deployment server ignores the parameter and sends the old shape.
      opts.memberships = MEMBERSHIPS;
      opts.proxyConfig = PROXY_CONFIG;
      opts.usage = USAGE;
      await call(api => api.runtime.sendMessage({ type: 'proxy:disconnect' }));
      await reload();
      await wait(() => !!document.querySelector('button[aria-label="Connect"]'));
      assert.match(await body(), /Spark/);
      assert.match(await body(), /3\.8 GB\s*\/\s*5 GB/);
      assert.doesNotMatch(await body(), /Traffic uses/);
      const legacyHome = await body();

      // A Personal-only response must look identical to the pre-workspace API.
      opts.memberships = { DEMO1: { ...MEMBERSHIPS.DEMO1, workspace: personal } };
      opts.proxyConfig = { plans: [{ ...PROXY_CONFIG.plans[0], workspace: personal }], workspaces: [personal] };
      await reload();
      await wait(() => !!document.querySelector('button[aria-label="Connect"]'));
      assert.equal(await body(), legacyHome);
      assert.equal(await page.$('button[aria-label="Switch membership"]'), null);
      await capture('personal-home');

      // More than one personal plan still uses the original ungrouped picker.
      const isp = { ...MEMBERSHIPS.YG7L, service: 'isp', category: 'ISP Proxies' };
      const ispConfig = { ...PROXY_CONFIG.plans[0], hash: 'isp', type: 'isp', proxies: [] };
      opts.memberships = { DEMO1: MEMBERSHIPS.DEMO1, isp };
      opts.proxyConfig = { plans: [...PROXY_CONFIG.plans, ispConfig] };
      await reload();
      await list();
      const legacyList = await body();
      opts.memberships = { DEMO1: { ...MEMBERSHIPS.DEMO1, workspace: personal }, isp: { ...isp, workspace: personal } };
      opts.proxyConfig = { plans: opts.proxyConfig.plans.map(plan => ({ ...plan, workspace: personal })), workspaces: [personal] };
      await reload();
      await list();
      assert.equal(await body(), legacyList);
      assert.doesNotMatch(await body(), /Personal|Traffic uses/);
      assert.equal(await page.$('section[aria-label="Memberships"]'), null);
      await capture('personal-plans');
      console.log(`PASS ${name}: Personal-only home and multiple-plan picker match legacy UI without workspace labels`);
      for (const path of ['/memberships', '/proxy-config']) {
        const matching = requests.filter(r => r.path.endsWith(path));
        assert.ok(matching.length > 0);
        assert.ok(matching.every(r => r.query === '?workspaces=all' && r.hasApiKey));
      }
      assert.ok(requests.filter(r => r.path.endsWith('/usage')).every(r => r.query === ''));
      console.log(`PASS ${name}: legacy responses, exact opt-in, X-Api-Key and unfiltered usage`);
    } finally {
      await browser.close();
    }
  }
} finally {
  stop();
  tls?.closeAllConnections();
  tls?.close();
  rmSync(scratch, { recursive: true, force: true });
}
