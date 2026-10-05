// Builds src/lib/geo/catalog.json, the location catalog behind the picker and
// its search, from session-manager's weights.json (the gateway's own
// inventory) plus the panel's geo-data.json (country and ASN names):
//
//   node scripts/build-geo-catalog.mjs <weights.json> <panel geo-data.json> [minIps=50]
//
// weights.json: authorized gateway inventory config/weights.json
//   locations[CC][region][city][member][ASxxxx][provider] = unique IPs
// geo-data.json: Shifter Panel resources/geo/geo-data.json
//
// Kept: every country with inventory, and each state, city, country+ASN and
// city+ASN with at least `minIps` unique IPs (summed over enabled providers).
// "-" marks an unknown level in weights.json and is never offered as a pick.
//
// The output ships inside the extension, where anyone can read it: it holds
// names only, never IP counts or provider names. Lists are ordered by
// inventory (largest first) so search can rank without the numbers.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const [weightsPath, panelPath, minArg] = process.argv.slice(2);
if (!weightsPath || !panelPath) {
  console.error('usage: node scripts/build-geo-catalog.mjs <weights.json> <panel geo-data.json> [minIps=50]');
  process.exit(1);
}
const MIN = Number(minArg ?? 50);
const out = fileURLToPath(new URL('../src/lib/geo/catalog.json', import.meta.url));

const weights = JSON.parse(await readFile(weightsPath, 'utf8'));
const panel = JSON.parse(await readFile(panelPath, 'utf8'));

const enabled = new Set(Object.entries(weights.providers ?? {}).filter(([, on]) => on).map(([p]) => p));
const UNKNOWN = (k) => k === '-' || k === '' || k.startsWith('__');

// Same rule as src/lib/proxy/slug.ts; the gateway reduces values to [a-z0-9] anyway.
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const panelCountries = new Map((panel.countries ?? []).map((c) => [String(c.iso2 ?? c.code).toLowerCase(), c.name]));
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (cc) => panelCountries.get(cc) ?? (() => { try { return regionNames.of(cc.toUpperCase()); } catch { return undefined; } })() ?? cc.toUpperCase();

const asnNames = new Map();
for (const list of Object.values(panel.asns ?? {})) {
  for (const a of list ?? []) if (a?.asn && a?.name && !asnNames.has(a.asn)) asnNames.set(Number(a.asn), a.name);
}

const sumProviders = (byProvider) =>
  Object.entries(byProvider).reduce((n, [p, v]) => n + (enabled.has(p) && typeof v === 'number' ? v : 0), 0);

const countries = [];
const byCountry = {};
const usedAsns = new Set();

for (const [CC, regions] of Object.entries(weights.locations ?? {})) {
  if (UNKNOWN(CC)) continue;
  const cc = CC.toLowerCase();
  let countryIps = 0;
  const regionOut = new Map(); // slug -> [name, ips]
  const cityOut = new Map(); // regionSlug|citySlug -> [name, regionSlug, ips]
  const countryAsn = new Map(); // asn -> ips
  const cityAsnOut = []; // [cityKey, asn, ips]

  for (const [region, cities] of Object.entries(regions)) {
    if (region.startsWith('__')) continue;
    const rSlug = UNKNOWN(region) ? '' : slug(region);
    let regionIps = 0;
    for (const [city, members] of Object.entries(cities)) {
      if (city.startsWith('__')) continue;
      let cityIps = 0;
      const cityAsn = new Map();
      for (const [member, asns] of Object.entries(members)) {
        if (member.startsWith('__')) continue;
        for (const [asKey, byProvider] of Object.entries(asns)) {
          const n = sumProviders(byProvider);
          cityIps += n;
          const asn = /^AS(\d+)$/.exec(asKey)?.[1];
          if (!asn) continue;
          cityAsn.set(+asn, (cityAsn.get(+asn) ?? 0) + n);
          countryAsn.set(+asn, (countryAsn.get(+asn) ?? 0) + n);
        }
      }
      regionIps += cityIps;
      if (UNKNOWN(city) || cityIps < MIN) continue;
      const key = `${rSlug}|${slug(city)}`;
      const prev = cityOut.get(key);
      cityOut.set(key, [prev?.[0] ?? city, rSlug, (prev?.[2] ?? 0) + cityIps]);
      for (const [asn, n] of cityAsn) if (n >= MIN) cityAsnOut.push([key, asn, n]);
    }
    countryIps += regionIps;
    if (rSlug && regionIps >= MIN) {
      const prev = regionOut.get(rSlug);
      regionOut.set(rSlug, [prev?.[0] ?? region, (prev?.[1] ?? 0) + regionIps]);
    }
  }
  if (countryIps <= 0) continue;

  countries.push([cc, countryName(cc), countryIps]); // count only used for ordering, not written
  const regionList = [...regionOut.entries()].sort((a, b) => b[1][1] - a[1][1]);
  const regionIdx = new Map(regionList.map(([s], i) => [s, i]));
  const cityList = [...cityOut.entries()].sort((a, b) => b[1][2] - a[1][2]);
  const cityIdx = new Map(cityList.map(([k], i) => [k, i]));
  const asnList = [...countryAsn.entries()].filter(([, n]) => n >= MIN).sort((a, b) => b[1] - a[1]);
  const cityAsnList = cityAsnOut.filter(([k]) => cityIdx.has(k)).sort((a, b) => b[2] - a[2]);
  for (const [a] of asnList) usedAsns.add(a);
  for (const [, a] of cityAsnList) usedAsns.add(a);

  byCountry[cc] = {
    // [name], largest first
    r: regionList.map(([, [name]]) => name),
    // [name, regionIndex (-1 = none)]
    c: cityList.map(([, [name, rSlug]]) => [name, rSlug ? (regionIdx.get(rSlug) ?? -1) : -1]),
    // asn
    a: asnList.map(([asn]) => asn),
    // [cityIndex, asn]
    ca: cityAsnList.map(([k, asn]) => [cityIdx.get(k), asn]),
  };
}

countries.sort((a, b) => b[2] - a[2]);
const countryList = countries.map(([cc, name]) => [cc, name]);
const names = {};
for (const a of [...usedAsns].sort((x, y) => x - y)) if (asnNames.has(a)) names[a] = asnNames.get(a);

const catalog = { countries: countryList, asnNames: names, geo: byCountry };
await writeFile(out, JSON.stringify(catalog));

const tally = (k) => Object.values(byCountry).reduce((n, g) => n + g[k].length, 0);
console.log(
  `catalog.json: ${countries.length} countries, ${tally('r')} states, ${tally('c')} cities, ` +
    `${tally('a')} country+ASN, ${tally('ca')} city+ASN, ${Object.keys(names).length}/${usedAsns.size} ASN names`,
);
