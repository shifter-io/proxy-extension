#!/usr/bin/env node
/**
 * The translation gate (npm run i18n:check, a CI part):
 *
 * (a) every key (scripts/i18n/keys.mjs) is in every catalog, with the same
 *     {placeholders}, and no catalog text has an em or en dash or an emoji;
 * (b) no user-facing text in src/ skips t() / tf(): JSX text, user-facing
 *     props (title, subtitle, body, warning, placeholder, aria-label, label,
 *     alt, data-tip), and string literals that read like a sentence or a
 *     capitalised label. Brand and technical words (Shifter, API, IP...) and
 *     text starting with a copyright sign pass; anything else that is not
 *     shown to people goes in ALLOWED below, with a reason.
 *
 * Fix missing keys with scripts/i18n/translate.mjs (see its header).
 */
import { existsSync, readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { join } from 'node:path';
import { allKeys, DASH, EMOJI, keysIn, LOCALES, LOCALES_DIR, placeholders, ROOT, sourceFiles } from './lib.mjs';

/** Words that stay in Latin script in every language, so they need no t(). */
const TECH = [
  'Shifter', 'API', 'IPs', 'IP', 'ISP', 'ASN', 'AS', 'GB', 'TB', 'MB', 'ms', 'HTTP', 'HTTPS', 'SOCKS5', 'TLS', 'VPN', 'DNS',
  'WebRTC', 'Chrome', 'Firefox', 'Edge', 'Full Geo', 'Country Geo', 'Non-Geo', 'TTL',
];
const TECH_RE = new RegExp(`\\b(?:${TECH.map((w) => w.replace(/[-]/g, '\\-')).join('|')})\\b`, 'g');

/**
 * Literals that look like text but are never shown to people. Keyed by
 * "<file>: <text>"; keep each one explained.
 */
const ALLOWED = new Set([
  // The Authorization header's scheme.
  'src/lib/api/http/index.ts: Bearer',
]);

/** Files with no user-facing text of their own (fixtures, the language list itself). */
const SKIP_FILES = [/^src\/lib\/api\/mock\//, /^src\/lib\/i18n\.ts$/];

const errors = [];

// ── (a) catalogs ────────────────────────────────────────────────────────

const keys = allKeys();
if (keys.length < 100) errors.push(`only ${keys.length} keys found; the key extraction is broken`);
for (const k of keys) {
  if (DASH.test(k)) errors.push(`key uses a dash (use a colon, comma or two sentences): ${JSON.stringify(k)}`);
}
for (const file of sourceFiles()) {
  for (const p of keysIn(readFileSync(join(ROOT, file), 'utf8')).problems) {
    errors.push(`${file}: t() needs a plain literal, use tf() with {placeholders}: ${p}`);
  }
}
for (const code of LOCALES) {
  const path = join(LOCALES_DIR, `${code}.json`);
  if (!existsSync(path)) {
    errors.push(`src/locales/${code}.json is missing`);
    continue;
  }
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  const missing = keys.filter((k) => typeof catalog[k] !== 'string' || !catalog[k].trim());
  if (missing.length) {
    errors.push(`${code}: ${missing.length} missing keys, first: ${missing.slice(0, 5).map((k) => JSON.stringify(k)).join(', ')}`);
  }
  const unused = Object.keys(catalog).filter((k) => !keys.includes(k));
  if (unused.length) errors.push(`${code}: ${unused.length} keys no longer used, first: ${unused.slice(0, 5).map((k) => JSON.stringify(k)).join(', ')}`);
  for (const k of keys) {
    const v = catalog[k];
    if (typeof v !== 'string') continue;
    if (placeholders(v) !== placeholders(k)) errors.push(`${code}: placeholders differ for ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    if (DASH.test(v)) errors.push(`${code}: dash in ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    if (EMOJI.test(v)) errors.push(`${code}: emoji in ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  }
}

// ── (b) code guard ──────────────────────────────────────────────────────

/** True when the text still has letters after the brand and technical words. */
function needsTranslation(text) {
  const s = text.trim();
  if (!s || s.startsWith('©')) return false;
  return /\p{L}{2,}/u.test(s.replace(TECH_RE, ''));
}

/** Props and object fields whose string is shown to people. */
const PROPS = new Set(['title', 'subtitle', 'body', 'warning', 'placeholder', 'aria-label', 'label', 'alt', 'data-tip', 'tooltip', 'message', 'heading']);
// Reads like text for people: a capitalised word, several words ending in
// punctuation, or a phrase of plain lowercase words ("no location selected").
const PROSE_RE = /^[A-Z][a-z]+(?:[\s,.!?…:’']|$)|^\p{L}[\p{L}'’ ,]* \p{L}[\p{L}'’ ,]*[.!?…:]$|^\p{Ll}{2,}(?: \p{Ll}+)+$/u;

const isTCall = (node) => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && (node.callee.name === 't' || node.callee.name === 'tf');

/** The strings an expression can evaluate to, as far as the syntax tells (not t() results). */
function results(node) {
  if (!node) return [];
  switch (node.type) {
    case 'StringLiteral':
      return [{ node, value: node.value }];
    case 'TemplateLiteral':
      return node.quasis.map((q) => ({ node: q, value: q.value.cooked ?? q.value.raw }));
    case 'ConditionalExpression':
      return [...results(node.consequent), ...results(node.alternate)];
    case 'LogicalExpression':
      return [...(node.operator === '&&' ? [] : results(node.left)), ...results(node.right)];
    case 'JSXExpressionContainer':
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSNonNullExpression':
      return results(node.expression);
    default:
      return [];
  }
}

function propName(node) {
  if (node.type === 'JSXAttribute') return node.name.type === 'JSXNamespacedName' ? null : node.name.name;
  if (node.type === 'ObjectProperty' && !node.computed) return node.key.name ?? node.key.value;
  return null;
}

function check(file, ast) {
  const seen = new Set();
  const flag = (node, value, rule) => {
    if (seen.has(node)) return;
    seen.add(node);
    const s = value.trim();
    if (ALLOWED.has(`${file}: ${value}`) || ALLOWED.has(`${file}: ${s}`)) return;
    errors.push(`${file}:${node.loc.start.line}: ${rule} not wrapped in t(): ${JSON.stringify(s)}`);
  };

  // parents: the chain from the root, to tell where a literal sits.
  function walk(node, parents) {
    if (!node || typeof node.type !== 'string') return;
    const parent = parents[parents.length - 1];
    const insideT = parents.some(isTCall);

    if (!insideT) {
      if (node.type === 'JSXText' && needsTranslation(node.value)) flag(node, node.value, 'JSX text');

      // {'Text'} or {cond ? 'A' : 'B'} as a JSX child.
      if (node.type === 'JSXExpressionContainer' && (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment')) {
        for (const r of results(node.expression)) if (needsTranslation(r.value)) flag(r.node, r.value, 'JSX text');
      }

      // title="..." / title={...} / { title: '...' }
      const name = (node.type === 'JSXAttribute' || node.type === 'ObjectProperty') && propName(node);
      if (name && PROPS.has(name)) {
        for (const r of results(node.value)) if (needsTranslation(r.value)) flag(r.node, r.value, `${name} text`);
      }

      // Any other literal that reads like a sentence or a label.
      const literal = node.type === 'StringLiteral' || node.type === 'TemplateElement';
      const skip =
        parent?.type === 'ImportDeclaration' ||
        parent?.type === 'ExportNamedDeclaration' ||
        parent?.type === 'ExportAllDeclaration' ||
        parent?.type === 'TSLiteralType' ||
        (parent?.type === 'ObjectProperty' && parent.key === node) ||
        (parent?.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) ||
        parent?.type === 'SwitchCase' ||
        // CSS: class names and inline styles.
        parents.some((p) => p.type === 'JSXAttribute' && (p.name.name === 'className' || p.name.name === 'style')) ||
        (parent?.type === 'CallExpression' && parent.callee.type === 'MemberExpression' && parent.callee.object.name === 'console');
      if (literal && !skip) {
        const value = node.type === 'StringLiteral' ? node.value : (node.value.cooked ?? node.value.raw);
        if (PROSE_RE.test(value.trim()) && needsTranslation(value)) flag(node, value, 'text');
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key.endsWith('Comments')) continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) walk(c, [...parents, node]);
      else if (child && typeof child.type === 'string') walk(child, [...parents, node]);
    }
  }
  walk(ast.program, []);
}

for (const file of sourceFiles()) {
  if (SKIP_FILES.some((re) => re.test(file))) continue;
  const text = readFileSync(join(ROOT, file), 'utf8');
  let ast;
  try {
    ast = parse(text, { sourceType: 'module', plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] });
  } catch (e) {
    errors.push(`${file}: could not parse: ${e.message}`);
    continue;
  }
  check(file, ast);
}

if (errors.length) {
  console.error(`i18n check failed (${errors.length}):\n` + [...new Set(errors)].map((e) => `  ${e}`).join('\n'));
  process.exit(1);
}
console.log(`i18n check passed: ${keys.length} keys in ${LOCALES.length} catalogs, no untranslated text in src/.`);
