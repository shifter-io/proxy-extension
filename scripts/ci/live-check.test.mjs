// node --test scripts/ci/live-check.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify, main, probe, runBrowser, runCommand } from './live-check.mjs';

/** Probe answers in sequence; records the URLs asked. */
function fakeProbe(...answers) {
  const urls = [];
  const fn = async (url) => {
    urls.push(url);
    assert.ok(answers.length, 'probed more often than expected');
    return answers.shift();
  };
  return Object.assign(fn, { urls });
}

/** Browser runs: { chrome: true, firefox: false } passes Chrome and fails Firefox. */
function fakeBrowsers(results) {
  const started = [];
  const fn = async (name) => {
    started.push(name);
    return { ok: results[name], log: `${name} log\n` };
  };
  return Object.assign(fn, { started });
}

function fakeOut() {
  const lines = [];
  const files = {};
  return {
    lines,
    files,
    log: (line) => lines.push(line),
    append: (file, text) => (files[file] = (files[file] ?? '') + text),
  };
}

async function check({ answers, browsers = { chrome: true, firefox: true }, env = {} }) {
  const p = fakeProbe(...answers);
  const b = fakeBrowsers(browsers);
  const out = fakeOut();
  const env2 = { GITHUB_OUTPUT: 'out', GITHUB_STEP_SUMMARY: 'summary', ...env };
  const code = await main({ probe: p, runBrowser: b, out, env: env2 });
  const text = out.lines.join('\n');
  return { code, text, out, started: b.started, urls: p.urls, output: out.files.out, summary: out.files.summary };
}

test('401 and both browsers pass: passed', async () => {
  const r = await check({ answers: [{ status: 401 }] });
  assert.equal(r.code, 0);
  assert.deepEqual(r.started.sort(), ['chrome', 'firefox']);
  assert.match(r.text, /live check passed: shifter.io answered 401; both browsers passed/);
  assert.match(r.text, /::group::chrome live suite: passed\nchrome log\n::endgroup::/);
  assert.match(r.text, /::group::firefox live suite: passed\nfirefox log\n::endgroup::/);
  assert.equal(r.output, 'result=passed\noutage=false\n');
  assert.equal(r.summary, 'live check: passed: shifter.io answered 401; both browsers passed (probe answers: 401)\n');
  assert.deepEqual(r.urls, ['https://shifter.io/api/v1/user/me']);
});

test('LIVE_CHECK_URL replaces the default', async () => {
  const r = await check({ answers: [{ status: 401 }], env: { LIVE_CHECK_URL: 'http://127.0.0.1:9' } });
  assert.deepEqual(r.urls, ['http://127.0.0.1:9/api/v1/user/me']);
});

test('a browser fails and the probe still answers 401: failed', async () => {
  const r = await check({ answers: [{ status: 401 }, { status: 401 }], browsers: { chrome: true, firefox: false } });
  assert.equal(r.code, 1);
  assert.match(r.text, /::group::firefox live suite: failed/);
  assert.match(r.text, /::error::live check failed: firefox failed while shifter.io answers 401/);
  assert.equal(r.output, 'result=failed\noutage=false\n');
  assert.match(r.summary, /\(probe answers: 401, 401\)\n$/);
});

for (const [label, again] of [
  ['no answer', { error: 'ECONNREFUSED' }],
  ['5xx', { status: 502 }],
  ['429', { status: 429 }],
]) {
  test(`a browser fails and the probe then gets ${label}: outage`, async () => {
    const r = await check({ answers: [{ status: 401 }, again], browsers: { chrome: false, firefox: false } });
    assert.equal(r.code, 0);
    assert.match(r.text, /::warning::live check NOT RUN: external outage: chrome and firefox failed, then shifter.io did not answer/);
    assert.equal(r.output, 'result=outage\noutage=true\n');
  });
}

test('a browser fails and the probe then gets another answer: failed', async () => {
  const r = await check({ answers: [{ status: 401 }, { status: 200 }], browsers: { chrome: false, firefox: true } });
  assert.equal(r.code, 1);
  assert.match(r.text, /::error::live check failed: chrome failed, then shifter.io answered 200 to an invalid key; expected 401/);
});

for (const [label, first, shown] of [
  ['no answer', { error: 'TimeoutError' }, 'no answer \\(TimeoutError\\)'],
  ['503', { status: 503 }, '503'],
  ['429', { status: 429 }, '429'],
]) {
  test(`the probe gets ${label}: outage, browsers not started`, async () => {
    const r = await check({ answers: [first] });
    assert.equal(r.code, 0);
    assert.deepEqual(r.started, []);
    assert.match(r.text, new RegExp(`::warning::live check NOT RUN: external outage: shifter.io did not answer: ${shown}; browsers not started`));
    assert.equal(r.output, 'result=outage\noutage=true\n');
    assert.match(r.summary, new RegExp(`\\(probe answers: ${shown}\\)\\n$`));
  });
}

for (const status of [200, 302, 403, 404]) {
  test(`the probe gets ${status}: failed, browsers not started`, async () => {
    const r = await check({ answers: [{ status }] });
    assert.equal(r.code, 1);
    assert.deepEqual(r.started, []);
    assert.match(r.text, new RegExp(`::error::live check failed: shifter.io answered ${status} to an invalid key; expected 401`));
    assert.equal(r.output, 'result=failed\noutage=false\n');
  });
}

test('without GITHUB_OUTPUT and GITHUB_STEP_SUMMARY nothing is written', async () => {
  const out = fakeOut();
  const code = await main({ probe: fakeProbe({ status: 401 }), runBrowser: fakeBrowsers({ chrome: true, firefox: true }), out, env: {} });
  assert.equal(code, 0);
  assert.deepEqual(out.files, {});
});

test('classify', () => {
  assert.equal(classify({ status: 401 }), 'up');
  for (const a of [{ error: 'ENOTFOUND' }, { status: 500 }, { status: 503 }, { status: 429 }]) assert.equal(classify(a), 'down');
  for (const s of [200, 204, 301, 400, 403, 404]) assert.equal(classify({ status: s }), 'invalid');
});

/** A local server answering every request with `status` after `delayMs`; records the request headers. */
async function server(status, delayMs = 0) {
  const seen = [];
  const srv = createServer((req, res) => {
    seen.push(req.headers);
    setTimeout(() => res.writeHead(status, status === 302 ? { Location: '/elsewhere' } : {}).end('{}'), delayMs);
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${srv.address().port}/api/v1/user/me`;
  return { url, seen, close: () => new Promise((resolve) => srv.close(resolve).closeAllConnections()) };
}

for (const status of [401, 503, 429, 200, 302]) {
  test(`probe against a server answering ${status}`, async () => {
    const s = await server(status);
    try {
      assert.deepEqual(await probe(s.url, 2000), { status });
      assert.equal(s.seen[0].authorization, `Bearer ${'x'.repeat(64)}`);
      assert.equal(s.seen[0].accept, 'application/json');
    } finally {
      await s.close();
    }
  });
}

test('probe against a closed port: no answer', async () => {
  const s = await server(200);
  await s.close();
  assert.deepEqual(await probe(s.url, 2000), { error: 'ECONNREFUSED' });
});

test('probe refused by fetch itself: the reason is kept', async () => {
  assert.deepEqual(await probe('http://127.0.0.1:9/api/v1/user/me', 2000), { error: 'bad port' });
});

test('probe against a server slower than the timeout: no answer', async () => {
  const s = await server(401, 1000);
  try {
    assert.deepEqual(await probe(s.url, 100), { error: 'TimeoutError' });
  } finally {
    await s.close();
  }
});

test('runBrowser runs the live suite with the browser binary from CHROME_BIN or FIREFOX_BIN', async () => {
  const calls = [];
  const run = async (cmd, args, options) => (calls.push({ cmd, args, options }), { ok: true, log: '' });
  const env = { CHROME_BIN: '/opt/chrome', FIREFOX_BIN: '/opt/firefox', PUPPETEER_EXECUTABLE_PATH: '/other', KEEP: '1' };
  await runBrowser('chrome', env, run);
  await runBrowser('firefox', env, run);
  assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]), [
    ['npm', 'run', 'e2e', '--', 'chrome', '--live-only'],
    ['npm', 'run', 'e2e', '--', 'firefox', '--live-only'],
  ]);
  assert.equal(calls[0].options.env.PUPPETEER_EXECUTABLE_PATH, '/opt/chrome');
  assert.equal(calls[1].options.env.PUPPETEER_EXECUTABLE_PATH, '/opt/firefox');
  assert.equal(calls[0].options.env.KEEP, '1');
  assert.equal(calls[0].options.cwd, fileURLToPath(new URL('../..', import.meta.url)));
});

test('runBrowser fails without the browser binary', async () => {
  const run = async () => assert.fail('must not run');
  assert.deepEqual(await runBrowser('firefox', { CHROME_BIN: '/opt/chrome' }, run), { ok: false, log: 'FIREFOX_BIN is not set\n' });
});

test('runCommand collects stdout and stderr and reports the exit code', async () => {
  const ok = await runCommand(process.execPath, ['-e', 'console.log("out"); console.error("err")']);
  assert.equal(ok.ok, true);
  assert.match(ok.log, /out/);
  assert.match(ok.log, /err/);
  const bad = await runCommand(process.execPath, ['-e', 'console.log("boom"); process.exit(3)']);
  assert.deepEqual(bad, { ok: false, log: 'boom\n' });
});

test('runCommand reports a command that cannot start', async () => {
  const r = await runCommand('/nonexistent/live-check-command', []);
  assert.equal(r.ok, false);
  assert.match(r.log, /ENOENT/);
});
