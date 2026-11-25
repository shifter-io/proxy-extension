import { storage } from '#imports';

/**
 * Translations. The English string is the catalog key, the same convention
 * as the Shifter app, website and panel: wrap a user-facing string in t()
 * (or tf() when it has `{placeholders}`), and `npm run i18n:check` fails
 * until every catalog in src/locales/<code>.json has it. Add missing ones
 * with scripts/i18n/translate.mjs (see its header).
 *
 * Languages: the app's eight. The user's choice is kept in extension
 * storage; null means Automatic, which follows the browser languages (any
 * Chinese gets Simplified Chinese, any Portuguese gets Brazilian
 * Portuguese, anything else we don't have gets English, which needs no
 * catalog). The popup and the background worker both load it.
 */
export const LANGUAGES = ['en', 'es', 'zh-Hans', 'de', 'fr', 'ja', 'ko', 'pt-BR'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language name in its own language, for the picker in Settings. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  es: 'Español',
  'zh-Hans': '简体中文',
  de: 'Deutsch',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  'pt-BR': 'Português (Brasil)',
};

/** Flag shown next to each language in the picker (public/flags/<cc>.png). */
export const LANGUAGE_FLAGS: Record<Language, string> = {
  en: 'us',
  es: 'es',
  'zh-Hans': 'cn',
  de: 'de',
  fr: 'fr',
  ja: 'jp',
  ko: 'kr',
  'pt-BR': 'br',
};

/** The user's choice; null = Automatic (the browser languages). */
export const languageItem = storage.defineItem<Language | null>('local:language', { fallback: null });

const catalogs: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(import.meta.glob<Record<string, string>>('../locales/*.json', { eager: true, import: 'default' })).map(
    ([path, catalog]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), catalog],
  ),
);

let code: Language = 'en';
let catalog: Record<string, string> = {};

/** The catalog code for a browser language tag, or null when we don't have it. */
export function languageFor(tag: string): Language | null {
  const base = tag.toLowerCase().split(/[-_]/)[0];
  if (base === 'zh') return 'zh-Hans';
  if (base === 'pt') return 'pt-BR';
  return (LANGUAGES as readonly string[]).includes(base!) ? (base as Language) : null;
}

/** First of the browser's preferred languages that we have, else English. */
export function pickLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const found = languageFor(tag);
    if (found) return found;
  }
  return 'en';
}

/** The browser's languages (the UI language when the list is empty). */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

/** What Automatic resolves to right now. */
export function automaticLanguage(): Language {
  return pickLanguage(browserLanguages());
}

/** Makes `choice` (null = Automatic) the active language; returns the code in use. */
export function applyLanguage(choice: Language | null | undefined): Language {
  const next = choice && (LANGUAGES as readonly string[]).includes(choice) ? choice : automaticLanguage();
  code = next;
  catalog = next === 'en' ? {} : (catalogs[next] ?? {});
  return next;
}

/** Reads the stored choice and applies it. */
export async function loadLanguage(): Promise<Language> {
  return applyLanguage(await languageItem.getValue().catch(() => null));
}

/** The active catalog code (`en`, `de`, `zh-Hans`...), also a valid BCP 47 tag for Intl. */
export function activeLanguage(): Language {
  return code;
}

/** The translation of `en` in the active language (English when missing). */
export function t(en: string): string {
  // Own keys only: a key like "constructor" must not return Object.prototype's.
  return Object.hasOwn(catalog, en) ? catalog[en]! : en;
}

/** t() with `{name}` placeholders filled from `args`. */
export function tf(en: string, args: Record<string, string | number>): string {
  return t(en).replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => (name in args ? String(args[name]) : whole));
}
