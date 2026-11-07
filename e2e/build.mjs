// The one way e2e scripts build the extension: `wxt build` for one browser,
// holding the WXT build lock (scripts/wxt-lock.mjs), so scripts running side
// by side never build at the same moment.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { withWxtLock } from '../scripts/wxt-lock.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Builds for `browser` (chrome, edge, firefox) into `outDir` (relative to the
 * repository root, or absolute) with the extra `env`; returns the build folder.
 */
export async function buildExtension({ browser, env = {}, outDir }) {
  const args = ['wxt', 'build', ...(browser === 'chrome' ? [] : ['-b', browser])];
  await withWxtLock(() => promisify(execFile)('npx', args, {
    cwd: ROOT, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env, WXT_OUT_DIR: outDir },
  }));
  return resolve(ROOT, outDir, `${browser}-${browser === 'firefox' ? 'mv2' : 'mv3'}`);
}
