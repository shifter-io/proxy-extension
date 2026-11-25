#!/usr/bin/env node
/**
 * Fills src/locales/<locale>.json. Adapted from the Shifter app's
 * tool/i18n/translate.mjs, with the same rules.
 *
 *   node scripts/i18n/keys.mjs > /tmp/ext-keys.txt
 *   node scripts/i18n/translate.mjs /tmp/ext-keys.txt [--app <dir>] [--all]
 *
 * Where each translation comes from, first match wins:
 * 1. scripts/i18n/overrides.json (hand-checked wording), applied last.
 * 2. The Shifter app's finished catalogs (--app <dir>: the app's
 *    assets/i18n folder, or APP_I18N_DIR), for every key the app also has,
 *    so the app and the extension say the same thing.
 * 3. The current catalog (without --all).
 * 4. A model that answers per key id (an object, not a positional list), so
 *    one dropped item cannot shift the rest. Answers that lose a
 *    {placeholder}, use a dash, add an emoji, or come back for the wrong ids
 *    are rejected.
 *
 * Country names are not keys: the UI shows them with Intl.DisplayNames.
 * The API key comes only from the environment (ANTHROPIC_API_KEY, loaded
 * from an env file in the same shell command, never typed on a command line).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DASH, EMOJI, LOCALES, LOCALES_DIR, OVERRIDES, placeholders } from './lib.mjs';

const MODEL = process.env.SHIFTER_I18N_MODEL || 'claude-sonnet-5';
const NAMES = { es: 'Spanish (Spain)', 'zh-Hans': 'Simplified Chinese', de: 'German', fr: 'French', ja: 'Japanese', ko: 'Korean', 'pt-BR': 'Brazilian Portuguese' };
// Register per language, matching shifter.io and the app, and the browsers'
// own names for their private windows.
const NOTES = {
  de: 'Address the user formally with Sie / Ihr / Ihnen, never du / dein / dich (as on shifter.io). Chrome calls its private windows "Inkognitofenster"; Firefox says "Private Fenster".',
  es: 'Address the user with tú (as on shifter.io). Chrome calls its private windows "ventanas de incógnito"; Firefox says "ventanas privadas".',
  fr: 'Address the user with vous. Chrome calls its private windows "fenêtres de navigation privée"; Firefox says "fenêtres privées".',
  'pt-BR': 'Address the user with você. Chrome calls its private windows "janelas anônimas"; Firefox says "janelas privativas".',
  ja: 'Chrome calls its private windows "シークレット ウィンドウ"; Firefox says "プライベートウィンドウ".',
  ko: 'Chrome calls its private windows "시크릿 창"; Firefox says "사생활 보호 창".',
  'zh-Hans': 'Chrome calls its private windows "无痕式窗口"; Firefox says "隐私窗口".',
};
const SYSTEM = `You translate the interface of Shifter's browser extension (Chrome, Firefox and Edge), a proxy client.
Rules, all mandatory:
- Keep these exactly as written, in Latin script: Shifter, API, IP, ISP, ASN, GB, TB, MB, HTTP, HTTPS, SOCKS5, TLS, VPN, DNS, WebRTC, TTL, Chrome, Firefox, Edge, InPrivate, Full Geo, Country Geo, Non-Geo, shifter.io, example.com.
- Preserve every {placeholder} token exactly, including the braces.
- Preserve numbers, units, punctuation style, arrows (→) and line breaks.
- Never use em dashes or en dashes. Never use emojis.
- Interface style: short, plain, the way a polished browser extension in that language says it. The popup is 380 pixels wide: buttons, labels and statuses stay short. Single words are UI labels (buttons, tabs, statuses).
- Browser menu names (Firefox's "Add-ons and themes", "Run in Private Windows", "Allow") use that browser's own wording in the language.
- Quotation marks inside a translation: use the language's own (「」, « », „ “) or escape them, so the output is valid JSON.
- Input is a JSON object of id -> English text. Return only a JSON object with exactly the same ids, each mapped to its translation.`;

const args = process.argv.slice(2);
const keysFile = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--app');
if (!keysFile) {
  console.error('usage: translate.mjs <keys.txt> [--app <dir>] [--all]');
  process.exit(2);
}
const all = args.includes('--all');
const appDir = args.includes('--app') ? args[args.indexOf('--app') + 1] : process.env.APP_I18N_DIR;
const keys = readFileSync(keysFile, 'utf8').split('\n').filter((k) => k.trim());
const apiKey = process.env.ANTHROPIC_API_KEY;
const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const usable = (k, v) => typeof v === 'string' && v.trim() && placeholders(v) === placeholders(k) && !DASH.test(v) && !EMOJI.test(v);

async function askOnce(locale, items) {
  const input = Object.fromEntries(items.map((k, i) => [`k${i}`, k]));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: `${SYSTEM}\n- ${NOTES[locale]}`,
      messages: [{ role: 'user', content: `Translate into ${NAMES[locale]}:\n${JSON.stringify(input, null, 1)}` }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = (await res.json()).content.map((c) => c.text || '').join('');
  const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (Object.keys(out).sort().join() !== Object.keys(input).sort().join()) throw new Error('ids differ');
  return items.map((_, i) => out[`k${i}`]);
}

async function ask(locale, items, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await askOnce(locale, items);
    } catch (e) {
      if (i >= tries) throw e;
      console.error(`  ${locale} retry ${i}: ${String(e.message).slice(0, 80)}`);
    }
  }
}

for (const locale of LOCALES) {
  const file = join(LOCALES_DIR, `${locale}.json`);
  const old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const appFile = appDir && resolve(appDir, `${locale}.json`);
  const app = appFile && existsSync(appFile) ? JSON.parse(readFileSync(appFile, 'utf8')) : {};
  const own = overrides[locale] || {};
  const cat = {};
  let fromApp = 0;
  for (const k of keys) {
    if (own[k]) continue;
    if (usable(k, app[k])) {
      cat[k] = app[k];
      fromApp++;
    } else if (!all && usable(k, old[k])) cat[k] = old[k];
  }
  const missing = keys.filter((k) => !own[k] && !(k in cat));
  let done = 0;
  if (missing.length && !apiKey) console.error(`${locale}: ${missing.length} missing and no ANTHROPIC_API_KEY`);
  for (let i = 0; apiKey && i < missing.length; i += 30) {
    const batch = missing.slice(i, i + 30);
    const out = await ask(locale, batch);
    batch.forEach((k, j) => {
      if (!usable(k, out[j])) return console.error(`  ${locale} rejected: ${k}`);
      cat[k] = out[j];
      done++;
    });
  }
  for (const k of keys) if (own[k]) cat[k] = own[k];
  const sorted = Object.fromEntries(Object.keys(cat).sort().map((k) => [k, cat[k]]));
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
  const pinned = keys.filter((k) => own[k]).length;
  console.log(`${locale}: ${fromApp} from the app, ${pinned} overrides, ${done} translated, ${keys.length - Object.keys(sorted).length} still missing`);
}
