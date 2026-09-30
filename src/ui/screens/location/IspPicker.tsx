import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { IspIp, IspMembership } from '@/lib/types';
import { Flag, EmptyState, Screen, SearchInput, SectionLabel, TopBar } from '../../components/primitives';
import { Row, RowsSkeleton } from '../../components/Rows';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../state/AppState';

/** ISP plans are a fixed set of static IPs: pick one, optionally filter by country. */
export function IspPicker({ m }: { m: IspMembership }) {
  const { back, targetFor, setTarget } = useApp();
  const current = targetFor(m.id);
  const selectedId = current?.kind === 'isp' ? current.ip.id : undefined;

  const ips = useAsync(() => api.ispIps(m.id), [m.id]);
  const [country, setCountry] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (ips.data ?? []).filter(
      (ip) =>
        (country === 'all' || ip.country === country) &&
        (!q || ip.ip.includes(q) || ip.city?.toLowerCase().includes(q) || ip.isp.toLowerCase().includes(q)),
    );
    const byCity = new Map<string, IspIp[]>();
    for (const ip of list) {
      const key = `${ip.country}|${ip.city ?? ''}`;
      byCity.set(key, [...(byCity.get(key) ?? []), ip]);
    }
    return [...byCity.entries()];
  }, [ips.data, country, query]);

  async function pick(ip: IspIp) {
    await setTarget(m.id, { kind: 'isp', ip });
    back();
  }

  return (
    <Screen
      header={
        <>
          <TopBar onBack={back} title="Choose an IP" right={<span className="sf-pill sf-pill--xs sf-pill-neutral mr-1">{m.ipCount} IPs</span>} />
          <div className="px-4 pt-3 pb-2 flex flex-col gap-2.5">
            <SearchInput value={query} onChange={setQuery} placeholder="Search IP, city or carrier" autoFocus />
            {m.countries.length > 1 && (
              <div className="sf-segmented">
                <button className={country === 'all' ? 'active' : ''} onClick={() => setCountry('all')}>
                  All
                </button>
                {m.countries.map((c) => (
                  <button key={c} className={country === c ? 'active' : ''} onClick={() => setCountry(c)}>
                    <Flag code={c} className="!w-4 !h-[11px]" />
                    {c.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      }
      bodyClassName="px-3 pb-3"
    >
      {ips.loading && <RowsSkeleton />}
      {!ips.loading && groups.length === 0 && (
        <EmptyState icon="search" title="No IPs match" body="Try a different IP, city or carrier." />
      )}
      <div className="flex flex-col gap-4 pt-1">
        {groups.map(([key, list]) => {
          const [cc = '', city] = key.split('|');
          return (
            <div key={key}>
              <SectionLabel right={<span className="sf-mono text-[11px] text-sf-text-muted">{list.length}</span>}>
                <span className="inline-flex items-center gap-1.5">
                  <Flag code={cc} className="!w-4 !h-[11px]" />
                  {city || cc.toUpperCase()}
                </span>
              </SectionLabel>
              {list.map((ip) => (
                <Row
                  key={ip.id}
                  leading={<span className="w-2 h-2 rounded-full bg-sf-success shadow-[0_0_0_3px_rgba(61,186,120,0.15)]" />}
                  title={<span className="sf-mono">{ip.ip}</span>}
                  subtitle={ip.isp}
                  selected={ip.id === selectedId}
                  onClick={() => pick(ip)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
