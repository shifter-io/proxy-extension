import { automaticLanguage, LANGUAGE_FLAGS, LANGUAGE_NAMES, LANGUAGES, languageItem, t, tf, type Language } from '@/lib/i18n';
import { Flag, Screen, TopBar } from '../components/primitives';
import { Row } from '../components/Rows';
import { useStorageItem } from '../hooks/useStorageItem';
import { useApp } from '../state/AppState';

/**
 * Settings > Language: Automatic (the browser languages) or one of the
 * app's eight languages, each in its own language. Same rows as the country
 * list in the location picker: flag, name, check when selected.
 */
export function LanguageScreen() {
  const { back } = useApp();
  const [choice, setChoice] = useStorageItem(languageItem);

  function choose(code: Language | null) {
    // The popup re-renders in the new language as soon as storage changes.
    void setChoice(code);
  }

  return (
    <Screen header={<TopBar onBack={back} title={t('Extension language')} />} bodyClassName="px-3 py-3">
      <div className="flex flex-col gap-0.5">
        <Row
          leading={<Flag />}
          title={t('Automatic')}
          subtitle={tf('Follows your browser: {language}', { language: LANGUAGE_NAMES[automaticLanguage()] })}
          selected={choice === null}
          onClick={() => choose(null)}
        />
        {LANGUAGES.map((code) => (
          <Row
            key={code}
            leading={<Flag code={LANGUAGE_FLAGS[code]} />}
            title={<span lang={code}>{LANGUAGE_NAMES[code]}</span>}
            selected={choice === code}
            onClick={() => choose(code)}
          />
        ))}
      </div>
    </Screen>
  );
}
