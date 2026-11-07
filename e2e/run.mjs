// End-to-end runner: builds the test builds, starts the stand-in Shifter,
// runs the suite in each browser, prints PASS/FAIL, exits 1 on any failure.
//
//   npm test                 chrome + firefox
//   npm test -- chrome       one browser
//   npm test -- --offline    skip the check against the real shifter.io
//   npm test -- --live-only  only the check against the real shifter.io
import { buildExtension } from './build.mjs';
import { drivers } from './drivers.mjs';
import { API_URL, GATEWAY_PORTS, start, stop } from './fake-shifter.mjs';
import { runLive, runSuite } from './suite.mjs';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const liveOnly = args.includes('--live-only');
const picked = args.filter((a) => !a.startsWith('--'));
const browsers = picked.length ? picked : Object.keys(drivers);

let failed = 0;
for (const name of browsers) {
  const driver = drivers[name];
  if (!driver) throw new Error(`unknown browser "${name}" (have: ${Object.keys(drivers).join(', ')})`);
  console.log(`\n=== ${name}: building test builds…`);
  // Stand-in API + gateway on three ports.
  const testDir = liveOnly ? null : await buildExtension({
    browser: name, env: { WXT_SHIFTER_BASE_URL: API_URL, WXT_GATEWAY_PORTS: GATEWAY_PORTS.join(',') }, outDir: 'build-test',
  });
  // Real API, with the test hook that opens the popup in a tab.
  const liveDir = offline && !liveOnly ? null
    : await buildExtension({ browser: name, env: { WXT_SHIFTER_BASE_URL: 'https://shifter.io' }, outDir: 'build-test-live' });

  const check = (label, ok, detail = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  };
  try {
    if (liveDir) await runLive(driver, liveDir, check);
    if (testDir) {
      await start();
      await runSuite(driver, testDir, check);
    }
  } catch (err) {
    failed++;
    console.log(`ERROR ${err.stack}`);
  } finally {
    stop();
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
