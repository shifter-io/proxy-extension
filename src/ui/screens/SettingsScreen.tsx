import { useState, type FormEvent, type ReactNode } from 'react';
import { browser } from '#imports';
import { formatDuration } from '@/lib/format';
import { Icon } from '../components/Icon';
import { Screen, SectionLabel, Toggle, TopBar } from '../components/primitives';
import { openExternal, SHIFTER_URLS } from '../links';
import { useApp } from '../state/AppState';

const TTL_PRESETS = [60, 300, 600, 1800, 3600];
const TTL_MIN = 30;
const TTL_MAX = 24 * 3600;

export function SettingsScreen() {
  const { back, settings, updateSettings, session, signOut } = useApp();
  const sticky = settings.sessionMode === 'sticky';

  return (
    <Screen header={<TopBar onBack={back} title="Settings" />} bodyClassName="px-4 py-4 flex flex-col gap-6">
      {/* Session */}
      <section>
        <SectionLabel>IP session</SectionLabel>
        <div className="sf-card flex flex-col gap-4">
          <div className="sf-segmented">
            <button className={sticky ? 'active' : ''} onClick={() => updateSettings({ sessionMode: 'sticky' })}>
              <Icon name="clock" size={13} /> Sticky
            </button>
            <button className={!sticky ? 'active' : ''} onClick={() => updateSettings({ sessionMode: 'rotating' })}>
              <Icon name="shuffle" size={13} /> Rotating
            </button>
          </div>
          <p className="text-[12.5px] leading-relaxed text-sf-text-tertiary -mt-1">
            {sticky
              ? 'Keep the same exit IP for a while. Best for logins, carts and anything with a session.'
              : 'A fresh exit IP on every request. Best for scraping and price checks.'}
          </p>

          {sticky && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-sf-text-secondary">Session length (TTL)</span>
                <span className="sf-mono text-[12px] text-sf-text-tertiary">{settings.ttlSeconds}s</span>
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

      {/* Targeting + privacy */}
      <section>
        <SectionLabel>Connection</SectionLabel>
        <div className="sf-card !p-0 divide-y divide-sf-border-subtle">
          <SwitchRow
            title="Strict location"
            body="Fail instead of falling back to a wider area when the exact city or ASN has no free IP."
            checked={settings.strict}
            onChange={(strict) => updateSettings({ strict })}
          />
          <SwitchRow
            title="WebRTC leak protection"
            body="Stop sites from seeing your real IP through WebRTC while connected."
            checked={settings.webrtcProtection}
            onChange={(webrtcProtection) => updateSettings({ webrtcProtection })}
          />
        </div>
      </section>

      <BypassList list={settings.bypassList} onChange={(bypassList) => updateSettings({ bypassList })} />

      {/* Account */}
      <section>
        <SectionLabel>Account</SectionLabel>
        <div className="sf-card !p-0 divide-y divide-sf-border-subtle">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-8 h-8 rounded-full grid place-items-center bg-sf-accent-soft text-sf-accent-light text-[13px] font-semibold uppercase">
              {session?.user.email[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate">{session?.user.email}</div>
              <div className="text-[11.5px] text-sf-text-muted sf-mono">API key {maskKey(session?.apiKey)}</div>
            </div>
          </div>
          <LinkRow onClick={() => openExternal(SHIFTER_URLS.panel)}>Open Shifter dashboard</LinkRow>
          <LinkRow onClick={() => openExternal(SHIFTER_URLS.support)}>Help &amp; support</LinkRow>
        </div>
        <button type="button" className="sf-btn sf-btn-danger sf-btn-sm w-full mt-3" onClick={() => void signOut()}>
          <Icon name="logout" size={14} /> Sign out
        </button>
      </section>

      <p className="text-center text-[11px] text-sf-text-faint pb-1">
        Shifter extension v{browser.runtime.getManifest().version}
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
      <span className="text-[12px] text-sf-text-muted flex-1">Custom (seconds)</span>
      <div className="flex items-center h-8 rounded-md border border-sf-border-input bg-sf-bg-input overflow-hidden">
        <button type="button" className="w-8 h-full text-sf-text-tertiary hover:text-sf-text-primary hover:bg-white/5" onClick={() => onChange(clamp(value - 30))} aria-label="Decrease">
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
        <button type="button" className="w-8 h-full text-sf-text-tertiary hover:text-sf-text-primary hover:bg-white/5" onClick={() => onChange(clamp(value + 30))} aria-label="Increase">
          +
        </button>
      </div>
    </div>
  );
}

function SwitchRow({ title, body, checked, onChange }: { title: string; body: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-sf-text-tertiary">{body}</p>
      </div>
      <div className="pt-0.5">
        <Toggle checked={checked} onChange={onChange} label={title} />
      </div>
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

const HOST_RE = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$|^\d{1,3}(\.\d{1,3}){3}$/i;

function BypassList({ list, onChange }: { list: string[]; onChange: (l: string[]) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  function add(e: FormEvent) {
    e.preventDefault();
    const host = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!HOST_RE.test(host)) return setError(true);
    if (!list.includes(host)) onChange([...list, host]);
    setValue('');
    setError(false);
  }

  return (
    <section>
      <SectionLabel>Bypass proxy for</SectionLabel>
      <div className="sf-card flex flex-col gap-3">
        <p className="text-[12px] leading-relaxed text-sf-text-tertiary -mb-0.5">These sites always load directly, without Shifter.</p>
        <div className="flex flex-wrap gap-1.5">
          {list.map((h) => (
            <span key={h} className="inline-flex items-center gap-1 h-[26px] pl-2 pr-1 rounded-md bg-white/[0.05] border border-sf-border-subtle sf-mono text-[11.5px]">
              {h}
              <button
                type="button"
                onClick={() => onChange(list.filter((x) => x !== h))}
                className="grid place-items-center w-4 h-4 rounded text-sf-text-muted hover:text-sf-text-primary hover:bg-white/10"
                aria-label={`Remove ${h}`}
              >
                <Icon name="x" size={11} strokeWidth={2.2} />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={add} className="flex gap-2">
          <input
            className="sf-input !min-h-[36px] !py-1.5 !text-[13px]"
            placeholder="example.com or *.example.com"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
            aria-invalid={error}
            style={error ? { borderColor: 'rgba(239,68,68,0.6)' } : undefined}
          />
          <button type="submit" className="sf-btn sf-btn-ghost sf-btn-sm !px-3" aria-label="Add">
            <Icon name="plus" size={14} />
          </button>
        </form>
      </div>
    </section>
  );
}
