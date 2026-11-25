// node --test scripts/i18n/check.test.mjs
// Runs the translation gate (check.mjs) on a copy of src/ with one planted
// mistake each time, and checks it reports exactly that mistake.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { keysIn, ROOT } from './lib.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'i18n-check-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
/** A copy of the repo's src/ and scripts/i18n/; `plant(dir)` adds the mistake. */
function checkWith(plant = () => undefined) {
  const dir = join(scratch, `repo-${++n}`);
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'scripts/i18n'), join(dir, 'scripts/i18n'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  plant(dir);
  const run = spawnSync(process.execPath, [join(dir, 'scripts/i18n/check.mjs')], { encoding: 'utf8' });
  return { status: run.status, out: run.stdout + run.stderr };
}

const addFile = (name, text) => (dir) => writeFileSync(join(dir, 'src', name), text);

test('keysIn: t() and tf() literals are keys, a template with ${} is a problem', () => {
  const { keys, problems } = keysIn("t('Hello there'); tf(\"Hi {name}\", { name }); t(`Plain`); t(`Hi ${name}`);");
  assert.deepEqual(keys, ['Hello there', 'Hi {name}', 'Plain']);
  assert.deepEqual(problems, ['t(`Hi ${']);
});

test('the repository as it is passes', () => {
  const { status, out } = checkWith();
  assert.equal(status, 0, out);
  assert.match(out, /i18n check passed/);
});

test('a new t() key is extracted and reported missing from every catalog', () => {
  const { status, out } = checkWith(addFile('planted.ts', "export const s = () => t('Planted new key');\n"));
  assert.equal(status, 1);
  for (const code of ['es', 'zh-Hans', 'de', 'fr', 'ja', 'ko', 'pt-BR']) {
    assert.match(out, new RegExp(`${code}: 1 missing keys, first: "Planted new key"`));
  }
});

test('t() with a ${} template is reported', () => {
  const { status, out } = checkWith(addFile('planted.ts', 'export const s = (x: string) => t(`Hello ${x}`);\n'));
  assert.equal(status, 1);
  assert.match(out, /src\/planted\.ts: t\(\) needs a plain literal/);
});

test('a placeholder mismatch in a catalog is reported', () => {
  const key = 'Follows your browser: {language}';
  const { status, out } = checkWith((dir) => {
    const path = join(dir, 'src/locales/de.json');
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(catalog[key], 'fixture key is in de.json');
    catalog[key] = 'Folgt deinem Browser: {sprache}';
    writeFileSync(path, JSON.stringify(catalog, null, 2));
  });
  assert.equal(status, 1);
  assert.match(out, /de: placeholders differ for "Follows your browser: \{language\}"/);
});

test('unwrapped JSX text and a title= literal are flagged', () => {
  const tsx = 'export const P = () => <p title="Open the settings">Hello world</p>;\n';
  const { status, out } = checkWith(addFile('Planted.tsx', tsx));
  assert.equal(status, 1);
  assert.match(out, /src\/Planted\.tsx:1: JSX text not wrapped in t\(\): "Hello world"/);
  assert.match(out, /src\/Planted\.tsx:1: title text not wrapped in t\(\): "Open the settings"/);
});

test('the same text inside t() passes the code guard', () => {
  const tsx = "export const P = () => <p title={t('Settings')}>{t('Settings')}</p>;\n";
  const { status, out } = checkWith(addFile('Planted.tsx', tsx));
  assert.equal(status, 0, out);
});
