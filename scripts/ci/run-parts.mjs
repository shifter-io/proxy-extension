#!/usr/bin/env node
// Runs independent CI parts at the same time and reports each one.
//
// usage: node scripts/ci/run-parts.mjs --parts <module> --logs <dir> [--slow] [--only <name,...>] [--list]
//
// <module> default-exports an array of parts { name, run, env?, timeout, slow? }.
// run is an argv array (spawned without a shell) or a string (run with
// bash -eo pipefail -c); timeout is in seconds; env is added to the runner's
// environment. Every selected part starts at once in its own process group,
// with stdout and stderr in <logs>/<name>.log, and every part runs to its end:
// a failure never stops the others. A part past its timeout gets SIGTERM on its
// whole group, then SIGKILL 5 s later. Whatever a part leaves running when it
// ends is killed with it. Parts marked slow run only with --slow.
//
// Exit status: 0 when every selected part passed, 1 otherwise, 2 for a usage
// error (bad arguments or a malformed part list; nothing has started then).
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// A part that takes longer than this must be marked slow (RULES.md, "Quality").
export const SLOW_PART_SECONDS = 60;
const KILL_GRACE_MS = 5000;
// setTimeout's limit is about 24.8 days; no CI part comes near a day.
const MAX_TIMEOUT_SECONDS = 86400;
const SLOW_SKIP = 'not run: slow (merge queue and scheduled runs only)';
const PART_KEYS = new Set(['name', 'run', 'env', 'timeout', 'slow']);
// The name is also the log file's name.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const USAGE = 'usage: node scripts/ci/run-parts.mjs --parts <module> --logs <dir> [--slow] [--only <name,...>] [--list]';

export class UsageError extends Error {}

export function parseCli(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        parts: { type: 'string' },
        logs: { type: 'string' },
        slow: { type: 'boolean', default: false },
        only: { type: 'string' },
        list: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (!values.parts) throw new UsageError('--parts <module> is required');
  if (!values.list && !values.logs) throw new UsageError('--logs <dir> is required');
  return values;
}

async function loadParts(path) {
  let module;
  try {
    module = await import(pathToFileURL(resolve(path)).href);
  } catch (error) {
    throw new UsageError(`cannot load ${path}: ${error.message}`);
  }
  return validateParts(module.default);
}

export function validateParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new UsageError('the parts module must default-export a non-empty array');
  }
  const seen = new Set();
  parts.forEach((part, index) => {
    const problem = partProblem(part);
    if (problem) throw new UsageError(`part ${index + 1}: ${problem}`);
    if (seen.has(part.name)) throw new UsageError(`duplicate part name: ${part.name}`);
    seen.add(part.name);
  });
  return parts;
}

function partProblem(part) {
  if (part === null || typeof part !== 'object' || Array.isArray(part)) return 'is not an object';
  const unknown = Object.keys(part).filter((key) => !PART_KEYS.has(key));
  if (unknown.length > 0) return `unknown key ${unknown.join(', ')}`;
  if (typeof part.name !== 'string' || !NAME.test(part.name)) {
    return 'name must be letters, digits, ".", "_" or "-", starting with a letter or digit';
  }
  const { run } = part;
  const isArgv = Array.isArray(run) && run.length > 0 && run[0] !== '' && run.every((arg) => typeof arg === 'string');
  const isScript = typeof run === 'string' && run.trim() !== '';
  if (!isArgv && !isScript) return `${part.name}: run must be a non-empty argv array or a non-empty string`;
  if (typeof part.timeout !== 'number' || !(part.timeout > 0 && part.timeout <= MAX_TIMEOUT_SECONDS)) {
    return `${part.name}: timeout must be a number of seconds above 0 and at most ${MAX_TIMEOUT_SECONDS}`;
  }
  if (part.slow !== undefined && typeof part.slow !== 'boolean') return `${part.name}: slow must be true or false`;
  const env = part.env;
  const isEnv = env !== null && typeof env === 'object' && !Array.isArray(env)
    && Object.values(env).every((value) => typeof value === 'string');
  if (env !== undefined && !isEnv) return `${part.name}: env must map variable names to strings`;
  return null;
}

// The parts to run and the slow parts left out, in the module's order.
export function selectParts(parts, { only, slow }) {
  let chosen = parts;
  if (only !== undefined) {
    const names = only.split(',').map((name) => name.trim()).filter(Boolean);
    const known = new Set(parts.map((part) => part.name));
    const unknown = names.filter((name) => !known.has(name));
    if (unknown.length > 0) throw new UsageError(`unknown part: ${unknown.join(', ')}`);
    chosen = parts.filter((part) => names.includes(part.name));
  }
  const run = chosen.filter((part) => slow || !part.slow);
  const skipped = chosen.filter((part) => !slow && part.slow);
  if (chosen.length === 0) throw new UsageError('no part selected');
  if (run.length === 0) throw new UsageError('every selected part is slow; add --slow to run them');
  return { run, skipped };
}

export function listText(parts) {
  return parts.map((part) => (part.slow ? `${part.name} (slow)\n` : `${part.name}\n`)).join('');
}

function killGroup(pid, signal, err) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    // ESRCH: the group is already gone.
    if (error.code !== 'ESRCH') err.write(`run-parts: cannot send ${signal} to process group ${pid}: ${error.message}\n`);
  }
}

function failureReason(code, signal, timedOut, timeout) {
  if (timedOut) return `timed out after ${timeout} s`;
  if (signal) return `killed by ${signal}`;
  return code === 0 ? null : `exit code ${code}`;
}

function startPart(part, fd, env) {
  const [command, args] = typeof part.run === 'string'
    ? ['bash', ['-eo', 'pipefail', '-c', part.run]]
    : [part.run[0], part.run.slice(1)];
  return spawn(command, args, { detached: true, stdio: ['ignore', fd, fd], env: { ...env, ...part.env } });
}

// Runs one part to its end; resolves with its result and never rejects.
function runPart(part, fd, running, io) {
  return new Promise((done) => {
    const started = performance.now();
    let child;
    let timedOut = false;
    let killTimer;
    let timer;
    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      killGroup(child?.pid, 'SIGKILL', io.err);
      running.delete(child?.pid);
      if (reason?.startsWith('could not start')) writeSync(fd, `run-parts: ${reason}\n`);
      closeSync(fd);
      const seconds = (performance.now() - started) / 1000;
      done({ name: part.name, slow: part.slow === true, status: reason ? 'failed' : 'passed', reason, seconds });
    };
    try {
      child = startPart(part, fd, io.env);
    } catch (error) {
      finish(`could not start: ${error.message}`);
      return;
    }
    if (child.pid) running.add(child.pid);
    timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid, 'SIGTERM', io.err);
      killTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL', io.err), KILL_GRACE_MS);
    }, part.timeout * 1000);
    child.once('error', (error) => finish(`could not start: ${error.message}`));
    child.once('exit', (code, signal) => finish(failureReason(code, signal, timedOut, part.timeout)));
  });
}

export function countPassLines(text) {
  return text.split('\n').filter((line) => line.startsWith('PASS')).length;
}

const secs = (seconds) => seconds.toFixed(1);
// Workflow command data: https://docs.github.com/actions/reference/workflow-commands-for-github-actions
const commandData = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

function resultText(result) {
  if (result.status === 'skipped') return SLOW_SKIP;
  return result.status === 'failed' ? `failed: ${result.reason}` : 'passed';
}

function summaryTable(results, wallSeconds) {
  const rows = results.map((result) => {
    const ran = result.status !== 'skipped';
    const text = resultText(result).replaceAll('|', '\\|').replace(/\s*\n\s*/g, ' ');
    const cells = [result.name, text, ran ? secs(result.seconds) : '', ran ? result.passLines : ''];
    return `| ${cells.join(' | ')} |`;
  });
  const head = ['| Part | Result | Seconds | PASS lines |', '| --- | --- | ---: | ---: |'];
  return [...head, ...rows, '', `Wall time: ${secs(wallSeconds)} s`, ''].join('\n');
}

function groupLines(result) {
  const lines = [`::group::${result.name} (${result.status}, ${secs(result.seconds)} s)`];
  if (result.output) lines.push(result.output.replace(/\n$/, ''));
  lines.push('::endgroup::');
  if (result.status === 'failed') lines.push(`::error title=${result.name}::${commandData(result.reason)}`);
  return lines;
}

// results: { name, slow, status: passed|failed|skipped, reason, seconds, output, passLines }.
// Returns the step's log text and the Markdown summary (also part of the log).
export function report(results, wallSeconds) {
  const ran = results.filter((result) => result.status !== 'skipped');
  const lines = [
    ...ran.filter((result) => result.status === 'passed').flatMap(groupLines),
    ...results.filter((result) => result.status === 'skipped').map((result) => `${result.name}: ${SLOW_SKIP}`),
    ...ran.filter((result) => result.status === 'failed').flatMap(groupLines),
  ];
  for (const result of ran) {
    if (!result.slow && result.seconds > SLOW_PART_SECONDS) {
      lines.push(`::warning title=${result.name}::${result.name} took ${secs(result.seconds)} s; `
        + `a part over ${SLOW_PART_SECONDS} s must be marked slow`);
    }
  }
  const summary = summaryTable(results, wallSeconds);
  return { log: `${lines.join('\n')}\n\n${summary}`, summary };
}

async function runAll(selected, skipped, logs, io) {
  // Every log opens before any part starts, so a bad log directory stops the run cleanly.
  let fds;
  try {
    mkdirSync(logs, { recursive: true });
    fds = selected.map((part) => openSync(join(logs, `${part.name}.log`), 'w'));
  } catch (error) {
    throw new UsageError(`cannot write the logs to ${logs}: ${error.message}`);
  }
  const running = new Set();
  const stop = (signal) => {
    for (const pid of running) killGroup(pid, 'SIGKILL', io.err);
    io.err.write(`run-parts: ${signal}: killed ${running.size} running part(s)\n`);
    process.exit(1);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  io.out.write(`run-parts: running ${selected.map((part) => part.name).join(', ')}\n`);
  const started = performance.now();
  let finished;
  try {
    finished = await Promise.all(selected.map(async (part, index) => {
      const result = await runPart(part, fds[index], running, io);
      io.out.write(`run-parts: ${result.name} ${result.status} (${secs(result.seconds)} s)\n`);
      const output = readFileSync(join(logs, `${part.name}.log`), 'utf8');
      return { ...result, output, passLines: countPassLines(output) };
    }));
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  const wallSeconds = (performance.now() - started) / 1000;
  const results = [...finished, ...skipped.map((part) => ({ name: part.name, slow: true, status: 'skipped' }))];
  const { log, summary } = report(results, wallSeconds);
  io.out.write(log);
  if (io.env.GITHUB_STEP_SUMMARY) appendFileSync(io.env.GITHUB_STEP_SUMMARY, summary);
  return finished.every((result) => result.status === 'passed') ? 0 : 1;
}

export async function main(argv, io = { out: process.stdout, err: process.stderr, env: process.env }) {
  try {
    const options = parseCli(argv);
    const parts = await loadParts(options.parts);
    if (options.list) {
      io.out.write(listText(parts));
      return 0;
    }
    const { run, skipped } = selectParts(parts, options);
    return await runAll(run, skipped, options.logs, io);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err.write(`run-parts: ${error.message}\n${USAGE}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
