import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { isUsable, sameTarget } from '@/lib/format';
import { clampTarget } from '@/lib/pools';
import { sendProxyMessage } from '@/lib/proxy/messages';
import {
  activeMembershipItem,
  connectionItem,
  recentTargetsItem,
  sessionItem,
  settingsItem,
  targetsItem,
} from '@/lib/storage';
import type { ConnectionState, Membership, ProxySettings, Session, Target } from '@/lib/types';
import { useStorageItem } from '../hooks/useStorageItem';

// ── Routes ──────────────────────────────────────────────────────────────

export type Route =
  | { name: 'boot' }
  | { name: 'login' }
  | { name: 'memberships' }
  | { name: 'home' }
  | { name: 'location' }
  | { name: 'settings' };

interface AppState {
  route: Route;
  /** Direction of the last transition, used by the screen animation. */
  direction: 'forward' | 'back';
  push(route: Route): void;
  back(): void;
  reset(route: Route): void;

  session: Session | null;
  memberships: Membership[] | null;
  membershipsError: string | null;
  reloadMemberships(): Promise<Membership[]>;
  signIn(session: Session): Promise<void>;
  signOut(): Promise<void>;

  activeMembership: Membership | null;
  selectMembership(id: string): Promise<void>;

  targetFor(membershipId: string): Target | undefined;
  setTarget(membershipId: string, target: Target): Promise<void>;
  recentTargets: Target[];

  settings: ProxySettings;
  updateSettings(patch: Partial<ProxySettings>): Promise<void>;

  connection: ConnectionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

// ── Provider ────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'boot' }]);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  const [session, setSession, sessionReady] = useStorageItem(sessionItem);
  const [activeId, setActiveId, activeReady] = useStorageItem(activeMembershipItem);
  const [targets, setTargets] = useStorageItem(targetsItem);
  const [recentTargets, setRecentTargets] = useStorageItem(recentTargetsItem);
  const [settings, setSettings] = useStorageItem(settingsItem);
  const [connection] = useStorageItem(connectionItem);

  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [membershipsError, setMembershipsError] = useState<string | null>(null);

  const push = useCallback((route: Route) => {
    setDirection('forward');
    setStack((s) => [...s, route]);
  }, []);
  const back = useCallback(() => {
    setDirection('back');
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const reset = useCallback((route: Route) => {
    setDirection('forward');
    setStack([route]);
  }, []);

  const reloadMemberships = useCallback(async () => {
    setMembershipsError(null);
    try {
      const list = await api.memberships();
      setMemberships(list);
      return list;
    } catch {
      setMembershipsError('Could not load your memberships.');
      return [];
    }
  }, []);

  /** Decide the first screen after sign-in / popup open. */
  const routeAfterAuth = useCallback(
    async (preferredId: string | null) => {
      const list = await reloadMemberships();
      const usable = list.filter(isUsable);
      const preferred = usable.find((m) => m.id === preferredId);
      if (preferred) return reset({ name: 'home' });
      const [only] = usable;
      if (only && usable.length === 1) {
        await setActiveId(only.id);
        return reset({ name: 'home' });
      }
      await setActiveId(null);
      reset({ name: 'memberships' });
    },
    [reloadMemberships, reset, setActiveId],
  );

  // Boot: restore the stored session, or show login.
  useEffect(() => {
    if (!sessionReady || !activeReady || stack[0]?.name !== 'boot') return;
    // Sessions saved before API-key sign-in have no key: treat as signed out.
    if (!session?.apiKey) return reset({ name: 'login' });
    api.useSession(session);
    void routeAfterAuth(activeId);
  }, [sessionReady, activeReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(
    async (next: Session) => {
      api.useSession(next);
      await setSession(next);
      await routeAfterAuth(null);
    },
    [routeAfterAuth, setSession],
  );

  const signOut = useCallback(async () => {
    await sendProxyMessage({ type: 'proxy:disconnect' }).catch(() => undefined);
    await api.signOut();
    api.useSession(null);
    await Promise.all([setSession(null), setActiveId(null)]);
    setMemberships(null);
    reset({ name: 'login' });
  }, [reset, setActiveId, setSession]);

  const activeMembership = useMemo(
    () => memberships?.find((m) => m.id === activeId) ?? null,
    [memberships, activeId],
  );

  const selectMembership = useCallback(
    async (id: string) => {
      if (connection.status === 'connected' && connection.membershipId !== id) {
        await sendProxyMessage({ type: 'proxy:disconnect' });
      }
      await setActiveId(id);
    },
    [connection, setActiveId],
  );

  /** Keeps a target within what the membership's pool can serve. */
  const fitToPlan = useCallback(
    (membershipId: string, target: Target): Target => {
      const m = memberships?.find((x) => x.id === membershipId);
      return m?.type === 'residential' && target.kind === 'residential' ? clampTarget(target, m.pool) : target;
    },
    [memberships],
  );

  const targetFor = useCallback(
    (membershipId: string) => {
      const t = targets[membershipId];
      return t && fitToPlan(membershipId, t);
    },
    [targets, fitToPlan],
  );

  const setTarget = useCallback(
    async (membershipId: string, picked: Target) => {
      const target = fitToPlan(membershipId, picked);
      await setTargets({ ...targets, [membershipId]: target });
      if (target.kind === 'residential' && target.country) {
        const next = [target, ...recentTargets.filter((t) => !sameTarget(t, target))].slice(0, 5);
        await setRecentTargets(next);
      }
      // Switching location while connected re-connects to the new exit.
      if (connection.status === 'connected' && connection.membershipId === membershipId) {
        await sendProxyMessage({ type: 'proxy:connect', membershipId, target });
      }
    },
    [targets, recentTargets, connection, fitToPlan, setTargets, setRecentTargets],
  );

  const updateSettings = useCallback(
    (patch: Partial<ProxySettings>) => setSettings({ ...settings, ...patch }),
    [settings, setSettings],
  );

  const connect = useCallback(async () => {
    if (!activeMembership) return;
    const target = targetFor(activeMembership.id) ?? defaultTarget(activeMembership);
    if (!target) return;
    await sendProxyMessage({ type: 'proxy:connect', membershipId: activeMembership.id, target });
  }, [activeMembership, targetFor]);

  const disconnect = useCallback(async () => {
    await sendProxyMessage({ type: 'proxy:disconnect' });
  }, []);

  const value: AppState = {
    route: stack[stack.length - 1] ?? { name: 'boot' },
    direction,
    push,
    back,
    reset,
    session,
    memberships,
    membershipsError,
    reloadMemberships,
    signIn,
    signOut,
    activeMembership,
    selectMembership,
    targetFor,
    setTarget,
    recentTargets,
    settings,
    updateSettings,
    connection,
    connect,
    disconnect,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Residential defaults to a random worldwide exit; ISP needs an explicit IP. */
export function defaultTarget(m: Membership): Target | undefined {
  return m.type === 'residential' ? { kind: 'residential' } : undefined;
}
