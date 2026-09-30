import { useEffect, useState } from 'react';
import { describeTarget, formatDuration, isUsable, targetCountryCode } from '@/lib/format';
import { sendProxyMessage } from '@/lib/proxy/messages';
import type { Membership, Target } from '@/lib/types';
import { Icon } from '../components/Icon';
import { ExpiryLine, MembershipMeta, UsageLine } from '../components/MembershipCard';
import { Flag, Glyph, Screen, Spinner, StatusPill, TopBar } from '../components/primitives';
import { defaultTarget, useApp } from '../state/AppState';

export function HomeScreen() {
  const { activeMembership: m, memberships, connection, push, connect, disconnect, targetFor, settings } = useApp();
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
                <span className="flex items-center gap-1 text-[13.5px] font-semibold leading-none">
                  <span className="truncate">{m.planName}</span>
                  {canSwitch && <Icon name="chevronDown" size={14} className="text-sf-text-tertiary shrink-0" />}
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
      bodyClassName="px-4 pb-4"
    >
      <ConnectHero
        status={status}
        exitIp={connection.status === 'connected' && connectedHere ? connection.exitIp : undefined}
        since={connection.status === 'connected' && connectedHere ? connection.since : undefined}
        error={connection.status === 'error' ? connection.message : undefined}
        needsTarget={!target}
        onToggle={toggle}
        countryCode={targetCountryCode(target)}
      />

      <LocationCard m={m} target={target} onOpen={() => push({ name: 'location' })} />

      <div className="flex items-center gap-2 mt-2.5">
        {m.type === 'residential' && (
          <button type="button" className="sf-pill sf-pill-neutral !py-1.5 !px-3 hover:!text-sf-text-primary cursor-pointer" onClick={() => push({ name: 'settings' })}>
            <Icon name={settings.sessionMode === 'sticky' ? 'clock' : 'shuffle'} size={12} />
            {settings.sessionMode === 'sticky' ? `Sticky · ${formatDuration(settings.ttlSeconds)}` : 'Rotating IP'}
          </button>
        )}
        {m.type === 'residential' && settings.strict && (
          <span className="sf-pill sf-pill-neutral !py-1.5 !px-3"><Icon name="lock" size={12} />Strict</span>
        )}
        {status === 'connected' && m.type === 'residential' && target && (
          <button
            type="button"
            className="ml-auto sf-pill sf-pill-info !py-1.5 !px-3 cursor-pointer hover:brightness-125"
            onClick={() => void sendProxyMessage({ type: 'proxy:connect', membershipId: m.id, target })}
          >
            <Icon name="refresh" size={12} /> New IP
          </button>
        )}
      </div>

      <PlanCard m={m} />
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
}: {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  exitIp?: string;
  since?: string;
  error?: string;
  needsTarget: boolean;
  onToggle: () => void;
  countryCode?: string;
}) {
  const connected = status === 'connected';
  const connecting = status === 'connecting';

  return (
    <section className="flex flex-col items-center pt-6 pb-5">
      <button
        type="button"
        onClick={onToggle}
        aria-label={connected || connecting ? 'Disconnect' : 'Connect'}
        className="relative w-[112px] h-[112px] rounded-full grid place-items-center cursor-pointer transition-transform active:scale-[0.97]"
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
          <Icon name="power" size={38} strokeWidth={2} className={connected ? 'text-[#62d399]' : 'text-sf-accent-light'} />
        )}
      </button>

      <div className="mt-4 text-center">
        <div className={`text-[17px] font-semibold ${connected ? 'text-[#62d399]' : ''}`} style={{ letterSpacing: '-0.02em' }}>
          {connected ? 'Connected' : connecting ? 'Connecting…' : status === 'error' ? 'Connection failed' : 'Not connected'}
        </div>
        <div className="mt-1 h-[18px] text-[12.5px] text-sf-text-tertiary flex items-center justify-center gap-1.5">
          {connected && exitIp && (
            <>
              <Flag code={countryCode} className="!w-4 !h-[11px]" />
              <span className="sf-mono text-sf-text-secondary">{exitIp}</span>
              {since && <Uptime since={since} />}
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
  const locked = m.type === 'residential' && m.pool === 'non-geo';
  const { title, subtitle } = locked
    ? { title: 'Random location', subtitle: 'Non-Geo plan · targeting not available' }
    : m.type === 'isp' && !target
      ? { title: 'Choose an IP', subtitle: `${m.ipCount} static ISP IPs on this plan` }
      : describeTarget(target);

  return (
    <button
      type="button"
      disabled={locked}
      onClick={onOpen}
      className="sf-card sf-card-interactive sf-accent-edge w-full !p-3.5 flex items-center gap-3 text-left disabled:cursor-default disabled:hover:bg-sf-bg-card"
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
        <span className={`block truncate text-[14px] font-semibold ${target?.kind === 'isp' ? 'sf-mono' : ''}`}>{title}</span>
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

function PlanCard({ m }: { m: Membership }) {
  return (
    <section className="sf-card mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <MembershipMeta m={m} />
        {m.status !== 'active' && <StatusPill status={m.status} />}
      </div>
      <UsageLine m={m} />
      <div className="text-[12px]">
        <ExpiryLine m={m} />
      </div>
    </section>
  );
}
