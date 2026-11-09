// Tests for fetch-tools.sh and the nightly image hook .github/ciod/prefetch.sh:
// node --test scripts/ci/fetch-tools.test.mjs
// curl and npm are stand-ins on PATH that log their calls; curl serves files
// from a fixtures folder by the URL's last segment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FETCH = join(ROOT, 'scripts/ci/fetch-tools.sh');
const HOOK = join(ROOT, '.github/ciod/prefetch.sh');
const RETRY = '-fsSL --retry 6 --retry-delay 10 --retry-all-errors';

const FAKE_CURL = `#!/bin/bash
echo "curl $*" >> "$FAKE_LOG"
while [ $# -gt 1 ]; do [ "$1" = -o ] && out="$2"; shift; done
cp "$FIXTURES/\${1##*/}" "$out" 2>/dev/null || exit 22
`;
const FAKE_NPM = `#!/bin/bash
echo "npm $* in $PWD cache=$npm_config_cache" >> "$FAKE_LOG"
test -f package.json && test -f package-lock.json
`;

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const tar = (args, cwd) => assert.equal(spawnSync('tar', args, { cwd }).status, 0, `tar ${args.join(' ')}`);

// A scratch cache, fake curl and npm, and release archives for actionlint
// 9.9.9 and Firefox 99.0.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'fetch-tools-'));
  const bin = join(dir, 'bin');
  const fixtures = join(dir, 'fixtures');
  const build = join(dir, 'build');
  for (const d of [bin, fixtures, join(build, 'firefox')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(bin, 'curl'), FAKE_CURL);
  writeFileSync(join(bin, 'npm'), FAKE_NPM);
  writeFileSync(join(build, 'actionlint'), '#!/bin/sh\n');
  writeFileSync(join(build, 'README.md'), 'not unpacked\n');
  writeFileSync(join(build, 'firefox', 'firefox'), '#!/bin/sh\n');
  for (const f of ['curl', 'npm']) chmodSync(join(bin, f), 0o755);
  for (const f of ['actionlint', 'firefox/firefox']) chmodSync(join(build, f), 0o755);
  const actionlint = join(fixtures, 'actionlint_9.9.9_linux_amd64.tar.gz');
  const firefox = join(fixtures, 'firefox-99.0.tar.xz');
  tar(['-czf', actionlint, 'actionlint', 'README.md'], build);
  tar(['-cJf', firefox, 'firefox'], build);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CI_CACHE_DIR: join(dir, 'cache'),
    FIXTURES: fixtures,
    FAKE_LOG: join(dir, 'calls.log'),
    ACTIONLINT_VERSION: '9.9.9',
    ACTIONLINT_SHA256: sha256(actionlint),
    FIREFOX_VERSION: '99.0',
    FIREFOX_SHA256: sha256(firefox),
  };
  const tools = join(dir, 'cache', 'proxy-extension', 'tools');
  const calls = () => (existsSync(env.FAKE_LOG) ? readFileSync(env.FAKE_LOG, 'utf8').trim().split('\n') : []);
  return { dir, env, tools, calls };
}

function run(script, args, env, cwd = ROOT) {
  const r = spawnSync('bash', [script, ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
}

const executable = (file) => existsSync(file) && (statSync(file).mode & 0o111) !== 0;

test('downloads a missing tool with retries, verifies it, and takes it from the cache next time', () => {
  const s = sandbox();
  const first = run(FETCH, ['actionlint'], s.env);
  assert.equal(first.code, 0, first.err);
  assert.equal(first.out, join(s.tools, 'actionlint-9.9.9'));
  assert.ok(executable(join(first.out, 'actionlint')));
  assert.deepEqual(readdirSync(first.out), ['actionlint']);
  assert.equal(s.calls().length, 1);
  assert.ok(s.calls()[0].startsWith(`curl ${RETRY} -o `), s.calls()[0]);
  assert.match(first.err, /checksum verified/);

  const second = run(FETCH, ['actionlint'], s.env);
  assert.equal(second.code, 0, second.err);
  assert.equal(second.out, first.out);
  assert.equal(s.calls().length, 1, 'a cached tool is never downloaded');
  assert.match(second.err, /actionlint 9\.9\.9: from the cache/);
});

test('unpacks Firefox and removes the other cached versions', () => {
  const s = sandbox();
  mkdirSync(join(s.tools, 'firefox-98.0', 'firefox'), { recursive: true });
  mkdirSync(join(s.tools, 'actionlint-1.0.0'), { recursive: true });
  const r = run(FETCH, ['firefox'], s.env);
  assert.equal(r.code, 0, r.err);
  assert.ok(executable(join(r.out, 'firefox', 'firefox')));
  assert.deepEqual(readdirSync(s.tools).sort(), ['actionlint-1.0.0', 'firefox-99.0']);
});

test('a checksum mismatch fails and leaves no tool and no partial download', () => {
  const s = sandbox();
  const r = run(FETCH, ['actionlint'], { ...s.env, ACTIONLINT_SHA256: '0'.repeat(64) });
  assert.notEqual(r.code, 0);
  assert.deepEqual(readdirSync(s.tools), []);
});

test('a failed download fails the step', () => {
  const s = sandbox();
  const r = run(FETCH, ['firefox'], { ...s.env, FIREFOX_VERSION: '100.0' });
  assert.notEqual(r.code, 0);
  assert.deepEqual(readdirSync(s.tools), []);
});

test('an unknown tool or a missing pin fails', () => {
  const s = sandbox();
  assert.equal(run(FETCH, ['shellcheck'], s.env).code, 2);
  const { ACTIONLINT_SHA256: _, ...env } = s.env;
  const r = run(FETCH, ['actionlint'], env);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /ACTIONLINT_SHA256/);
});

// A read-only stand-in checkout: ci.yml with the pins in its top-level env:
// block (and a decoy in a job), the fetch helper, and both lockfiles.
function checkout(s, envBlock) {
  const src = join(s.dir, 'src');
  mkdirSync(join(src, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(src, 'scripts', 'ci'), { recursive: true });
  mkdirSync(join(src, 'e2e'), { recursive: true });
  writeFileSync(join(src, '.github', 'workflows', 'ci.yml'), `name: ci\nenv:\n${envBlock}jobs:\n  gate:\n    env:\n      ACTIONLINT_VERSION: 0.0.0\n`);
  cpSync(FETCH, join(src, 'scripts', 'ci', 'fetch-tools.sh'));
  for (const d of ['', 'e2e']) {
    writeFileSync(join(src, d, 'package.json'), '{}\n');
    writeFileSync(join(src, d, 'package-lock.json'), '{}\n');
  }
  const env = { ...s.env };
  for (const k of ['ACTIONLINT_VERSION', 'ACTIONLINT_SHA256', 'FIREFOX_VERSION', 'FIREFOX_SHA256']) delete env[k];
  return { src, env };
}

const pins = (s) =>
  ['ACTIONLINT_VERSION', 'ACTIONLINT_SHA256', 'FIREFOX_VERSION', 'FIREFOX_SHA256'].map((k) => `  ${k}: ${s.env[k]}\n`).join('');

test('the hook fills the tools from the pins in ci.yml and the npm cache from both lockfiles', () => {
  const s = sandbox();
  const { src, env } = checkout(s, `  # a comment\n  NODE_VERSION: 24.21.0\n${pins(s)}`);
  const cache = join(s.env.CI_CACHE_DIR, 'proxy-extension');
  const first = run(HOOK, [], env, src);
  assert.equal(first.code, 0, first.err);
  assert.ok(executable(join(s.tools, 'actionlint-9.9.9', 'actionlint')));
  assert.ok(executable(join(s.tools, 'firefox-99.0', 'firefox', 'firefox')));
  const npm = s.calls().filter((c) => c.startsWith('npm '));
  assert.equal(npm.length, 2);
  for (const [i, sub] of [[0, ''], [1, '/e2e']]) {
    assert.match(npm[i], new RegExp(`^npm ci --ignore-scripts in ${cache}/\\.npm-[^/ ]+${sub} cache=${cache}/npm$`));
  }
  assert.deepEqual(readdirSync(cache).sort(), ['npm', 'tools'], 'the scratch folder is removed');

  const second = run(HOOK, [], env, src);
  assert.equal(second.code, 0, second.err);
  assert.equal(s.calls().filter((c) => c.startsWith('curl ')).length, 2, 'the second run downloads no tool');
});

test('the hook fails when ci.yml lacks a pin', () => {
  const s = sandbox();
  const { src, env } = checkout(s, pins(s).replace(/ {2}FIREFOX_SHA256:.*\n/, ''));
  const r = run(HOOK, [], env, src);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /FIREFOX_SHA256 is not in ci\.yml's env: block/);
  assert.deepEqual(s.calls(), []);
});
