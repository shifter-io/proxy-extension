import type { ReactNode } from 'react';
import glyphUrl from '@/assets/shifter-glyph.svg';
import wordmarkUrl from '@/assets/shifter-wordmark.svg';
import type { MembershipStatus } from '@/lib/types';
import { Icon, type IconName } from './Icon';

export function Wordmark({ height = 26 }: { height?: number }) {
  return <img src={wordmarkUrl} alt="Shifter" style={{ height, display: 'block' }} />;
}

export function Glyph({ size = 22 }: { size?: number }) {
  return <img src={glyphUrl} alt="Shifter" style={{ height: size, width: 'auto', display: 'block' }} />;
}

/** Flag PNGs are the same set the panel serves from /assets/global/img/flags. */
export function Flag({ code, className = '' }: { code?: string; className?: string }) {
  if (!code) {
    return (
      <span className={`sf-flag inline-flex items-center justify-center bg-sf-accent-soft text-sf-accent-light ${className}`}>
        <Icon name="globe" size={11} strokeWidth={2} />
      </span>
    );
  }
  return <img src={`/flags/${code}.png`} alt="" className={`sf-flag ${className}`} loading="lazy" />;
}

export function Spinner({ size = 16, tone = 'accent' }: { size?: number; tone?: 'accent' | 'white' }) {
  const colors =
    tone === 'white'
      ? 'border-white/40 border-t-white'
      : 'border-[rgba(91,163,255,0.25)] border-t-sf-accent-light';
  return (
    <span
      className={`inline-block rounded-full border-2 animate-sf-spin shrink-0 ${colors}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Screen chrome: top bar + scrollable body + optional pinned footer. */
export function Screen({
  header,
  footer,
  children,
  bodyClassName = '',
  atmosphere,
  surface = 'page',
}: {
  /** 'card' paints the screen like .sf-auth-card so inputs read darker, as on shifter.io/login. */
  surface?: 'page' | 'card';
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  atmosphere?: 'default' | 'connected';
}) {
  return (
    <div className={`absolute inset-0 flex flex-col ${surface === 'card' ? 'bg-sf-bg-elevated' : 'bg-sf-bg-deepest'}`}>
      {atmosphere && (
        <div className={`sf-atmosphere ${atmosphere === 'connected' ? 'sf-atmosphere--connected' : ''}`} aria-hidden>
          <span className="sf-atmosphere__halo" />
          <span className="sf-atmosphere__grid" />
        </div>
      )}
      {header && <div className="relative z-10 shrink-0">{header}</div>}
      <div className={`relative z-10 flex-1 min-h-0 overflow-y-auto ${bodyClassName}`}>{children}</div>
      {footer && <div className="relative z-10 shrink-0">{footer}</div>}
    </div>
  );
}

export function TopBar({
  title,
  onBack,
  left,
  right,
}: {
  title?: ReactNode;
  onBack?: () => void;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-2 h-14 px-3 border-b border-sf-border-subtle bg-sf-bg-deepest/70 backdrop-blur">
      {onBack && (
        <button type="button" className="sf-icon-btn" onClick={onBack} aria-label="Back">
          <Icon name="arrowLeft" size={16} />
        </button>
      )}
      {left}
      {title && <h1 className="flex-1 min-w-0 truncate text-[15px] font-semibold text-sf-text-primary">{title}</h1>}
      {!title && !left && <div className="flex-1" />}
      {right}
    </header>
  );
}

export function IconTile({ name, tone = 'accent', size = 36 }: { name: IconName; tone?: 'accent' | 'purple' | 'muted'; size?: number }) {
  const tones = {
    accent: { background: 'rgba(43,127,255,0.12)', border: 'rgba(43,127,255,0.22)', color: '#5BA3FF' },
    purple: { background: 'rgba(155,108,255,0.12)', border: 'rgba(155,108,255,0.24)', color: '#b89bff' },
    muted: { background: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', color: '#8893A8' },
  }[tone];
  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size, borderRadius: 10, background: tones.background, border: `1px solid ${tones.border}`, color: tones.color }}
    >
      <Icon name={name} size={Math.round(size * 0.46)} />
    </span>
  );
}

const STATUS_PILL: Record<MembershipStatus, { cls: string; label: string }> = {
  active: { cls: 'sf-pill-success', label: 'Active' },
  expiring: { cls: 'sf-pill-warning', label: 'Expiring soon' },
  expired: { cls: 'sf-pill-danger', label: 'Expired' },
  suspended: { cls: 'sf-pill-warning', label: 'Not active' },
};

/** `label` overrides the default text, e.g. the panel's "Pending Payment". */
export function StatusPill({ status, label }: { status: MembershipStatus; label?: string }) {
  const pill = STATUS_PILL[status];
  return <span className={`sf-pill sf-pill--xs ${pill.cls}`}>{label || pill.label}</span>;
}

export function ProgressBar({ ratio }: { ratio: number }) {
  const tone = ratio <= 0.1 ? 'danger' : ratio <= 0.25 ? 'warning' : '';
  return (
    <div className="sf-progress-track">
      <div className={`sf-progress-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="sf-toggle"
      onClick={() => onChange(!checked)}
    />
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="sf-search">
      <Icon name="search" size={15} className="sf-search__icon" />
      <input
        className="sf-search__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 sf-icon-btn !w-6 !h-6"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </label>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 mb-2">
      <span className="sf-label">{children}</span>
      {right}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-8 py-10">
      <IconTile name={icon} tone="muted" size={44} />
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-sf-text-tertiary">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
