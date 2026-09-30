import { storage } from '#imports';
import type { ConnectionState, ProxySettings, Session, Target } from './types';

/**
 * Typed extension storage. `local:` persists across browser restarts and is
 * shared by the popup and the background worker, so either side can read
 * the current state and react to changes via `.watch()`.
 */

export const DEFAULT_SETTINGS: ProxySettings = {
  sessionMode: 'sticky',
  ttlSeconds: 600,
  strict: false,
  bypassList: ['localhost', '127.0.0.1', '*.local'],
  webrtcProtection: true,
};

export const sessionItem = storage.defineItem<Session | null>('local:session', {
  fallback: null,
});

export const settingsItem = storage.defineItem<ProxySettings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

/** Membership the user last worked with, restored when the popup reopens. */
export const activeMembershipItem = storage.defineItem<string | null>('local:activeMembership', {
  fallback: null,
});

/** Last chosen target per membership id. */
export const targetsItem = storage.defineItem<Record<string, Target>>('local:targets', {
  fallback: {},
});

/** Most recent residential picks, newest first, for the "Recent" list. */
export const recentTargetsItem = storage.defineItem<Target[]>('local:recentTargets', {
  fallback: [],
});

export const connectionItem = storage.defineItem<ConnectionState>('local:connection', {
  fallback: { status: 'disconnected' },
});
