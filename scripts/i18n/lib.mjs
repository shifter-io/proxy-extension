// Shared by keys.mjs, check.mjs, translate.mjs and audit.mjs: where the
// catalogs live and how keys are read from the source.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = join(ROOT, 'src');
export const LOCALES_DIR = join(SRC, 'locales');
export const EXTRA_KEYS = join(ROOT, 'scripts/i18n/extra_keys.txt');
export const OVERRIDES = join(ROOT, 'scripts/i18n/overrides.json');

/** Catalog codes besides English (English is the key and has no catalog). */
export const LOCALES = ['es', 'zh-Hans', 'de', 'fr', 'ja', 'ko', 'pt-BR'];

/** Every .ts / .tsx file under src/, relative to the repo root. */
export function sourceFiles(dir = SRC) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(relative(ROOT, path));
  }
  return out.sort();
}

export function unescape(s) {
  return s.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c);
}

// t('...') / tf('...', ...): the first argument, a plain string literal.
const CALL = /\btf?\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\$])*)`)/g;
// t(`... ${x} ...`): not a key, a mistake.
const TEMPLATE_CALL = /\btf?\(\s*`[^`]*\$\{/g;

/** Keys used in one source text, plus problems (calls that can't be keys). */
export function keysIn(text) {
  const keys = [];
  for (const m of text.matchAll(CALL)) keys.push(unescape(m[1] ?? m[2] ?? m[3]));
  const problems = [...text.matchAll(TEMPLATE_CALL)].map((m) => m[0]);
  return { keys, problems };
}

/** Keys built at runtime (t(variable)), from extra_keys.txt. */
export function extraKeys() {
  return readFileSync(EXTRA_KEYS, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'));
}

/** Every catalog key, in source order, without duplicates. */
export function allKeys() {
  const seen = new Set();
  for (const file of sourceFiles()) {
    for (const k of keysIn(readFileSync(join(ROOT, file), 'utf8')).keys) seen.add(k);
  }
  for (const k of extraKeys()) seen.add(k);
  return [...seen];
}

export const placeholders = (s) => (s.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join();
export const DASH = /[\u2014\u2013]/;
// Pictographs, minus the symbols that are text in UI copy.
export const EMOJI = /(?![\u00a9\u00ae\u2122\u2192\u2190\u2194])\p{Extended_Pictographic}|\uFE0F/u;
