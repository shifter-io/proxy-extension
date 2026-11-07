// Tests for run-parts.mjs: node --test scripts/ci/run-parts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { SLOW_PART_SECONDS, countPassLines, main, report } from './run-parts.mjs';

const SCRIPT = fileURLToPath(new URL('./run-parts.mjs', import.meta.url));
const SLOW_SKIP = 'not run: slow (merge queue and scheduled runs only)';

// A fresh directory with the parts module (a list, or the module's source text).
function workdir(parts) {
  const dir = mkdtempSync(join(tmpdir(), 'run-parts-'));
  const module = join(dir, 'parts.mjs');
  writeFileSync(module, typeof parts === 'string' ? parts : `export default ${JSON.stringify(parts)};\n`);
  return { dir, module, logs: join(dir, 'logs') };
}

function sink() {
  const stream = { text: '', write: (chunk) => { stream.text += chunk; return true; } };
  return stream;
}

// Runs main() in this process. Parts find their work directory in $WORK.
async function run(parts, args = [], env = {}) {
  const work = workdir(parts);
  const out = sink();
  const err = sink();
  const started = performance.now();
  const argv = ['--parts', work.module, '--logs', work.logs, ...args];
  const code = await main(argv, { out, err, env: { ...process.env, WORK: work.dir, ...env } });
  const seconds = (performance.now() - started) / 1000;
  const log = (name) => readFileSync(join(work.logs, `${name}.log`), 'utf8');
  return { ...work, code, out: out.text, err: err.text, seconds, log };
}

// True once the process is gone (or a zombie no one has reaped yet).
function gone(pid) {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim().startsWith('Z');
  } catch (error) {
    if (error.status === 1) return true;
    throw error;
  }
}

async function waitFor(check, what) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

const readPid = (dir) => Number(readFileSync(join(dir, 'pid'), 'utf8').trim());
const pidWritten = (dir) => () => existsSync(join(dir, 'pid')) && readPid(dir) > 0;

test('every part runs at once and a failure does not stop the others', async () => {
  const r = await run([
    { name: 'ok', run: 'sleep 1; echo PASS one; echo PASS two; echo other', timeout: 30 },
    { name: 'bad', run: ['bash', '-c', 'echo broken >&2; exit 3'], timeout: 30 },
    { name: 'late', run: 'sleep 1; echo finished', timeout: 30 },
  ]);
  assert.equal(r.code, 1);
  assert.ok(r.seconds < 2.5, `three 1 s parts took ${r.seconds} s`);
  assert.equal(r.log('late'), 'finished\n');
  assert.equal(r.log('bad'), 'broken\n');
  assert.match(r.out, /::error title=bad::exit code 3\n/);
  assert.match(r.out, /::group::late \(passed, \d+\.\d s\)\nfinished\n::endgroup::/);
  assert.ok(r.out.indexOf('::group::bad') > r.out.indexOf('::group::late'), 'failed parts come last');
  assert.ok(r.out.indexOf('::group::bad') > r.out.indexOf('::group::ok'), 'failed parts come last');
  assert.match(r.out, /\| ok \| passed \| \d+\.\d \| 2 \|/);
  assert.match(r.out, /\| bad \| failed: exit code 3 \| \d+\.\d \| 0 \|/);
  assert.match(r.out, /Wall time: \d+\.\d s/);
});

test('every part passing exits 0 and appends the table to the step summary', async () => {
  const summary = join(mkdtempSync(join(tmpdir(), 'run-parts-summary-')), 'summary.md');
  writeFileSync(summary, 'before\n');
  const r = await run([{ name: 'a', run: 'echo PASS x; echo "PASS y"; echo " PASS no"', timeout: 30 }], [], {
    GITHUB_STEP_SUMMARY: summary,
  });
  assert.equal(r.code, 0);
  const text = readFileSync(summary, 'utf8');
  assert.ok(text.startsWith('before\n| Part | Result | Seconds | PASS lines |\n'));
  assert.match(text, /\| a \| passed \| \d+\.\d \| 2 \|\n\nWall time: /);
  assert.ok(!r.out.includes('::error'));
});

test('an argv part runs without a shell; env is added to the environment', async () => {
  const r = await run([
    { name: 'argv', run: [process.execPath, '-e', 'console.log(process.argv[1])', '$HOME * ;'], timeout: 30 },
    { name: 'env', run: 'echo "$RP_ADDED:${HOME:+home}"', env: { RP_ADDED: 'added' }, timeout: 30 },
  ]);
  assert.equal(r.code, 0);
  assert.equal(r.log('argv'), '$HOME * ;\n');
  assert.equal(r.log('env'), 'added:home\n');
});

test('a string part runs with bash -eo pipefail', async () => {
  const r = await run([
    { name: 'pipe', run: 'false | true; echo unreachable', timeout: 30 },
    { name: 'errexit', run: 'false; echo unreachable', timeout: 30 },
  ]);
  assert.equal(r.code, 1);
  assert.equal(r.log('pipe'), '');
  assert.equal(r.log('errexit'), '');
  assert.match(r.out, /::error title=pipe::exit code 1/);
});

test('a part past its timeout fails and its whole process group is killed', async () => {
  const r = await run([{ name: 'hang', run: 'sleep 300 & echo $! > "$WORK/pid"; wait', timeout: 0.5 }]);
  assert.equal(r.code, 1);
  assert.match(r.out, /::error title=hang::timed out after 0\.5 s/);
  assert.match(r.out, /\| hang \| failed: timed out after 0\.5 s \|/);
  await waitFor(() => gone(readPid(r.dir)), 'the background sleep to end');
});

test('a part that ignores SIGTERM gets SIGKILL 5 s later', { timeout: 30000 }, async () => {
  const r = await run([{ name: 'stubborn', run: 'trap "" TERM; sleep 300 & echo $! > "$WORK/pid"; wait', timeout: 0.5 }]);
  assert.equal(r.code, 1);
  assert.ok(r.seconds >= 5.4, `ended after ${r.seconds} s`);
  assert.match(r.out, /::error title=stubborn::timed out after 0\.5 s/);
  await waitFor(() => gone(readPid(r.dir)), 'the background sleep to end');
});

test('a part that ends by a signal fails', async () => {
  const r = await run([{ name: 'sig', run: 'kill -USR1 $$', timeout: 30 }]);
  assert.equal(r.code, 1);
  assert.match(r.out, /::error title=sig::killed by SIGUSR1/);
});

test('a passing part leaves nothing running behind', async () => {
  const r = await run([{ name: 'leaky', run: 'sleep 300 & echo $! > "$WORK/pid"', timeout: 30 }]);
  assert.equal(r.code, 0);
  await waitFor(() => gone(readPid(r.dir)), 'the leftover sleep to end');
});

test('a command that cannot start fails with the reason in its log', async () => {
  const r = await run([
    { name: 'missing', run: ['/nonexistent/run-parts-command'], timeout: 30 },
    { name: 'nul', run: ['echo', 'a\u0000b'], timeout: 30 },
    { name: 'fine', run: 'echo ok', timeout: 30 },
  ]);
  assert.equal(r.code, 1);
  assert.match(r.out, /::error title=nul::could not start: /);
  assert.match(r.out, /::error title=missing::could not start: spawn \/nonexistent\/run-parts-command ENOENT/);
  assert.match(r.log('missing'), /^run-parts: could not start: /);
  assert.equal(r.log('fine'), 'ok\n');
});

test('slow parts run only with --slow', async () => {
  const parts = [
    { name: 'quick', run: 'echo quick', timeout: 30 },
    { name: 'heavy', run: 'echo heavy', timeout: 30, slow: true },
  ];
  const without = await run(parts);
  assert.equal(without.code, 0);
  assert.ok(without.out.includes(`heavy: ${SLOW_SKIP}\n`));
  assert.ok(without.out.includes(`| heavy | ${SLOW_SKIP} |  |  |`));
  assert.ok(!existsSync(join(without.logs, 'heavy.log')));
  const withSlow = await run(parts, ['--slow']);
  assert.equal(withSlow.code, 0);
  assert.equal(withSlow.log('heavy'), 'heavy\n');
  assert.ok(!withSlow.out.includes(SLOW_SKIP));
});

test('--only runs just the named parts', async () => {
  const r = await run([
    { name: 'a', run: 'echo a', timeout: 30 },
    { name: 'b', run: 'echo b', timeout: 30 },
    { name: 'c', run: 'exit 1', timeout: 30 },
  ], ['--only', 'a, b']);
  assert.equal(r.code, 0);
  assert.equal(r.log('b'), 'b\n');
  assert.ok(!existsSync(join(r.logs, 'c.log')));
});

test('--list prints the part names and marks the slow ones', async () => {
  const work = workdir([
    { name: 'quick', run: 'exit 1', timeout: 30 },
    { name: 'heavy', run: 'exit 1', timeout: 30, slow: true },
  ]);
  const out = sink();
  const code = await main(['--parts', work.module, '--list'], { out, err: sink(), env: process.env });
  assert.equal(code, 0);
  assert.equal(out.text, 'quick\nheavy (slow)\n');
});

const usageCases = [
  ['an unknown --only name', [{ name: 'a', run: 'true', timeout: 1 }], ['--only', 'a,zz'], /unknown part: zz/],
  ['an empty --only', [{ name: 'a', run: 'true', timeout: 1 }], ['--only', ' , '], /no part selected/],
  ['only slow parts without --slow', [{ name: 'a', run: 'true', timeout: 1, slow: true }], [], /every selected part is slow/],
  ['a duplicate name', [{ name: 'a', run: 'true', timeout: 1 }, { name: 'a', run: 'true', timeout: 1 }], [], /duplicate part name: a/],
  ['an empty list', [], [], /non-empty array/],
  ['a default export that is not a list', 'export default { name: "a" };\n', [], /non-empty array/],
  ['a module that does not load', 'export default [;\n', [], /cannot load/],
  ['a part that is not an object', ['true'], [], /part 1: is not an object/],
  ['an unknown key', [{ name: 'a', run: 'true', timeout: 1, retries: 2 }], [], /unknown key retries/],
  ['a bad name', [{ name: '../a', run: 'true', timeout: 1 }], [], /part 1: name must be/],
  ['an empty run', [{ name: 'a', run: [], timeout: 1 }], [], /a: run must be/],
  ['a run with a non-string argument', [{ name: 'a', run: ['echo', 1], timeout: 1 }], [], /a: run must be/],
  ['a missing timeout', [{ name: 'a', run: 'true' }], [], /a: timeout must be/],
  ['a zero timeout', [{ name: 'a', run: 'true', timeout: 0 }], [], /a: timeout must be/],
  ['a slow flag that is not a boolean', [{ name: 'a', run: 'true', timeout: 1, slow: 'yes' }], [], /a: slow must be/],
  ['env with a non-string value', [{ name: 'a', run: 'true', timeout: 1, env: { X: 1 } }], [], /a: env must/],
  ['an unknown option', [{ name: 'a', run: 'true', timeout: 1 }], ['--fast'], /Unknown option '--fast'/],
];

for (const [what, parts, args, message] of usageCases) {
  test(`${what} exits 2 before anything starts`, async () => {
    const r = await run(parts, args);
    assert.equal(r.code, 2);
    assert.match(r.err, message);
    assert.match(r.err, /usage: node scripts\/ci\/run-parts\.mjs/);
    assert.ok(!existsSync(r.logs), 'no log directory: nothing started');
    assert.equal(r.out, '');
  });
}

test('--parts and --logs are required', async () => {
  for (const [argv, message] of [[[], /--parts <module> is required/], [['--parts', 'x.mjs'], /--logs <dir> is required/]]) {
    const err = sink();
    assert.equal(await main(argv, { out: sink(), err, env: process.env }), 2);
    assert.match(err.text, message);
  }
});

test('a log directory that cannot be written exits 2 before anything starts', async () => {
  const work = workdir([{ name: 'a', run: 'echo started > "$WORK/started"', timeout: 30 }]);
  writeFileSync(work.logs, 'a file, not a directory');
  const err = sink();
  const code = await main(['--parts', work.module, '--logs', work.logs], { out: sink(), err, env: process.env });
  assert.equal(code, 2);
  assert.match(err.text, /cannot write the logs to /);
  assert.ok(!existsSync(join(work.dir, 'started')));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} to the runner kills every part and exits 1`, { timeout: 30000 }, async () => {
    const work = workdir([
      { name: 'hang', run: 'sleep 300 & echo $! > "$WORK/pid"; wait', timeout: 600 },
      { name: 'other', run: ['sleep', '300'], timeout: 600 },
    ]);
    const runner = spawn(process.execPath, [SCRIPT, '--parts', work.module, '--logs', work.logs], {
      env: { ...process.env, WORK: work.dir },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    runner.stderr.on('data', (chunk) => { stderr += chunk; });
    await waitFor(pidWritten(work.dir), 'the part to start');
    runner.kill(signal);
    const [code] = await once(runner, 'exit');
    assert.equal(code, 1);
    assert.match(stderr, new RegExp(`${signal}: killed 2 running part`));
    await waitFor(() => gone(readPid(work.dir)), 'the part to be killed');
  });
}

test('report warns about a part over the slow limit that is not marked slow', () => {
  const over = SLOW_PART_SECONDS + 1;
  const { log, summary } = report([
    { name: 'long', slow: false, status: 'passed', reason: null, seconds: over, output: 'x\n', passLines: 0 },
    { name: 'marked', slow: true, status: 'passed', reason: null, seconds: over, output: '', passLines: 0 },
    { name: 'odd', slow: false, status: 'failed', reason: 'a|b\n100%', seconds: 1, output: '', passLines: 0 },
  ], over);
  assert.match(log, /::warning title=long::long took 61\.0 s; a part over 60 s must be marked slow/);
  assert.ok(!log.includes('title=marked'));
  assert.ok(log.includes('::error title=odd::a|b%0A100%25'));
  assert.ok(summary.includes('| odd | failed: a\\|b 100% |'));
  assert.ok(log.endsWith(summary));
});

test('countPassLines counts only lines that start with PASS', () => {
  assert.equal(countPassLines('PASS a\n PASS b\nFAIL c\nPASSED d\nok PASS\n'), 2);
  assert.equal(countPassLines(''), 0);
});
