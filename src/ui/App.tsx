import { Glyph, Spinner } from './components/primitives';
import { HomeScreen } from './screens/HomeScreen';
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

function Router() {
  const { route, direction } = useApp();
  // Keyed wrapper replays the enter animation on every navigation.
  return (
    <div
      key={routeKey(route)}
      className="absolute inset-0"
      style={{ animation: `${direction === 'back' ? 'sf-fade-in 0.2s' : 'sf-fade-in 0.25s'} ease both` }}
    >
      <Screen route={route} />
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
