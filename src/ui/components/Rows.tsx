import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Selectable list row used by the location and IP pickers. */
export function Row({
  leading,
  title,
  subtitle,
  selected,
  trailing,
  trailingIcon,
  onClick,
}: {
  leading: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  selected?: boolean;
  trailing?: ReactNode;
  trailingIcon?: IconName;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`sf-row ${selected ? 'is-selected' : ''}`} onClick={onClick}>
      <span className="w-6 grid place-items-center shrink-0">{leading}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[13.5px] font-medium">{title}</span>
        {subtitle && <span className="block truncate text-[12px] text-sf-text-tertiary mt-0.5">{subtitle}</span>}
      </span>
      {trailing}
      {selected && !trailingIcon && <Icon name="check" size={15} strokeWidth={2.4} className="text-sf-accent-light shrink-0" />}
      {trailingIcon && <Icon name={trailingIcon} size={15} className={`shrink-0 ${selected ? 'text-sf-accent-light' : 'text-sf-text-muted'}`} />}
    </button>
  );
}

export function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-3 py-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <div className="sf-skeleton w-5 h-3.5" />
          <div className="sf-skeleton h-3 flex-1" style={{ maxWidth: `${60 + i * 8}%` }} />
        </div>
      ))}
    </div>
  );
}
