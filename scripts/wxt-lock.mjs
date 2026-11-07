// One WXT build at a time per checkout. WXT rewrites .wxt/tsconfig.json on
// every build whose output folder differs, so two builds (or a build and tsc)
// at the same moment can read a half-written file.
//
//   import { withWxtLock } from './wxt-lock.mjs';
//   await withWxtLock(() => build());
//
//   node scripts/wxt-lock.mjs <command> [args...]
//     runs the command holding the lock and exits with its exit code
//     (128 + signal number if it was killed).
//
// The lock is a folder made with an atomic mkdir, holding the owner's pid.
// A lock whose owner is no longer alive is taken over. Waiting past the
// limit throws: nothing ever builds unlocked.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LOCK_DIR = join(ROOT, 'node_modules', '.cache', 'wxt-build.lock');
const POLL_MS = 100;
const WAIT_LIMIT_MS = 5 * 60_000;

export class WxtLockTimeout extends Error {
  constructor(lockDir, waitedMs) {
    super(`waited ${Math.round(waitedMs / 1000)} s for the WXT build lock ${lockDir}; `
      + 'if no build is running, remove that folder');
    this.name = 'WxtLockTimeout';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

/** The owner's pid, or null while the owner is between mkdir and writing it. */
function ownerOf(lockDir) {
  try {
    const pid = Number(readFileSync(join(lockDir, 'pid'), 'utf8'));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function tryCreate(lockDir) {
  try {
    mkdirSync(lockDir);
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  writeFileSync(join(lockDir, 'pid'), String(process.pid));
  return true;
}

// Only one waiter removes a dead owner's lock, and only after checking again
// that the lock still names that dead pid (another waiter may have removed it
// and a live process taken it in between).
function reapIfDead(lockDir) {
  const pid = ownerOf(lockDir);
  if (pid === null || isAlive(pid)) return;
  const guard = `${lockDir}.reap`;
  if (!tryCreate(guard)) return;
  try {
    if (ownerOf(lockDir) === pid && !isAlive(pid)) rmSync(lockDir, { recursive: true, force: true });
  } finally {
    rmSync(guard, { recursive: true, force: true });
  }
}

/** Runs `fn` holding the lock; releases it when `fn` settles. */
export async function withWxtLock(fn, { lockDir = LOCK_DIR, waitLimitMs = WAIT_LIMIT_MS } = {}) {
  mkdirSync(dirname(lockDir), { recursive: true });
  const started = Date.now();
  while (!tryCreate(lockDir)) {
    reapIfDead(lockDir);
    if (Date.now() - started >= waitLimitMs) throw new WxtLockTimeout(lockDir, Date.now() - started);
    await sleep(POLL_MS);
  }
  try {
    return await fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/** Exit code of `command args`: its own, or 128 + signal number if it was killed. */
export function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? 128 + constants.signals[signal]));
  });
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('usage: node scripts/wxt-lock.mjs <command> [args...]');
    process.exit(2);
  }
  try {
    process.exitCode = await withWxtLock(() => runCommand(command, args));
  } catch (err) {
    console.error(`wxt-lock: ${err.message}`);
    process.exitCode = 1;
  }
}
