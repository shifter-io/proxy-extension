// The CI parts (README.md, "Continuous integration"): ci.yml's gate job runs
// them all at once with scripts/ci/run-parts.mjs after its setup steps.
// Timeouts are in seconds. Each end-to-end part has its own E2E_PORT_BASE, so
// the stand-in Shifters never share a port; the browser binaries come from the
// setup steps (CHROME_BIN, FIREFOX_BIN), and every WXT build holds the build
// lock (scripts/wxt-lock.mjs).
const BIN = { chrome: process.env.CHROME_BIN ?? '', firefox: process.env.FIREFOX_BIN ?? '' };

const e2e = (name, browser, run, timeout, port) => ({
  name,
  run,
  timeout,
  env: { E2E_PORT_BASE: String(port), PUPPETEER_EXECUTABLE_PATH: BIN[browser] },
});

// [name, command for one browser, timeout, Chrome's E2E_PORT_BASE]; Firefox's is 10 above.
const SUITES = [
  ['suite', (browser) => ['npm', 'run', 'e2e', '--', browser, '--offline'], 600, 20000],
  ['toolbar', (browser) => ['node', 'e2e/toolbar.mjs', browser], 360, 20020],
  ['usage', (browser) => ['node', 'e2e/usage.mjs', browser], 360, 20040],
  ['workspaces', (browser) => ['node', 'e2e/workspaces.mjs', browser], 360, 20060],
];

const suiteParts = SUITES.flatMap(([name, run, timeout, port]) => [
  e2e(`${name}-chrome`, 'chrome', run('chrome'), timeout, port),
  e2e(`${name}-firefox`, 'firefox', run('firefox'), timeout, port + 10),
]);

const docsHint = 'docs/ is out of date: run python3 scripts/render-readme.py and commit the result';

export default [
  {
    name: 'docs',
    run: `python3 scripts/render-readme.py\ngit diff --exit-code --stat -- docs/ || { echo "${docsHint}"; exit 1; }`,
    env: { PYTHONUTF8: '1' },
    timeout: 120,
  },
  {
    name: 'actionlint',
    // ci-2cpu to ci-32cpu are the self-hosted runners' labels.
    run: `"$ACTIONLINT" -color -ignore 'label "ci-[0-9]+cpu" is unknown'`,
    timeout: 120,
  },
  { name: 'compile', run: ['node', 'scripts/wxt-lock.mjs', 'npm', 'run', 'compile'], timeout: 300 },
  {
    name: 'builds',
    run: [
      'node scripts/wxt-lock.mjs npm run build',
      'node scripts/wxt-lock.mjs npm run build:firefox',
      'node scripts/wxt-lock.mjs npx wxt build -b edge',
      'node scripts/wxt-lock.mjs npm run build:mock',
    ].join('\n'),
    timeout: 300,
  },
  { name: 'selftest', run: ['node', '--test', 'scripts/**/*.test.mjs'], timeout: 120 },
  ...suiteParts,
  // The Chrome and Edge builds, both in Chrome.
  e2e('cookies', 'chrome', ['node', 'e2e/cookies.mjs'], 360, 20080),
];
