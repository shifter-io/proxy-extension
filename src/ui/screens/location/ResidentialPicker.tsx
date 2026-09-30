import { useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { describeTarget, POOL_LABEL, POPULAR_COUNTRIES, sameTarget } from '@/lib/format';
import type { GeoCountry, GeoRegion, GeoSearchResult, ResidentialMembership, ResidentialTarget } from '@/lib/types';
import { Icon, type IconName } from '../../components/Icon';
import { EmptyState, Flag, Screen, SearchInput, SectionLabel, TopBar } from '../../components/primitives';
import { Row, RowsSkeleton } from '../../components/Rows';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { useApp } from '../../state/AppState';

type View =
  | { level: 'countries' }
  | { level: 'country'; country: GeoCountry }
  | { level: 'region'; country: GeoCountry; region: GeoRegion };

type Tab = 'regions' | 'cities' | 'asn';

const WORLDWIDE: ResidentialTarget = { kind: 'residential' };

/**
 * Residential targeting. Two ways in, one result:
 *  - Search: one box across countries, states, cities and ASNs (tap = use it).
 *  - Browse: Country → State → City, with ASN as an extra filter. The chip bar
 *    at the bottom shows exactly what will be sent; "Use" commits it.
 * Pool limits (Country Geo / Non-Geo) come from ResidentialPools in the panel.
 */
export function ResidentialPicker({ m }: { m: ResidentialMembership }) {
  const { back, targetFor, setTarget, recentTargets } = useApp();
  const current = targetFor(m.id);
  const countryOnly = m.pool === 'country';

  const [draft, setDraft] = useState<ResidentialTarget>(current?.kind === 'residential' ? current : WORLDWIDE);
  const [view, setView] = useState<View>(() =>
    !countryOnly && draft.country
      ? draft.region
        ? { level: 'region', country: draft.country, region: draft.region }
        : { level: 'country', country: draft.country }
      : { level: 'countries' },
  );
  const [tab, setTab] = useState<Tab>(draft.asn && !draft.region ? 'asn' : 'regions');
  const [query, setQuery] = useState('');

  async function apply(target: ResidentialTarget) {
    await setTarget(m.id, target);
    back();
  }

  function go(next: View) {
    setQuery('');
    setView(next);
  }

  function upOneLevel() {
    if (view.level === 'region') return go({ level: 'country', country: view.country });
    if (view.level === 'country') return go({ level: 'countries' });
    back();
  }

  const title =
    view.level === 'countries' ? 'Choose location' : view.level === 'country' ? view.country.name : view.region.name;

  return (
    <Screen
      header={
        <>
          <TopBar onBack={upOneLevel} title={title} right={<span className="sf-pill sf-pill--xs sf-pill-info mr-1">{POOL_LABEL[m.pool]}</span>} />
          <div className="px-4 pt-3 pb-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              autoFocus
              placeholder={
                view.level === 'countries'
                  ? countryOnly
                    ? 'Search countries'
                    : 'Search country, state, city or ASN'
                  : view.level === 'country'
                    ? `Search in ${view.country.name}`
                    : `Search cities in ${view.region.name}`
              }
            />
          </div>
        </>
      }
      footer={
        !countryOnly && (
          <SelectionBar
            draft={draft}
            onChange={setDraft}
            unchanged={!!current && sameTarget(current, draft)}
            onApply={() => apply(draft)}
          />
        )
      }
      bodyClassName="px-3 pb-3"
    >
      {view.level === 'countries' && (
        <CountriesView
          query={query}
          countryOnly={countryOnly}
          draft={draft}
          recent={recentTargets.filter((t): t is ResidentialTarget => t.kind === 'residential' && (!countryOnly || (!t.region && !t.city && !t.asn)))}
          onPickCountry={(country) => {
            if (countryOnly) return void apply({ kind: 'residential', country });
            setDraft((d) => (d.country?.code === country.code ? d : { kind: 'residential', country }));
            go({ level: 'country', country });
          }}
          onApply={apply}
        />
      )}

      {view.level === 'country' && (
        <CountryView
          country={view.country}
          query={query}
          tab={tab}
          onTab={setTab}
          draft={draft}
          setDraft={setDraft}
          onOpenRegion={(region) => go({ level: 'region', country: view.country, region })}
        />
      )}

      {view.level === 'region' && (
        <RegionView country={view.country} region={view.region} query={query} draft={draft} setDraft={setDraft} />
      )}

      {countryOnly && view.level === 'countries' && !query && (
        <p className="mx-2 mt-4 mb-2 text-[12px] leading-relaxed text-sf-text-muted flex gap-2">
          <Icon name="lock" size={13} className="shrink-0 mt-0.5" />
          Your Country Geo plan targets by country. Full Geo adds state, city and ASN targeting.
        </p>
      )}
    </Screen>
  );
}

// ── Level 1: countries + global search ──────────────────────────────────

function CountriesView({
  query,
  countryOnly,
  draft,
  recent,
  onPickCountry,
  onApply,
}: {
  query: string;
  countryOnly: boolean;
  draft: ResidentialTarget;
  recent: ResidentialTarget[];
  onPickCountry: (c: GeoCountry) => void;
  onApply: (t: ResidentialTarget) => void;
}) {
  const countries = useAsync(() => api.countries(), []);
  const q = useDebounced(query.trim(), 180);
  const search = useAsync(() => (q ? api.searchGeo(q) : Promise.resolve([])), [q]);

  if (q) {
    const hits = (search.data ?? []).filter((h) => !countryOnly || h.kind === 'country');
    if (!search.loading && hits.length === 0) {
      return <EmptyState icon="search" title="No matches" body={`Nothing found for “${q}”. Try a country, state, city or ASN number.`} />;
    }
    return (
      <div className="flex flex-col gap-0.5">
        {hits.map((h) => (
          <SearchHitRow
            key={`${h.kind}-${h.country.code}-${h.region?.slug ?? ''}-${h.city?.slug ?? ''}-${h.asn?.asn ?? ''}`}
            hit={h}
            onClick={() => onApply(hitToTarget(h))}
          />
        ))}
      </div>
    );
  }

  const all = countries.data ?? [];
  const popular = POPULAR_COUNTRIES.map((code) => all.find((c) => c.code === code)).filter(Boolean) as GeoCountry[];
  const selectedCode = draft.country?.code;

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div>
        <Row
          leading={<Flag />}
          title="Random location"
          subtitle="Best available IP, anywhere"
          selected={!draft.country}
          onClick={() => onApply(WORLDWIDE)}
        />
      </div>

      {recent.length > 0 && (
        <div>
          <SectionLabel>Recent</SectionLabel>
          {recent.slice(0, 3).map((t, i) => {
            const d = describeTarget(t);
            return (
              <Row key={i} leading={<Flag code={t.country?.code} />} title={d.title} subtitle={d.subtitle} trailingIcon="history" onClick={() => onApply(t)} />
            );
          })}
        </div>
      )}

      <div>
        <SectionLabel>Popular</SectionLabel>
        {popular.map((c) => (
          <CountryRow key={c.code} c={c} selected={selectedCode === c.code} drill={!countryOnly} onClick={() => onPickCountry(c)} />
        ))}
      </div>

      <div>
        <SectionLabel right={<span className="sf-mono text-[11px] text-sf-text-muted">{all.length}</span>}>All countries</SectionLabel>
        {countries.loading && <RowsSkeleton />}
        {[...all]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => (
            <CountryRow key={c.code} c={c} selected={selectedCode === c.code} drill={!countryOnly} onClick={() => onPickCountry(c)} />
          ))}
      </div>
    </div>
  );
}

function hitToTarget(h: GeoSearchResult): ResidentialTarget {
  return { kind: 'residential', country: h.country, region: h.region, city: h.city, asn: h.asn };
}

const HIT_META: Record<GeoSearchResult['kind'], { label: string; icon: IconName }> = {
  country: { label: 'Country', icon: 'globe' },
  region: { label: 'State', icon: 'map' },
  city: { label: 'City', icon: 'pin' },
  asn: { label: 'ASN', icon: 'network' },
};

function SearchHitRow({ hit, onClick }: { hit: GeoSearchResult; onClick: () => void }) {
  const title =
    hit.kind === 'asn' ? hit.asn!.name : hit.kind === 'city' ? hit.city!.name : hit.kind === 'region' ? hit.region!.name : hit.country.name;
  const subtitle =
    hit.kind === 'asn'
      ? `AS${hit.asn!.asn} · ${hit.country.name}`
      : hit.kind === 'city'
        ? [hit.region?.name, hit.country.name].filter(Boolean).join(', ')
        : hit.kind === 'region'
          ? hit.country.name
          : 'Any city';
  return (
    <Row
      leading={<Flag code={hit.country.code} />}
      title={title}
      subtitle={subtitle}
      onClick={onClick}
      trailing={
        <span className="sf-pill sf-pill--xs sf-pill-neutral">
          <Icon name={HIT_META[hit.kind].icon} size={11} />
          {HIT_META[hit.kind].label}
        </span>
      }
    />
  );
}

// ── Level 2: inside a country ───────────────────────────────────────────

function CountryView({
  country,
  query,
  tab,
  onTab,
  draft,
  setDraft,
  onOpenRegion,
}: {
  country: GeoCountry;
  query: string;
  tab: Tab;
  onTab: (t: Tab) => void;
  draft: ResidentialTarget;
  setDraft: (t: ResidentialTarget) => void;
  onOpenRegion: (r: GeoRegion) => void;
}) {
  const regions = useAsync(() => api.regions(country.code), [country.code]);
  const cities = useAsync(() => api.cities(country.code), [country.code]);
  const asns = useAsync(() => api.asns(country.code), [country.code]);
  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);

  const regionList = (regions.data ?? []).filter((r) => match(r.name));
  const cityList = (cities.data ?? []).filter((c) => match(c.name));
  const asnList = (asns.data ?? []).filter((a) => match(a.name) || String(a.asn).startsWith(q.replace(/^as/, '')));
  const regionBySlug = useMemo(() => new Map((regions.data ?? []).map((r) => [r.slug, r])), [regions.data]);

  const loading = { regions: regions.loading, cities: cities.loading, asn: asns.loading }[tab];

  return (
    <div className="flex flex-col gap-3 pt-1">
      <Row
        leading={<Flag code={country.code} />}
        title={`Any location in ${country.name}`}
        subtitle="Country-level targeting"
        selected={draft.country?.code === country.code && !draft.region && !draft.city}
        onClick={() => setDraft({ kind: 'residential', country, asn: draft.asn })}
      />

      <div className="sf-segmented mx-1">
        <button className={tab === 'regions' ? 'active' : ''} onClick={() => onTab('regions')}>
          States <Count n={regions.data?.length} />
        </button>
        <button className={tab === 'cities' ? 'active' : ''} onClick={() => onTab('cities')}>
          Cities <Count n={cities.data?.length} />
        </button>
        <button className={tab === 'asn' ? 'active' : ''} onClick={() => onTab('asn')}>
          ASN <Count n={asns.data?.length} />
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        {loading && <RowsSkeleton />}

        {!loading && tab === 'regions' &&
          (regionList.length ? (
            regionList.map((r) => (
              <Row
                key={r.slug}
                leading={<LevelIcon name="map" />}
                title={r.name}
                selected={draft.region?.slug === r.slug}
                subtitle={draft.region?.slug === r.slug && draft.city ? draft.city.name : undefined}
                trailingIcon="chevronRight"
                onClick={() => {
                  if (draft.region?.slug !== r.slug) setDraft({ kind: 'residential', country, region: r, asn: draft.asn });
                  onOpenRegion(r);
                }}
              />
            ))
          ) : (
            <NoneHere what="states" />
          ))}

        {!loading && tab === 'cities' &&
          (cityList.length ? (
            cityList.map((c) => (
              <Row
                key={`${c.regionSlug}-${c.slug}`}
                leading={<LevelIcon name="pin" />}
                title={c.name}
                subtitle={c.regionSlug ? regionBySlug.get(c.regionSlug)?.name : undefined}
                selected={draft.city?.slug === c.slug && draft.region?.slug === c.regionSlug}
                onClick={() =>
                  setDraft({ kind: 'residential', country, region: c.regionSlug ? regionBySlug.get(c.regionSlug) : undefined, city: c, asn: draft.asn })
                }
              />
            ))
          ) : (
            <NoneHere what="cities" />
          ))}

        {!loading && tab === 'asn' && (
          <>
            <p className="px-2 pb-2 text-[12px] leading-relaxed text-sf-text-muted">
              Pin exits to one carrier. Combines with the state or city you picked.
            </p>
            {asnList.length ? (
              asnList.map((a) => {
                const on = draft.asn?.asn === a.asn;
                return (
                  <Row
                    key={a.asn}
                    leading={<LevelIcon name="network" />}
                    title={a.name}
                    subtitle={`AS${a.asn}`}
                    selected={on}
                    onClick={() => setDraft({ ...draft, country, asn: on ? undefined : a })}
                  />
                );
              })
            ) : (
              <NoneHere what="ASNs" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Level 3: inside a state/region ──────────────────────────────────────

function RegionView({
  country,
  region,
  query,
  draft,
  setDraft,
}: {
  country: GeoCountry;
  region: GeoRegion;
  query: string;
  draft: ResidentialTarget;
  setDraft: (t: ResidentialTarget) => void;
}) {
  const cities = useAsync(() => api.cities(country.code, region.slug), [country.code, region.slug]);
  const q = query.trim().toLowerCase();
  const list = (cities.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));

  return (
    <div className="flex flex-col gap-3 pt-1">
      <Row
        leading={<LevelIcon name="map" />}
        title={`Any city in ${region.name}`}
        subtitle={`State-level · ${country.name}`}
        selected={draft.region?.slug === region.slug && !draft.city}
        onClick={() => setDraft({ kind: 'residential', country, region, asn: draft.asn })}
      />
      <div>
        <SectionLabel>Cities</SectionLabel>
        {cities.loading && <RowsSkeleton />}
        {!cities.loading && list.length === 0 && <NoneHere what="cities" />}
        {list.map((c) => (
          <Row
            key={c.slug}
            leading={<LevelIcon name="pin" />}
            title={c.name}
            selected={draft.city?.slug === c.slug && draft.region?.slug === region.slug}
            onClick={() => setDraft({ kind: 'residential', country, region, city: c, asn: draft.asn })}
          />
        ))}
      </div>
    </div>
  );
}

// ── Bottom selection bar ────────────────────────────────────────────────

function SelectionBar({
  draft,
  onChange,
  onApply,
  unchanged,
}: {
  draft: ResidentialTarget;
  onChange: (t: ResidentialTarget) => void;
  onApply: () => void;
  unchanged: boolean;
}) {
  const chips: { key: string; label: ReactNode; clear: () => void }[] = [];
  if (draft.country) {
    chips.push({
      key: 'country',
      label: (
        <>
          <Flag code={draft.country.code} className="!w-4 !h-[11px]" />
          {draft.country.name}
        </>
      ),
      clear: () => onChange(WORLDWIDE),
    });
  }
  if (draft.region) chips.push({ key: 'region', label: draft.region.name, clear: () => onChange({ ...draft, region: undefined, city: undefined }) });
  if (draft.city) chips.push({ key: 'city', label: draft.city.name, clear: () => onChange({ ...draft, city: undefined }) });
  if (draft.asn) chips.push({ key: 'asn', label: `AS${draft.asn.asn}`, clear: () => onChange({ ...draft, asn: undefined }) });

  return (
    <div className="border-t border-sf-border-subtle bg-sf-bg-elevated/95 backdrop-blur px-4 pt-3 pb-3.5">
      <div className="flex items-center gap-1.5 flex-wrap min-h-[26px]">
        {chips.length === 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-sf-text-tertiary">
            <Flag /> Random location worldwide
          </span>
        )}
        {chips.map((c, i) => (
          <span key={c.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {i > 0 && c.key !== 'asn' && <Icon name="chevronRight" size={12} className="text-sf-text-faint" />}
            {c.key === 'asn' && <span className="text-sf-text-faint text-[12px]">+</span>}
            <span className="inline-flex items-center gap-1.5 h-[26px] pl-2 pr-1 rounded-md bg-white/[0.05] border border-sf-border-subtle text-[12px] font-medium">
              {c.label}
              <button type="button" onClick={c.clear} className="grid place-items-center w-4 h-4 rounded text-sf-text-muted hover:text-sf-text-primary hover:bg-white/10" aria-label="Remove">
                <Icon name="x" size={11} strokeWidth={2.2} />
              </button>
            </span>
          </span>
        ))}
      </div>
      <button type="button" className="sf-btn sf-btn-primary w-full mt-3" onClick={onApply}>
        {unchanged ? 'Keep this location' : 'Use this location'}
        <Icon name="arrowRight" size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────

function CountryRow({ c, selected, drill, onClick }: { c: GeoCountry; selected: boolean; drill: boolean; onClick: () => void }) {
  return (
    <Row
      leading={<Flag code={c.code} />}
      title={c.name}
      selected={selected}
      trailingIcon={drill ? 'chevronRight' : undefined}
      onClick={onClick}
    />
  );
}

function LevelIcon({ name }: { name: IconName }) {
  return <Icon name={name} size={15} className="text-sf-text-tertiary" />;
}

function Count({ n }: { n?: number }) {
  if (n === undefined) return null;
  return <span className="sf-mono text-[11px] text-sf-text-muted">{n}</span>;
}

function NoneHere({ what }: { what: string }) {
  return <p className="px-3 py-6 text-center text-[12.5px] text-sf-text-muted">No {what} match your search.</p>;
}
