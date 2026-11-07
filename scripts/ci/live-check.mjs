// The real shifter.io check for scheduled CI runs. It tells a shifter.io
// outage apart from a real failure: an outage exits 0 with a warning (the
// check did not run, which is never reported as a pass); a failure exits 1.
//
//   node scripts/ci/live-check.mjs
//
// 1. Probe GET $LIVE_CHECK_URL/api/v1/user/me (default https://shifter.io)
//    with a fixed invalid key, outside the browser.
// 2. 401: shifter.io is up; run the live suite in Chrome and Firefox at the
//    same time (PUPPETEER_EXECUTABLE_PATH from CHROME_BIN and FIREFOX_BIN).
//    Both pass: passed. One fails: probe again; still 401: failed, otherwise
//    no answer, 5xx or 429: outage.
// 3. No answer, 5xx or 429: outage; the browsers are not started.
// 4. Anything else: failed.
//
// Writes result= and outage= to $GITHUB_OUTPUT and one line to
// $GITHUB_STEP_SUMMARY when they are set. No credentials are used.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BAD_KEY = 'x'.repeat(64);
const TIMEOUT_MS = 15000;
const BROWSERS = { chrome: 'CHROME_BIN', firefox: 'FIREFOX_BIN' };

/** One request with the invalid key: { status } or { error } when nothing answered. */
export async function probe(url, timeoutMs = TIMEOUT_MS) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${BAD_KEY}`, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    return { status: res.status };
  } catch (err) {
    return { error: err.cause?.code ?? err.cause?.message ?? err.name };
  }
}

/** up (401), down (no answer, 5xx, 429) or invalid (anything else). */
export function classify(answer) {
  if (answer.status === 401) return 'up';
  if (answer.status === undefined || answer.status >= 500 || answer.status === 429) return 'down';
  return 'invalid';
}

const describe = (answer) => (answer.status === undefined ? `no answer (${answer.error})` : String(answer.status));
const down = (answer) => `shifter.io did not answer: ${describe(answer)}`;
const invalid = (answer) => `shifter.io answered ${answer.status} to an invalid key; expected 401`;

/** Runs a command; resolves { ok, log } with its stdout and stderr together. */
export function runCommand(cmd, args, options) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('error', (err) => resolve({ ok: false, log: `${log}${err.message}\n` }));
    child.on('close', (code) => resolve({ ok: code === 0, log }));
  });
}

/** The live suite in one browser, with the browser binary from CHROME_BIN or FIREFOX_BIN. */
export function runBrowser(browser, env = process.env, run = runCommand) {
  const bin = env[BROWSERS[browser]];
  if (!bin) return Promise.resolve({ ok: false, log: `${BROWSERS[browser]} is not set\n` });
  const childEnv = { ...env, PUPPETEER_EXECUTABLE_PATH: bin };
  return run('npm', ['run', 'e2e', '--', browser, '--live-only'], { cwd: ROOT, env: childEnv });
}

async function decide(probe, runBrowser, url, out) {
  const first = await probe(url);
  const probes = [first];
  const kind = classify(first);
  if (kind === 'down') return { result: 'outage', rule: `${down(first)}; browsers not started`, probes };
  if (kind === 'invalid') return { result: 'failed', rule: invalid(first), probes };

  const names = Object.keys(BROWSERS);
  const runs = await Promise.all(names.map((name) => runBrowser(name)));
  runs.forEach((run, i) => {
    out.log(`::group::${names[i]} live suite: ${run.ok ? 'passed' : 'failed'}`);
    out.log(run.log.trimEnd());
    out.log('::endgroup::');
  });
  const failedNames = names.filter((_, i) => !runs[i].ok);
  if (!failedNames.length) return { result: 'passed', rule: 'shifter.io answered 401; both browsers passed', probes };

  const again = await probe(url);
  probes.push(again);
  const broke = `${failedNames.join(' and ')} failed`;
  const kindAgain = classify(again);
  if (kindAgain === 'down') return { result: 'outage', rule: `${broke}, then ${down(again)}`, probes };
  if (kindAgain === 'invalid') return { result: 'failed', rule: `${broke}, then ${invalid(again)}`, probes };
  return { result: 'failed', rule: `${broke} while shifter.io answers 401`, probes };
}

/** The whole check; returns the exit code. */
export async function main({ probe, runBrowser, out, env = process.env }) {
  const url = `${env.LIVE_CHECK_URL || 'https://shifter.io'}/api/v1/user/me`;
  out.log(`live check: probing ${url}`);
  const { result, rule, probes } = await decide(probe, runBrowser, url, out);

  if (result === 'passed') out.log(`live check passed: ${rule}`);
  if (result === 'outage') out.log(`::warning::live check NOT RUN: external outage: ${rule}`);
  if (result === 'failed') out.log(`::error::live check failed: ${rule}`);
  if (env.GITHUB_OUTPUT) out.append(env.GITHUB_OUTPUT, `result=${result}\noutage=${result === 'outage'}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    out.append(env.GITHUB_STEP_SUMMARY, `live check: ${result}: ${rule} (probe answers: ${probes.map(describe).join(', ')})\n`);
  }
  return result === 'failed' ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main({ probe, runBrowser, out: { log: console.log, append: appendFileSync } });
}
