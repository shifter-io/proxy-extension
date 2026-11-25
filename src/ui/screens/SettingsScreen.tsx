import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { browser } from '#imports';
import { formatDuration, formatMoney } from '@/lib/format';
import { activeLanguage, LANGUAGE_NAMES, languageItem, t, tf } from '@/lib/i18n';
import { normalizeRule } from '@/lib/proxy/bypass';
import { gatewayLatencyItem } from '@/lib/proxy/gateways';
import type { EntryPoint } from '@/lib/types';
import { Icon } from '../components/Icon';
import { Screen, SectionLabel, Toggle, TopBar } from '../components/primitives';
import { Row } from '../components/Rows';
import { useStorageItem } from '../hooks/useStorageItem';
import { openExternal, SHIFTER_URLS } from '../links';
import { useApp } from '../state/AppState';

const TTL_PRESETS = [60, 300, 600, 1800, 3600];
const TTL_MIN = 30;
const TTL_MAX = 24 * 3600;

export function SettingsScreen() {
  const { back, push, settings, updateSettings, session, signOut, activeMembership: m, connection } = useApp();
  const [language] = useStorageItem(languageItem);
  const webrtcBlocked = connection.status === 'connected' && settings.webrtcProtection && connection.webrtc === 'unavailable';
  const residential = m?.type === 'residential' ? m : null;
  // Some plans don't allow sticky sessions; the gateway then rotates every request.
  const stickyAllowed = residential?.stickySessions ?? true;
  const sticky = settings.sessionMode === 'sticky' && stickyAllowed;
  const user = session?.user;

  return (
    <Screen header={<TopBar onBack={back} title={t('Settings')} />} bodyClassName="px-4 py-4 flex flex-col gap-6">
      {/* Session */}
      <section>
        <SectionLabel>{t('IP session')}</SectionLabel>
        <div className="sf-card flex flex-col gap-4">
          <div className="sf-segmented">
            <button className={`${sticky ? 'active' : ''} disabled:opacity-40 disabled:cursor-not-allowed`} disabled={!stickyAllowed} onClick={() => updateSettings({ sessionMode: 'sticky' })}>
              <Icon name="clock" size={13} /> {t('Sticky')}
            </button>
            <button className={!sticky ? 'active' : ''} onClick={() => updateSettings({ sessionMode: 'rotating' })}>
              <Icon name="shuffle" size={13} /> {t('Rotating')}
            </button>
          </div>
          <p className="text-[12.5px] leading-relaxed text-sf-text-tertiary -mt-1">
            {!stickyAllowed
              ? t('This plan rotates the exit IP on every request; sticky sessions are not available.')
              : sticky
                ? t('Keep the same exit IP for a while. Best for logins, carts and anything with a session.')
                : t('A fresh exit IP on every request. Best for scraping and price checks.')}
          </p>

          {sticky && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-sf-text-secondary">{t('Session length (TTL)')}</span>
                <span className="sf-mono text-[12px] text-sf-text-tertiary">{tf('{n}s', { n: settings.ttlSeconds })}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {TTL_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => updateSettings({ ttlSeconds: s })}
                    className={`h-8 rounded-md text-[12px] font-medium border transition-colors ${
                      settings.ttlSeconds === s
                        ? 'bg-sf-accent-soft border-[rgba(43,127,255,0.35)] text-sf-accent-light'
                        : 'bg-white/[0.03] border-sf-border-subtle text-sf-text-tertiary hover:text-sf-text-primary'
                    }`}
                  >
                    {formatDuration(s)}
                  </button>
                ))}
              </div>
              <TtlStepper value={settings.ttlSeconds} onChange={(ttlSeconds) => updateSettings({ ttlSeconds })} />
            </div>
          )}
        </div>
      </section>

      {residential && residential.entryPoints.length > 1 && (
        <EntryPoints
          list={residential.entryPoints}
          panelHost={residential.gatewayHost}
          value={settings.entryPoint}
          onChange={(entryPoint) => updateSettings({ entryPoint })}
        />
      )}

      {/* Targeting + privacy */}
      <section>
        <SectionLabel>{t('Connection')}</SectionLabel>
        <div className="sf-card !p-0 divide-y divide-sf-border-subtle">
          {residential && (
            <SwitchRow
              title={t('Strict location')}
              body={t('Only use IPs from the exact state, city or ISP you picked, never a wider area. Fails if none is free.')}
              checked={settings.strict}
              onChange={(strict) => updateSettings({ strict })}
            />
          )}
          <SwitchRow
            title={t('WebRTC leak protection')}
            body={t('Stop sites from seeing your real IP through WebRTC while connected.')}
            warning={
              webrtcBlocked
                ? t('Not active: another extension or a browser policy controls WebRTC. Turn that off to use this protection.')
                : undefined
            }
            checked={settings.webrtcProtection}
            onChange={(webrtcProtection) => updateSettings({ webrtcProtection })}
          />
          <PrivateWindowsRow />
        </div>
      </section>

      <BypassList list={settings.bypassList} onChange={(bypassList) => updateSettings({ bypassList })} />

      {/* Language */}
      <section>
        <SectionLabel>{t('Language')}</SectionLabel>
        <div className="sf-card !p-0">
          <button
            type="button"
            onClick={() => push({ name: 'language' })}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]"
          >
            <span className="flex-1 min-w-0 text-[13.5px] font-medium truncate">{t('Extension language')}</span>
            <span className="min-w-0 truncate text-[12.5px] text-sf-text-tertiary">
              {language ? LANGUAGE_NAMES[language] : tf('Automatic ({language})', { language: LANGUAGE_NAMES[activeLanguage()] })}
            </span>
            <Icon name="chevronRight" size={15} className="text-sf-text-muted shrink-0" />
          </button>
        </div>
      </section>

      {/* Account */}
      <section>
        <SectionLabel>{t('Account')}</SectionLabel>
        <div className="sf-card !p-0 divide-y divide-sf-border-subtle">
          {user && (
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="w-8 h-8 rounded-lg grid place-items-center bg-sf-accent-soft text-sf-accent-light text-[13px] font-semibold uppercase">
                {(user.name || user.email).slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{user.name || user.email}</div>
                <div className="text-[11.5px] text-sf-text-muted truncate">{user.email}</div>
              </div>
              {user.walletBalance != null && (
                <div className="text-right shrink-0">
                  <div className="sf-mono text-[13px] font-semibold">{formatMoney(user.walletBalance, user.currency)}</div>
                  <div className="text-[11px] text-sf-text-muted">{t('Wallet')}</div>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-8 h-8 rounded-lg grid place-items-center bg-sf-accent-soft text-sf-accent-light">
              <Icon name="lock" size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t('API key')}</div>
              <div className="text-[11.5px] text-sf-text-muted sf-mono">{maskKey(session?.apiKey)}</div>
            </div>
          </div>
          <LinkRow onClick={() => openExternal(SHIFTER_URLS.panel)}>{t('Open Shifter dashboard')}</LinkRow>
          <LinkRow onClick={() => openExternal(SHIFTER_URLS.support)}>{t('Help & support')}</LinkRow>
        </div>
        <button type="button" className="sf-btn sf-btn-danger sf-btn-sm w-full mt-3" onClick={() => void signOut()}>
          <Icon name="logout" size={14} /> {t('Sign out')}
        </button>
      </section>

      <p className="text-center text-[11px] text-sf-text-faint pb-1">
        {tf('Shifter extension v{version}', { version: browser.runtime.getManifest().version })}
      </p>
    </Screen>
  );
}

/** Never render the full key: first 4 + last 4 only. */
function maskKey(key?: string) {
  if (!key) return '';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function TtlStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(TTL_MAX, Math.max(TTL_MIN, Math.round(v) || TTL_MIN));
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <span className="text-[12px] text-sf-text-muted flex-1">{t('Custom (seconds)')}</span>
      <div className="flex items-center h-8 rounded-md border border-sf-border-input bg-sf-bg-input overflow-hidden">
        <button type="button" className="w-8 h-full text-sf-text-tertiary hover:text-sf-text-primary hover:bg-white/5" onClick={() => onChange(clamp(value - 30))} aria-label={t('Decrease')}>
          −
        </button>
        <input
          type="number"
          className="w-16 h-full bg-transparent text-center sf-mono text-[12.5px] text-sf-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          value={value}
          min={TTL_MIN}
          max={TTL_MAX}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        <button type="button" className="w-8 h-full text-sf-text-tertiary hover:text-sf-text-primary hover:bg-white/5" onClick={() => onChange(clamp(value + 30))} aria-label={t('Increase')}>
          +
        </button>
      </div>
    </div>
  );
}

/**
 * Gateway entry point. "Plan default" uses the gateway picked in the panel;
 * a fixed region keeps a sticky session on the same IP even if the
 * customer's network changes location.
 */
function EntryPoints({
  list,
  panelHost,
  value,
  onChange,
}: {
  list: EntryPoint[];
  panelHost?: string;
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const panelEntry = list.find((e) => e.host === panelHost);
  // Measured hourly by the background worker (lib/proxy/gateways).
  const [latency] = useStorageItem(gatewayLatencyItem);
  const ms = (host: string) => latency?.ms[host];
  const regions = [...new Set(list.map((e) => e.region))];
  return (
    <section>
      <SectionLabel>{t('Entry point')}</SectionLabel>
      <div className="sf-card !p-1.5 flex flex-col gap-0.5">
        <Row
          leading={<Icon name="layers" size={15} className="text-sf-text-tertiary" />}
          title={t('Plan default')}
          subtitle={panelEntry ? tf('{place} · set in your dashboard', { place: panelEntry.city ?? t(panelEntry.region) }) : t('As set in your dashboard')}
          selected={value === null}
          onClick={() => onChange(null)}
        />
        {regions.map((region) => (
          <div key={region}>
            <div className="px-3 pt-2.5 pb-1 sf-label !text-[10px]">{t(region)}</div>
            {list
              .filter((e) => e.region === region)
              .map((e) => (
                <Row
                  key={e.key}
                  leading={<Icon name={e.city ? 'pin' : 'globe'} size={15} className="text-sf-text-tertiary" />}
                  title={e.city ?? t('Nearest region')}
                  subtitle={
                    <span className="sf-mono">
                      {e.host}
                      {ms(e.host) != null && <span className="text-sf-text-muted"> · {ms(e.host)} ms</span>}
                    </span>
                  }
                  selected={value === e.key}
                  onClick={() => onChange(e.key)}
                />
              ))}
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[12px] leading-relaxed text-sf-text-muted">
        {t('A fixed region keeps a sticky IP even when your own network changes.')}
      </p>
    </section>
  );
}

function SwitchRow({
  title,
  body,
  warning,
  checked,
  onChange,
}: {
  title: string;
  body: string;
  warning?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-sf-text-tertiary">{body}</p>
        {warning && <p className="mt-1.5 text-[12px] leading-relaxed text-[#f0b461]">{warning}</p>}
      </div>
      <div className="pt-0.5">
        <Toggle checked={checked} onChange={onChange} label={title} />
      </div>
    </div>
  );
}

/**
 * Extensions don't run in private windows unless the user allows it. Then
 * Chrome/Edge still send private windows through the proxy but nothing
 * answers its login (the browser asks for one), and Firefox sends them
 * direct, without Shifter.
 */
function PrivateWindowsRow() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    const check = browser.extension?.isAllowedIncognitoAccess;
    if (check) check().then(setAllowed, () => setAllowed(null));
  }, []);
  if (allowed !== false) return null;

  const firefox = import.meta.env.FIREFOX;
  const edge = !firefox && navigator.userAgent.includes('Edg/');
  return (
    <div className="px-4 py-3.5">
      <div className="text-[13.5px] font-medium">{t('Private windows')}</div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-sf-text-tertiary">
        {firefox
          ? t('Private windows open without Shifter. To use it there: Add-ons and themes → Shifter → Run in Private Windows → Allow.')
          : edge
            ? t('InPrivate windows will ask for a proxy login. Allow Shifter there to connect them too.')
            : t('Incognito windows will ask for a proxy login. Allow Shifter there to connect them too.')}
      </p>
      {!firefox && (
        <button
          type="button"
          className="sf-link-btn text-[12px] mt-1.5 inline-flex items-center gap-1"
          onClick={() => void browser.tabs.create({ url: `${edge ? 'edge' : 'chrome'}://extensions/?id=${browser.runtime.id}` })}
        >
          {t('Open extension settings')} <Icon name="external" size={12} />
        </button>
      )}
    </div>
  );
}

function LinkRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center justify-between px-4 py-3 text-[13px] text-sf-text-secondary hover:text-sf-text-primary hover:bg-white/[0.03]">
      {children}
      <Icon name="external" size={13} className="text-sf-text-muted" />
    </button>
  );
}

function BypassList({ list, onChange }: { list: string[]; onChange: (l: string[]) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  function add(e: FormEvent) {
    e.preventDefault();
    const host = normalizeRule(value);
    if (!host) return setError(true);
    if (!list.includes(host)) onChange([...list, host]);
    setValue('');
    setError(false);
  }

  return (
    <section>
      <SectionLabel>{t('Bypass proxy for')}</SectionLabel>
      <div className="sf-card flex flex-col gap-3">
        <p className="text-[12px] leading-relaxed text-sf-text-tertiary -mb-0.5">{t('These sites always load directly, without Shifter. *.example.com includes example.com.')}</p>
        <div className="flex flex-wrap gap-1.5">
          {list.map((h) => (
            <span key={h} className="inline-flex items-center gap-1 h-[26px] pl-2 pr-1 rounded-md bg-white/[0.05] border border-sf-border-subtle sf-mono text-[11.5px]">
              {h}
              <button
                type="button"
                onClick={() => onChange(list.filter((x) => x !== h))}
                className="grid place-items-center w-4 h-4 rounded text-sf-text-muted hover:text-sf-text-primary hover:bg-white/10"
                aria-label={tf('Remove {host}', { host: h })}
              >
                <Icon name="x" size={11} strokeWidth={2.2} />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={add} className="flex gap-2">
          <input
            className="sf-input !min-h-[36px] !py-1.5 !text-[13px]"
            placeholder={t('example.com, *.example.com or 10.0.0.0/8')}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
            aria-invalid={error}
            style={error ? { borderColor: 'rgba(239,68,68,0.6)' } : undefined}
          />
          <button type="submit" className="sf-btn sf-btn-ghost sf-btn-sm !px-3" aria-label={t('Add')}>
            <Icon name="plus" size={14} />
          </button>
        </form>
      </div>
    </section>
  );
}
