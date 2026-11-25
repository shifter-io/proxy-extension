import { browser } from '#imports';
import { applyLanguage, languageItem, loadLanguage, t, tf } from './i18n';
import { connectionItem } from './storage';
import type { ConnectionState } from './types';

function appearance(connection: ConnectionState) {
  switch (connection.status) {
    case 'connected': {
      // Show the checked exit, not the requested country (which may differ).
      const code = connection.exitCountry?.trim().toUpperCase();
      const country = code && /^[A-Z]{2}$/.test(code) ? code : undefined;
      return {
        text: country ?? t('ON'),
        color: '#15803D',
        title: [`Shifter — ${t('Connected')}`, country, connection.exitIp].filter(Boolean).join(' · '),
      };
    }
    case 'connecting':
      return { text: '…', color: '#B45309', title: `Shifter — ${t('Connecting…')}` };
    case 'error':
      return { text: '!', color: '#B91C1C', title: `Shifter — ${tf('Connection failed: {message}', { message: connection.message })}` };
    case 'disconnected':
      return { text: '', color: '#15803D', title: `Shifter — ${t('Not connected')}` };
  }
}

/**
 * Global toolbar status, including when the popup is closed or the worker
 * restarts. Also loads the worker's language (for the title and the errors
 * it stores) and follows changes to it.
 */
export function watchToolbarConnection() {
  // Firefox MV2 exposes browserAction; Chromium MV3 exposes action.
  const action = (browser.action ?? browser.browserAction) as typeof browser.action;
  let pending: Promise<unknown> = loadLanguage().catch(() => undefined);

  function refresh() {
    // Serialize writes and read the latest state inside the queue so a slow
    // startup refresh cannot overwrite a newer disconnect or country change.
    pending = pending.then(async () => {
      const { text, color, title } = appearance(await connectionItem.getValue());
      await Promise.all([
        action.setBadgeBackgroundColor({ color }),
        action.setBadgeTextColor?.({ color: '#FFFFFF' }),
        action.setTitle({ title }),
        action.setBadgeText({ text }),
      ]);
    }).catch((error) => console.warn('Could not update toolbar connection status', error));
  }

  connectionItem.watch(refresh);
  languageItem.watch((choice) => {
    applyLanguage(choice);
    refresh();
  });
  refresh();
}
