// End-to-end runner: builds the test builds, starts the stand-in Shifter,
// runs the suite in each browser, prints PASS/FAIL, exits 1 on any failure.
//
//   npm test                 chrome + firefox
//   npm test -- chrome       one browser
//   npm test -- --offline    skip the check against the real shifter.io
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { drivers } from './drivers.mjs';
import { API_URL, GATEWAY_PORTS, start, stop } from './fake-shifter.mjs';
import { runLive, runSuite } from './suite.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const picked = args.filter((a) => !a.startsWith('--'));
const browsers = picked.length ? picked : Object.keys(drivers);

function build(browser, env, outDir) {
  const flag = browser === 'firefox' ? ' -b firefox' : '';
  execSync(`npx wxt build${flag}`, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, ...env, WXT_OUT_DIR: outDir } });
  return `${ROOT}${outDir}/${drivers[browser].build}`;
}

let failed = 0;
for (const name of browsers) {
  const driver = drivers[name];
  if (!driver) throw new Error(`unknown browser "${name}" (have: ${Object.keys(drivers).join(', ')})`);
  console.log(`\n=== ${name}: building test builds…`);
  // Stand-in API + gateway on three ports.
  const testDir = build(name, { WXT_SHIFTER_BASE_URL: API_URL, WXT_GATEWAY_PORTS: GATEWAY_PORTS.join(',') }, 'build-test');
  // Real API, with the test hook that opens the popup in a tab.
  const liveDir = offline ? null : build(name, { WXT_SHIFTER_BASE_URL: 'https://shifter.io' }, 'build-test-live');

  const check = (label, ok, detail = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  };
  try {
    if (liveDir) await runLive(driver, liveDir, check);
    await start();
    await runSuite(driver, testDir, check);
  } catch (err) {
    failed++;
    console.log(`ERROR ${err.stack}`);
  } finally {
    stop();
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
