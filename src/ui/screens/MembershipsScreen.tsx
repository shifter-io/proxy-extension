import type { Membership } from '@/lib/types';
import { isUsable } from '@/lib/format';
import { Icon } from '../components/Icon';
import { MembershipCard } from '../components/MembershipCard';
import { EmptyState, Screen, SectionLabel, TopBar, Wordmark } from '../components/primitives';
import { openExternal, SHIFTER_URLS } from '../links';
import { useApp } from '../state/AppState';

export function MembershipsScreen() {
  const { memberships, workspaces, membershipsError, reloadMemberships, selectMembership, reset, back, push, activeMembership } = useApp();

  // Reached from Home via "switch plan" → back arrow; right after login → no back.
  const canGoBack = !!activeMembership;
  const grouped = workspaces.length > 1 || workspaces.some((w) => !w.personal);
  const groups = grouped
    ? workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        memberships: (memberships ?? []).filter((m) => m.workspace?.id === workspace.id || (!m.workspace && workspace.personal)),
      }))
    : [{ id: 'all', name: '', memberships: memberships ?? [] }];
  // Older responses have no workspace metadata. Never hide those plans.
  if (grouped && !workspaces.some((w) => w.personal) && memberships?.some((m) => !m.workspace)) {
    groups.unshift({ id: 'legacy-personal', name: 'Personal', memberships: memberships.filter((m) => !m.workspace) });
  }

  async function choose(id: string) {
    await selectMembership(id);
    if (canGoBack) back();
    else reset({ name: 'home' });
  }

  return (
    <Screen
      header={
        <TopBar
          onBack={canGoBack ? back : undefined}
          left={<span className="flex-1 pl-1.5"><Wordmark height={22} /></span>}
          right={
            <button type="button" className="sf-icon-btn" aria-label="Settings" onClick={() => push({ name: 'settings' })}>
              <Icon name="settings" size={16} />
            </button>
          }
        />
      }
      bodyClassName="px-4 py-4"
    >
      {!memberships && !membershipsError && <ListSkeleton />}

      {membershipsError && (
        <EmptyState
          icon="refresh"
          title="Something went wrong"
          body={membershipsError}
          action={<button className="sf-btn sf-btn-ghost sf-btn-sm" onClick={() => reloadMemberships()}>Try again</button>}
        />
      )}

      {memberships && (
        <>

          {grouped ? groups.map((group) => (
            <section key={group.id} aria-label={group.name || 'Memberships'} className="mb-6">
              <h2 className="mb-3 text-[14px] font-semibold break-words">{group.name}</h2>
              <PlanList memberships={group.memberships} grouped={grouped} onChoose={choose} />
            </section>
          )) : <PlanList memberships={memberships} grouped={false} onChoose={choose} />}

          <button
            type="button"
            className="mt-6 mb-2 w-full sf-btn sf-btn-ghost sf-btn-sm"
            onClick={() => openExternal(SHIFTER_URLS.order)}
          >
            <Icon name="plus" size={14} /> Add a plan
          </button>
        </>
      )}
    </Screen>
  );
}

function PlanList({ memberships, grouped, onChoose }: { memberships: Membership[]; grouped: boolean; onChoose: (id: string) => void }) {
  const usable = memberships.filter(isUsable);
  const inactive = memberships.filter((m) => !isUsable(m));
  return (
    <>
      {usable.length === 0 && (
        grouped ? (
          <p className="text-[12px] text-sf-text-tertiary">No active Residential or ISP plans in this workspace.</p>
        ) : (
          <EmptyState
            icon="layers"
            title="No active memberships"
            body="Get a Residential or ISP plan on Shifter and it will show up here instantly."
            action={<button className="sf-btn sf-btn-primary sf-btn-sm" onClick={() => openExternal(SHIFTER_URLS.order)}>View plans <Icon name="external" size={13} /></button>}
          />
        )
      )}
      {usable.length > 0 && (
        <div className="flex flex-col gap-3 animate-sf-fade-in">
          <SectionLabel right={<span className="sf-mono text-[11px] text-sf-text-muted">{usable.length}</span>}>Active</SectionLabel>
          {usable.map((m) => <MembershipCard key={m.id} m={m} onSelect={() => onChoose(m.id)} onRenew={() => openExternal(SHIFTER_URLS.renew(m))} />)}
        </div>
      )}
      {inactive.length > 0 && (
        <div className="flex flex-col gap-3 mt-6">
          <SectionLabel>Inactive</SectionLabel>
          {inactive.map((m) => <MembershipCard key={m.id} m={m} onSelect={() => undefined} onRenew={() => openExternal(SHIFTER_URLS.renew(m))} />)}
        </div>
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="sf-card flex flex-col gap-3">
          <div className="flex gap-3">
            <div className="sf-skeleton w-9 h-9 !rounded-[10px]" />
            <div className="flex-1 flex flex-col gap-2 pt-1">
              <div className="sf-skeleton h-3.5 w-2/3" />
              <div className="sf-skeleton h-3 w-1/3" />
            </div>
          </div>
          <div className="sf-skeleton h-1.5 w-full" />
        </div>
      ))}
    </div>
  );
}
