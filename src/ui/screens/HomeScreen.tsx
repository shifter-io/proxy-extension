import { useEffect, useState, type ReactNode } from 'react';
import { describeTarget, formatBytes, formatDuration, isUsable, targetCountryCode, trafficLeft } from '@/lib/format';
import { POOL_LIMIT_NOTE, POOL_TARGETING } from '@/lib/pools';
import { sendProxyMessage } from '@/lib/proxy/messages';
import type { Membership, ProxySettings, Target } from '@/lib/types';
import { Icon } from '../components/Icon';
import { PoolTag, RenewalLine } from '../components/MembershipCard';
import { Flag, Glyph, Screen, Spinner, TopBar } from '../components/primitives';
import { openExternal, SHIFTER_URLS } from '../links';
import { defaultTarget, useApp } from '../state/AppState';

export function HomeScreen() {
  const { activeMembership: m, memberships, connection, push, connect, disconnect, targetFor, settings } = useApp();

  // Fresh exit IP as soon as the popup opens; the worker re-checks every 15 s after that.
  const isConnected = connection.status === 'connected';
  useEffect(() => {
    if (isConnected) void sendProxyMessage({ type: 'proxy:check' }).catch(() => undefined);
  }, [isConnected]);

  if (!m) return null;

  const target = targetFor(m.id) ?? defaultTarget(m);
  const connectedHere = connection.status !== 'disconnected' && connection.status !== 'error' && connection.membershipId === m.id;
  const status = connectedHere ? connection.status : connection.status === 'error' ? 'error' : 'disconnected';
  const canSwitch = (memberships?.filter(isUsable).length ?? 0) > 1;

  function toggle() {
    if (status === 'connected' || status === 'connecting') return void disconnect();
    if (!target) return push({ name: 'location' });
    void connect();
  }

  return (
    <Screen
      atmosphere={status === 'connected' ? 'connected' : 'default'}
      header={
        <TopBar
          left={
            <button
              type="button"
              className={`flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-lg px-1.5 py-1 -mx-0.5 ${canSwitch ? 'hover:bg-white/[0.04] cursor-pointer' : 'cursor-default'}`}
              onClick={canSwitch ? () => push({ name: 'memberships' }) : undefined}
              aria-label={canSwitch ? 'Switch membership' : undefined}
            >
              <Glyph size={22} />
              <span className="min-w-0 flex-1">
                <span className="block text-[10.5px] tracking-[0.14em] uppercase text-sf-text-muted leading-none mb-1">Membership</span>
                <span className="flex items-baseline gap-1.5 text-[13.5px] font-semibold leading-none">
                  <span className="truncate">{m.planName}</span>
                  <PoolTag m={m} />
                  {canSwitch && <Icon name="chevronDown" size={14} className="text-sf-text-tertiary shrink-0 self-center" />}
                </span>
              </span>
            </button>
          }
          right={
            <button type="button" className="sf-icon-btn" aria-label="Settings" onClick={() => push({ name: 'settings' })}>
              <Icon name="settings" size={16} />
            </button>
          }
        />
      }
      bodyClassName="px-5 pb-6 flex flex-col"
    >
      {/* Hero, location and stats form one block, centred in the popup. */}
      <div className="flex-1 flex flex-col justify-center py-2">
      <ConnectHero
        status={status}
        exitIp={connection.status === 'connected' && connectedHere ? connection.exitIp : undefined}
        since={connection.status === 'connected' && connectedHere ? connection.since : undefined}
        error={connection.status === 'error' ? connection.message : undefined}
        needsTarget={!target}
        onToggle={toggle}
        countryCode={(connection.status === 'connected' && connectedHere && connection.exitCountry) || targetCountryCode(target)}
        // A fresh session id pins a new exit IP (residential only; ISP IPs are static).
        onNewIp={
          m.type === 'residential' && target
            ? () => void sendProxyMessage({ type: 'proxy:connect', membershipId: m.id, target })
            : undefined
        }
      />

      {connection.status === 'connected' && connectedHere && connection.loginStale && (
        <p className="-mt-4 mb-4 px-1 text-center text-[12px] leading-relaxed text-[#f0b461]">
          Restart Firefox to fully apply this change: sites you already opened may keep the previous location.
        </p>
      )}
      <LocationCard m={m} target={target} onOpen={() => push({ name: 'location' })} />
      {m.type === 'residential' && !POOL_TARGETING[m.pool].country && (
        <p className="mt-2.5 px-1 flex gap-2 text-[12px] leading-relaxed text-sf-text-muted">
          <Icon name="lock" size={13} className="shrink-0 mt-0.5" />
          {POOL_LIMIT_NOTE[m.pool]}
        </p>
      )}

      <StatsCard m={m} settings={settings} onSession={() => push({ name: 'settings' })} />
      <RenewalLine m={m} onRenew={() => openExternal(SHIFTER_URLS.renew(m))} className="mt-4" />
      </div>
    </Screen>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────

function ConnectHero({
  status,
  exitIp,
  since,
  error,
  needsTarget,
  onToggle,
  countryCode,
  onNewIp,
}: {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  exitIp?: string;
  since?: string;
  error?: string;
  needsTarget: boolean;
  onToggle: () => void;
  countryCode?: string;
  onNewIp?: () => void;
}) {
  const connected = status === 'connected';
  const connecting = status === 'connecting';

  return (
    <section className="flex flex-col items-center pt-10 pb-9">
      <button
        type="button"
        onClick={onToggle}
        aria-label={connected || connecting ? 'Disconnect' : 'Connect'}
        className="relative w-[124px] h-[124px] rounded-full grid place-items-center cursor-pointer transition-transform active:scale-[0.97]"
        style={{
          background: connected
            ? 'radial-gradient(circle at 50% 35%, rgba(61,186,120,0.30), rgba(61,186,120,0.08) 70%)'
            : 'radial-gradient(circle at 50% 35%, rgba(43,127,255,0.22), rgba(19,25,39,0.9) 70%)',
          border: `1px solid ${connected ? 'rgba(61,186,120,0.45)' : 'rgba(43,127,255,0.30)'}`,
          boxShadow: connected
            ? '0 0 0 8px rgba(61,186,120,0.06), 0 12px 40px -8px rgba(61,186,120,0.45)'
            : '0 0 0 8px rgba(43,127,255,0.05), 0 12px 40px -12px rgba(43,127,255,0.45)',
        }}
      >
        {connected && (
          <>
            <span className="absolute inset-0 rounded-full border border-[rgba(61,186,120,0.45)] animate-sf-ring" />
            <span className="absolute inset-0 rounded-full border border-[rgba(61,186,120,0.35)] animate-sf-ring [animation-delay:1.2s]" />
          </>
        )}
        {connecting ? (
          <Spinner size={40} />
        ) : (
          <Icon name="power" size={42} strokeWidth={2} className={connected ? 'text-[#62d399]' : 'text-sf-accent-light'} />
        )}
      </button>

      <div className="mt-6 text-center">
        <div className={`text-[17px] font-semibold ${connected ? 'text-[#62d399]' : ''}`} style={{ letterSpacing: '-0.02em' }}>
          {connected ? 'Connected' : connecting ? 'Connecting…' : status === 'error' ? 'Connection failed' : 'Not connected'}
        </div>
        <div className="mt-1.5 h-[18px] text-[12.5px] text-sf-text-tertiary flex items-center justify-center gap-1.5">
          {connected && exitIp && (
            <>
              <Flag code={countryCode} className="!w-4 !h-[11px]" />
              <span className="sf-mono text-sf-text-secondary">{exitIp}</span>
              {since && <Uptime since={since} />}
              {onNewIp && (
                <button
                  type="button"
                  onClick={onNewIp}
                  className="ml-0.5 grid place-items-center w-6 h-6 rounded-md text-sf-text-muted hover:text-sf-accent-light hover:bg-white/5"
                  aria-label="Get a new IP"
                  data-tip="New IP"
                >
                  <Icon name="refresh" size={13} />
                </button>
              )}
            </>
          )}
          {connecting && 'Securing your route through Shifter'}
          {status === 'disconnected' && (needsTarget ? 'Pick an IP to get started' : 'Tap to route this browser through Shifter')}
          {status === 'error' && <span className="text-[#fca5a5]">{error}</span>}
        </div>
      </div>
    </section>
  );
}

function Uptime({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return <span className="sf-mono text-sf-text-muted">· {hh}:{mm}:{ss}</span>;
}

// ── Location + plan ─────────────────────────────────────────────────────

function LocationCard({ m, target, onOpen }: { m: Membership; target?: Target; onOpen: () => void }) {
  const locked = m.type === 'residential' && !POOL_TARGETING[m.pool].country;
  const { title, subtitle } = locked
    ? { title: 'Random location', subtitle: 'Worldwide · Non-Geo plan' }
    : m.type === 'isp' && !target
      ? { title: 'Choose an IP', subtitle: `${m.ipCount} static ISP IPs on this plan` }
      : m.type === 'residential' && !POOL_TARGETING[m.pool].subCountry && target?.kind === 'residential' && target.country
        ? { title: target.country.name, subtitle: 'Country-level · Country Geo plan' }
        : describeTarget(target);

  return (
    <button
      type="button"
      disabled={locked}
      onClick={onOpen}
      className="sf-card sf-card-interactive sf-accent-edge w-full !p-4 flex items-center gap-3.5 text-left disabled:cursor-default disabled:hover:bg-sf-bg-card"
    >
      <span className="w-10 h-10 rounded-[10px] grid place-items-center bg-white/[0.03] border border-sf-border-subtle shrink-0">
        {m.type === 'isp' && !target ? (
          <Icon name="server" size={18} className="text-sf-text-tertiary" />
        ) : !targetCountryCode(target) ? (
          <Icon name="globe" size={19} className="text-sf-accent-light" />
        ) : (
          <Flag code={targetCountryCode(target)} className="!w-[22px] !h-[15px]" />
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block sf-label !text-[10px] mb-1">{m.type === 'isp' ? 'Static IP' : 'Location'}</span>
        <span className="block truncate text-[14px] font-semibold">{title}</span>
        <span className="block truncate text-[12px] text-sf-text-tertiary mt-0.5">{subtitle}</span>
      </span>
      {locked ? (
        <Icon name="lock" size={15} className="text-sf-text-muted" />
      ) : (
        <span className="flex items-center gap-1 text-[12px] font-medium text-sf-accent-light">
          Change <Icon name="chevronRight" size={14} />
        </span>
      )}
    </button>
  );
}

/**
 * Two-up stats card under the location, styled after the login page's
 * .sf-auth-stats (micro uppercase label, mono value). Left: what's left on
 * the plan. Right: the IP session, which opens Settings.
 */
function StatsCard({ m, settings, onSession }: { m: Membership; settings: ProxySettings; onSession: () => void }) {
  return (
    <section className="sf-card !p-0 mt-3 grid grid-cols-2 divide-x divide-sf-border-subtle overflow-hidden">
      <UsageStat m={m} />
      {m.type === 'isp' ? (
        <Stat label="IP" value="Static" sub="Same IP every time" />
      ) : !m.stickySessions ? (
        <Stat label="Session" value="Rotating" sub="New IP per request" />
      ) : (
        <button
          type="button"
          onClick={onSession}
          className="group text-left transition-colors hover:bg-white/[0.03]"
          aria-label="Change IP session settings"
        >
          <Stat
            label="Session"
            value={settings.sessionMode === 'sticky' ? formatDuration(settings.ttlSeconds) : 'Rotating'}
            sub={settings.sessionMode === 'sticky' ? 'Sticky IP' : 'New IP per request'}
            action
          />
        </button>
      )}
    </section>
  );
}

function UsageStat({ m }: { m: Membership }) {
  if (m.type === 'isp') return <Stat label="Bandwidth" value="Unlimited" sub="No traffic cap" />;

  const usage = trafficLeft(m);
  if (!usage) {
    return <Stat label="Traffic left" value="—" sub="Not available yet" />;
  }
  const tone = usage.ratio <= 0.1 ? 'danger' : usage.ratio <= 0.25 ? 'warning' : '';
  return (
    <Stat
      label="Traffic left"
      value={
        <>
          {formatBytes(usage.left)}
          <span className="text-[12px] font-normal text-sf-text-muted"> / {formatBytes(usage.total, 0)}</span>
        </>
      }
      sub={
        <span className="block h-[3px] mt-1 rounded-full bg-sf-bar-track overflow-hidden">
          <span className={`block sf-progress-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(1, usage.ratio)) * 100}%` }} />
        </span>
      }
    />
  );
}

function Stat({
  label,
  value,
  sub,
  action,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  action?: boolean;
}) {
  return (
    // <span> not <div>: this sits inside the Session <button>.
    <span className="px-4 py-3.5 flex flex-col gap-1.5 min-w-0">
      <span className="flex items-center justify-between sf-label !text-[10px]">
        {label}
        {action && <Icon name="chevronRight" size={13} className="text-sf-text-muted group-hover:text-sf-accent-light transition-colors" />}
      </span>
      <span className="flex items-center gap-1.5 sf-mono text-[15px] font-semibold text-sf-text-primary leading-none truncate">
        {value}
      </span>
      <span className="text-[11.5px] text-sf-text-tertiary leading-tight truncate">{sub}</span>
    </span>
  );
}
