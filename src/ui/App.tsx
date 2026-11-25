import { useEffect, useState } from 'react';
import { activeLanguage, applyLanguage, languageItem, type Language } from '@/lib/i18n';
import { Glyph, Spinner } from './components/primitives';
import { HomeScreen } from './screens/HomeScreen';
import { LanguageScreen } from './screens/LanguageScreen';
import { LocationScreen } from './screens/LocationScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MembershipsScreen } from './screens/MembershipsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppProvider, useApp, type Route } from './state/AppState';

export function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}

/**
 * The active language. main.tsx loads it before the first render; a change
 * in Settings (or another popup) applies it and re-renders the screen.
 */
function useLanguage(): Language {
  const [code, setCode] = useState(activeLanguage);
  useEffect(() => {
    document.documentElement.lang = code;
  }, [code]);
  useEffect(() => languageItem.watch((choice) => setCode(applyLanguage(choice))), []);
  return code;
}

function Router() {
  const { route, direction } = useApp();
  const language = useLanguage();
  // Keyed wrapper replays the enter animation on every navigation.
  return (
    <div
      key={routeKey(route)}
      className="absolute inset-0"
      style={{ animation: `${direction === 'back' ? 'sf-fade-in 0.2s' : 'sf-fade-in 0.25s'} ease both` }}
    >
      {/* Keyed by language: every string re-renders in the new one. */}
      <Screen key={language} route={route} />
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'boot':
      return <Boot />;
    case 'login':
      return <LoginScreen />;
    case 'memberships':
      return <MembershipsScreen />;
    case 'home':
      return <HomeScreen />;
    case 'location':
      return <LocationScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'language':
      return <LanguageScreen />;
  }
}

function routeKey(route: Route) {
  return route.name;
}

function Boot() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Glyph size={36} />
        <Spinner size={18} />
      </div>
    </div>
  );
}
