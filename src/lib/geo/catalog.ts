import { slugify } from '../proxy/slug';
import type { GeoAsn, GeoCity, GeoCountry, GeoRegion, GeoSearchResult } from '../types';

/**
 * The residential location catalog, bundled with the extension and built by
 * `scripts/build-geo-catalog.mjs` from session-manager's weights.json (the
 * gateway's own inventory). It lists every country with IPs, and every
 * state, city, country+ASN and city+ASN above the inventory threshold, so
 * nothing offered in the picker comes back empty.
 *
 * It holds names only (no IP counts); lists are ordered largest first, and
 * that order is the only ranking signal. Loaded on first use (~140 KB
 * gzipped) and kept in memory after that.
 */
interface CatalogFile {
  /** [iso2, name], largest first */
  countries: [string, string][];
  asnNames: Record<string, string>;
  geo: Record<
    string,
    {
      /** region names */
      r: string[];
      /** [name, regionIndex | -1] */
      c: [string, number][];
      /** asn */
      a: number[];
      /** [cityIndex, asn] */
      ca: [number, number][];
    }
  >;
}

/** Position in its list, lower = more inventory; used only to rank search. */
type Ranked<T> = T & { rank: number };

interface CountryIndex {
  country: Ranked<GeoCountry>;
  regions: Ranked<GeoRegion>[];
  cities: { city: Ranked<GeoCity>; region?: GeoRegion }[];
  asns: Ranked<GeoAsn>[];
  cityAsns: { city: GeoCity; region?: GeoRegion; asn: Ranked<GeoAsn> }[];
}

interface Index {
  countries: Ranked<GeoCountry>[];
  byCode: Map<string, CountryIndex>;
}

let loading: Promise<Index> | null = null;

function load(): Promise<Index> {
  loading ??= import('./catalog.json').then((mod) => build(mod.default as unknown as CatalogFile));
  return loading;
}

/** Country position dominates, then position inside the country. */
const rankOf = (countryRank: number, i: number) => countryRank * 100_000 + i;

function build(file: CatalogFile): Index {
  const asnName = (asn: number) => file.asnNames[asn] ?? `AS${asn}`;
  const byCode = new Map<string, CountryIndex>();
  const countries = file.countries.map(([code, name], i) => ({ code, name, rank: rankOf(i, 0) }));

  countries.forEach((country, ci) => {
    const g = file.geo[country.code];
    if (!g) {
      byCode.set(country.code, { country, regions: [], cities: [], asns: [], cityAsns: [] });
      return;
    }
    const regions = g.r.map((name, i) => ({ name, slug: slugify(name), rank: rankOf(ci, i) }));
    const cities = g.c.map(([name, ri], i) => {
      const region = ri >= 0 ? regions[ri] : undefined;
      return { region, city: { name, slug: slugify(name), regionSlug: region?.slug, rank: rankOf(ci, i) } };
    });
    byCode.set(country.code, {
      country,
      regions,
      cities,
      asns: g.a.map((asn, i) => ({ asn, name: asnName(asn), rank: rankOf(ci, i) })),
      cityAsns: g.ca.flatMap(([cityIdx, asn], i) => {
        const c = cities[cityIdx];
        return c ? [{ ...c, asn: { asn, name: asnName(asn), rank: rankOf(ci, i) } }] : [];
      }),
    });
  });
  return { countries, byCode };
}

/** Public shapes carry no ranking data. */
const plain = <T extends { rank: number }>({ rank: _rank, ...rest }: T): Omit<T, 'rank'> => rest;

const byName = <T extends { name: string }>(list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));

export const geoCatalog = {
  async countries(): Promise<GeoCountry[]> {
    return (await load()).countries.map(plain);
  },

  async regions(country: string): Promise<GeoRegion[]> {
    return byName(((await load()).byCode.get(country)?.regions ?? []).map(plain));
  },

  async cities(country: string, region?: string): Promise<GeoCity[]> {
    const all = (await load()).byCode.get(country)?.cities ?? [];
    return byName(all.filter((c) => !region || c.region?.slug === region).map((c) => plain(c.city)));
  },

  /** ASNs in the country, or in one city when `city` is given; largest first. */
  async asns(country: string, city?: { slug: string; regionSlug?: string }): Promise<GeoAsn[]> {
    const c = (await load()).byCode.get(country);
    if (!c) return [];
    if (!city) return c.asns.map(plain);
    return c.cityAsns
      .filter((x) => x.city.slug === city.slug && x.city.regionSlug === city.regionSlug)
      .map((x) => plain(x.asn));
  },

  async asnName(asn: number): Promise<string | undefined> {
    for (const c of (await load()).byCode.values()) {
      const hit = c.asns.find((a) => a.asn === asn);
      if (hit) return hit.name;
    }
    return undefined;
  },

  /**
   * One search across every level. Tiers: exact code / ASN, then names that
   * start with the query, then city+ISP combinations, then names with a
   * word starting with it. Inside a tier, the larger location wins.
   */
  async search(query: string, limit = 40): Promise<GeoSearchResult[]> {
    const raw = query.trim().toLowerCase();
    if (!raw) return [];
    const q = fold(raw.replace(/^as(?=\d)/, ''));
    const number = /^\d+$/.test(q);
    const { countries, byCode } = await load();
    const scored: { hit: GeoSearchResult; score: number }[] = [];
    const push = (hit: GeoSearchResult, tier: number, rank: number) => scored.push({ hit, score: tier * 1e9 - rank });
    // Matches start at a word ("york" finds New York, "berlin" doesn't find FiberLink).
    const byName = (name: string, prefixTier: number, wordTier: number) => {
      const n = fold(name);
      return n.startsWith(q) ? prefixTier : startsWord(n, q) ? wordTier : 0;
    };

    for (const rc of countries) {
      const c = byCode.get(rc.code)!;
      const country = plain(rc);
      if (!number) {
        const tier = rc.code === q ? 9 : byName(rc.name, 6, 3);
        if (tier) push({ kind: 'country', country }, tier, rc.rank);
        for (const r of c.regions) {
          const t = byName(r.name, 5, 2);
          if (t) push({ kind: 'region', country, region: plain(r) }, t, r.rank);
        }
        for (const { city, region } of c.cities) {
          const t = byName(city.name, 5, 2);
          if (t) push({ kind: 'city', country, region, city: plain(city) }, t, city.rank);
        }
      }
      for (const a of c.asns) {
        const t = number ? (String(a.asn) === q ? 8 : String(a.asn).startsWith(q) ? 5 : 0) : byName(a.name, 5, 2);
        if (t) push({ kind: 'asn', country, asn: plain(a) }, t, a.rank);
      }
    }

    // "verizon new york", "vodafone berlin": ISP and city words in one query.
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && !number) {
      for (const rc of countries) {
        const country = plain(rc);
        for (const x of byCode.get(rc.code)!.cityAsns) {
          const isp = fold(`${x.asn.name} as${x.asn.asn}`);
          const place = fold(`${x.city.name} ${x.region?.name ?? ''}`);
          const text = `${isp} ${place}`;
          // Needs a word for the ISP and one for the place.
          if (words.every((w) => startsWord(text, w)) && words.some((w) => startsWord(isp, w)) && words.some((w) => startsWord(place, w))) {
            push({ kind: 'asn', country, region: x.region, city: x.city, asn: plain(x.asn) }, 4, x.asn.rank);
          }
        }
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.hit);
  },
};

function startsWord(text: string, q: string) {
  for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + 1)) {
    if (at === 0 || !/[a-z0-9]/.test(text[at - 1]!)) return true;
  }
  return false;
}

/** Lowercase, accents stripped: "São" matches "sao". */
function fold(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
