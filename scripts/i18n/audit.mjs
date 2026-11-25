#!/usr/bin/env node
/**
 * Second opinion on the catalogs: a model reads each English key next to its
 * translation and lists pairs whose meaning differs (shifted rows, wrong
 * word, missing part). Same as the app's tool/i18n/audit.mjs.
 *
 *   node scripts/i18n/keys.mjs > /tmp/ext-keys.txt
 *   node scripts/i18n/audit.mjs /tmp/ext-keys.txt
 *
 * Fix what it flags in scripts/i18n/overrides.json and run translate.mjs
 * again. The API key comes only from the environment (ANTHROPIC_API_KEY).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALES_DIR } from './lib.mjs';

const keys = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
const NAMES = { es: 'Spanish', 'zh-Hans': 'Simplified Chinese', de: 'German', fr: 'French', ja: 'Japanese', ko: 'Korean', 'pt-BR': 'Brazilian Portuguese' };
const SYSTEM =
  'You audit browser extension UI translations. For each id you get the English source and the translation. Flag ONLY pairs where the translation means something different from the source (wrong meaning, belongs to another string, missing a part, wrong language). Ignore style preferences and kept brand words. Return only JSON: {"bad": [{"id": "...", "why": "..."}]}.';

for (const [locale, name] of Object.entries(NAMES)) {
  const cat = JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8'));
  const bad = [];
  for (let i = 0; i < keys.length; i += 60) {
    const items = Object.fromEntries(keys.slice(i, i + 60).map((k, j) => [`k${i + j}`, { en: k, [locale]: cat[k] }]));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.SHIFTER_I18N_MODEL || 'claude-sonnet-5',
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `${name} translations:\n${JSON.stringify(items, null, 1)}` }],
      }),
    });
    const text = (await res.json()).content?.map((c) => c.text || '').join('') ?? '';
    try {
      for (const b of JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).bad || []) {
        const k = keys[+b.id.slice(1)];
        bad.push(`  ${k} => ${cat[k]}  (${b.why})`);
      }
    } catch {
      bad.push(`  (unparsable audit batch ${i})`);
    }
  }
  console.log(`${locale}: ${bad.length} flagged`);
  if (bad.length) console.log(bad.join('\n'));
}
