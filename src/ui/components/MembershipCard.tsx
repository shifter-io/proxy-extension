import { POOL_LABEL, PRODUCT_LABEL, formatBytes, formatDate, isUsable, relativeDays, trafficLeft } from '@/lib/format';
import type { Membership } from '@/lib/types';
import { Icon } from './Icon';
import { IconTile, ProgressBar, StatusPill } from './primitives';

/** Product type badge (Residential / ISP), shared by the list and the home plan card. */
export function MembershipMeta({ m }: { m: Membership }) {
  return (
    <span className={`sf-pill sf-pill--xs ${m.type === 'residential' ? 'sf-pill-info' : 'sf-pill-neutral'}`}>
      {PRODUCT_LABEL[m.type]}
    </span>
  );
}

/** Residential pool ("Full Geo") shown beside the plan title; nothing for ISP. */
export function PoolTag({ m }: { m: Membership }) {
  if (m.type !== 'residential') return null;
  return (
    <span className="shrink-0 text-[12px] font-normal text-sf-text-tertiary">
      <span className="text-sf-text-muted mr-1.5" aria-hidden>
        ·
      </span>
      {POOL_LABEL[m.pool]}
    </span>
  );
}

/**
 * Centred "Renews in 23 days · 23 Oct 2026" line; expired/suspended plans
 * get a Renew link. Used on the membership cards and under Home's stats.
 */
export function RenewalLine({ m, onRenew, className = '' }: { m: Membership; onRenew: () => void; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 text-center text-[12px] ${className}`}>
      <ExpiryLine m={m} />
      {!isUsable(m) && (
        <button
          type="button"
          className="sf-link-btn text-[12px] inline-flex items-center gap-1"
          onClick={(e) => {
            e.stopPropagation();
            onRenew();
          }}
        >
          Renew <Icon name="external" size={12} />
        </button>
      )}
    </div>
  );
}

export function ExpiryLine({ m }: { m: Membership }) {
  if (m.status === 'expired') return <span className="text-[#fca5a5]">Expired {formatDate(m.expiresAt)}</span>;
  const verb = m.autoRenew ? 'Renews' : 'Expires';
  const tone = m.status === 'expiring' ? 'text-[#f0b461]' : 'text-sf-text-tertiary';
  return (
    <span className={tone}>
      {verb} {relativeDays(m.expiresAt)} <span className="text-sf-text-muted">· {formatDate(m.expiresAt)}</span>
    </span>
  );
}

export function UsageLine({ m }: { m: Membership }) {
  if (m.type === 'isp') {
    return (
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-sf-text-tertiary">Bandwidth</span>
        <span className="sf-mono text-sf-text-secondary">Unlimited</span>
      </div>
    );
  }
  const { left, ratio } = trafficLeft(m);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px] mb-1.5">
        <span className="text-sf-text-tertiary">Traffic left</span>
        <span className="sf-mono">
          <span className="text-sf-text-primary font-medium">{formatBytes(left)}</span>
          <span className="text-sf-text-muted"> / {formatBytes(m.trafficTotalBytes, 0)}</span>
        </span>
      </div>
      <ProgressBar ratio={ratio} />
    </div>
  );
}

export function MembershipCard({ m, onSelect, onRenew }: { m: Membership; onSelect: () => void; onRenew: () => void }) {
  const usable = isUsable(m);
  return (
    <div
      role={usable ? 'button' : undefined}
      tabIndex={usable ? 0 : -1}
      onClick={usable ? onSelect : undefined}
      onKeyDown={(e) => usable && (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`sf-card ${usable ? 'sf-card-interactive' : 'opacity-60'} flex flex-col gap-3`}
    >
      <div className="flex items-center gap-3">
        <IconTile name={m.type === 'residential' ? 'globe' : 'server'} tone={m.type === 'residential' ? 'accent' : 'purple'} />
        <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
          <h3 className="min-w-0 truncate text-[14px] font-semibold">{m.planName}</h3>
          <PoolTag m={m} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {m.status !== 'active' && <StatusPill status={m.status} />}
          <MembershipMeta m={m} />
        </div>
      </div>

      <UsageLine m={m} />

      <RenewalLine m={m} onRenew={onRenew} className="pt-2.5 border-t border-sf-border-subtle" />
    </div>
  );
}
