// node --test scripts/wxt-lock.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LOCK_DIR, WxtLockTimeout, withWxtLock } from './wxt-lock.mjs';

const CLI = fileURLToPath(new URL('wxt-lock.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'wxt-lock-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
const freshLock = () => join(scratch, `lock-${++n}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

function lockedBy(lockDir, pid) {
  mkdirSync(lockDir);
  if (pid !== undefined) writeFileSync(join(lockDir, 'pid'), String(pid));
}

const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('holders in one process never overlap', async () => {
  const lockDir = freshLock();
  let active = 0;
  let most = 0;
  const hold = async () => {
    most = Math.max(most, ++active);
    await sleep(30);
    active--;
  };
  await Promise.all(Array.from({ length: 5 }, () => withWxtLock(hold, { lockDir })));
  assert.equal(most, 1);
  assert.equal(existsSync(lockDir), false);
});

test('holders in separate processes (the CLI) never overlap', async () => {
  const trace = join(scratch, 'trace');
  const holder = (id) => `const fs = require('node:fs');
    fs.appendFileSync(${JSON.stringify(trace)}, 'start ${id}\\n');
    setTimeout(() => fs.appendFileSync(${JSON.stringify(trace)}, 'end ${id}\\n'), 150);`;
  const runs = [1, 2, 3].map((id) => new Promise((resolve) => {
    spawn(process.execPath, [CLI, process.execPath, '-e', holder(id)], { stdio: 'inherit' }).on('exit', resolve);
  }));
  assert.deepEqual(await Promise.all(runs), [0, 0, 0]);
  const lines = readFileSync(trace, 'utf8').trim().split('\n');
  assert.equal(lines.length, 6);
  for (let i = 0; i < lines.length; i += 2) {
    assert.equal(lines[i].replace('start', 'end'), lines[i + 1], `overlap in ${lines.join(', ')}`);
  }
  assert.equal(existsSync(LOCK_DIR), false);
});

test('a lock left by a dead process is taken over', async () => {
  const lockDir = freshLock();
  lockedBy(lockDir, deadPid());
  assert.equal(await withWxtLock(() => 'built', { lockDir, waitLimitMs: 2000 }), 'built');
  assert.equal(existsSync(lockDir), false);
});

test('waiters on a dead lock take it over one at a time', async () => {
  const lockDir = freshLock();
  lockedBy(lockDir, deadPid());
  let active = 0;
  let most = 0;
  const hold = async () => {
    most = Math.max(most, ++active);
    await sleep(20);
    active--;
  };
  await Promise.all(Array.from({ length: 4 }, () => withWxtLock(hold, { lockDir, waitLimitMs: 5000 })));
  assert.equal(most, 1);
});

test('waiting past the limit throws instead of going on unlocked', async () => {
  const lockDir = freshLock();
  lockedBy(lockDir, process.pid);
  let ran = false;
  await assert.rejects(withWxtLock(() => { ran = true; }, { lockDir, waitLimitMs: 300 }), WxtLockTimeout);
  assert.equal(ran, false);
  assert.equal(readFileSync(join(lockDir, 'pid'), 'utf8'), String(process.pid), 'a live owner keeps its lock');
});

test('a lock still being written (no pid yet) counts as held', async () => {
  const lockDir = freshLock();
  lockedBy(lockDir);
  await assert.rejects(withWxtLock(() => {}, { lockDir, waitLimitMs: 300 }), WxtLockTimeout);
});

test('while another waiter removes a dead lock, the rest keep waiting', async () => {
  const lockDir = freshLock();
  lockedBy(lockDir, deadPid());
  mkdirSync(`${lockDir}.reap`);
  await assert.rejects(withWxtLock(() => {}, { lockDir, waitLimitMs: 300 }), WxtLockTimeout);
  rmSync(`${lockDir}.reap`, { recursive: true });
  await withWxtLock(() => {}, { lockDir, waitLimitMs: 2000 });
});

test('the lock is released when the work fails', async () => {
  const lockDir = freshLock();
  await assert.rejects(withWxtLock(() => { throw new Error('build broke'); }, { lockDir }), /build broke/);
  assert.equal(existsSync(lockDir), false);
});

test('the CLI passes exit codes and signals through', () => {
  assert.equal(cli(process.execPath, '-e', 'process.exit(0)').status, 0);
  assert.equal(cli(process.execPath, '-e', 'process.exit(3)').status, 3);
  assert.equal(cli(process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')").status, 128 + 15);
});

test('the CLI explains a missing or unknown command', () => {
  const usage = cli();
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: node scripts\/wxt-lock\.mjs <command>/);
  const unknown = cli('no-such-command-wxt-lock-test');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /wxt-lock: .*ENOENT/);
});
