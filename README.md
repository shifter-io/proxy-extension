# Shifter — Proxy & VPN browser extension

Browse through Shifter **Residential** and **ISP** proxies like a VPN, using an existing Shifter membership.
Sign in with your Shifter API key, pick a membership, choose where your traffic exits (country → state → city, plus ASN), and connect.

> **Status:** live. The extension talks to the Shifter API (`shifter_docs/shifter-extension-api.md`) and routes the browser through the Shifter gateway. The mock backend is still available for UI work (`npm run build:mock`).

## Stack

- [WXT](https://wxt.dev) (Manifest V3, Chrome + Firefox from one codebase)
- React 19 + TypeScript
- Tailwind 3 with the **Shifter Panel design tokens**, copied 1:1 from `Shifter Panel/tailwind.config.js` and `resources/css/panel-tailwind.css`
- Assets taken from the panel: `shifter-wordmark.svg`, `shifter-glyph.svg`, `favicon.svg` (icons), Geist/Geist Mono woff2, and the flag PNG set

## Scripts

```bash
npm install
npm run dev            # Chrome with the extension loaded + HMR
npm run dev:firefox
npm run build          # build/chrome-mv3 (live API + real proxy) → Chrome: Load unpacked
npm run build:mock     # build-mock/chrome-mv3: mock data, pretend proxy
npm run dev:mock       # dev server on mock data
npm run zip            # store-ready zip
npm run compile        # typecheck
npm run geo:catalog -- <weights.json> <geo-data.json>   # rebuild src/lib/geo/catalog.json (see below)
npm run icons          # regenerate public/icon/* from src/assets/shifter-app-icon.svg
npm run preview:ui     # mock build + popup in a normal tab at http://localhost:4178/popup.html (?reset clears state, ?demo opens signed in)
```

### Mock scenarios (`build:mock` / `dev:mock` only; chosen by the API key's prefix)

The mock accepts any key of 32+ letters/digits (real panel keys are 64).

| Key starts with  | Result                                               |
| ---------------- | ---------------------------------------------------- |
| `single`         | One Residential membership, goes straight to Connect |
| `country`        | One Residential Country Geo membership               |
| `nongeo`         | One Residential Non-Geo membership                   |
| `isp`            | One ISP membership                                   |
| `none`           | No active memberships (empty state)                  |
| `invalid`        | Rejected: "This API key is not valid"                |
| anything else    | Full Geo + Country Geo + Non-Geo + 2× ISP + 1 expired |

Example: `demo0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV`

## Screens

1. **Sign in with API key**: paste the key from Panel → Profile → API Key (`users.api_token`). It's verified on paste or on Continue, then the popup goes straight to the plans. No key yet? "Create a free account" opens `shifter.io/register`. The key is kept in `chrome.storage.local` and only shown masked in Settings.
2. **Memberships**: shown when the user has more than one usable plan. Shows traffic left, expiry/renewal and status; expired plans link to renew.
3. **Connect (home)**: power button, exit IP and uptime, location card, session chip, plan usage. The header switches membership.
4. **Location (Residential)**: one search box across countries, states, cities and ASNs, or browse Country → State → City with ASN as an extra filter. The chip bar shows exactly what will be targeted. Respects pools: *Full Geo* (all levels), *Country Geo* (country only), *Non-Geo* (locked).
5. **IP picker (ISP)**: static IPs grouped by city, with a country filter and search.
6. **Settings**: default sticky/rotating session and TTL, strict location, WebRTC protection, bypass list, account and sign-out.

## Browser support

| Browser | Build | Status |
|---|---|---|
| Chrome, Brave | `build/chrome-mv3` | end-to-end tested (Chrome for Testing 154) |
| Microsoft Edge | `build/edge-mv3` | same engine and APIs as Chrome; not run in Edge itself |
| Firefox 140+ | `build/firefox-mv2` | end-to-end tested (Firefox 157); `web-ext lint`: 0 errors. ISP limit below |
| Safari | n/a | Safari's extension API can't set a proxy; use the Shifter VPN app |

**Changing the proxy username while connected** (location, New IP, strict, session): browsers remember the proxy login per gateway address and re-send it on new connections without asking the extension, and keep open connections alive.
- Chrome/Edge and Firefox: the extension changes the gateway *address* (`src/lib/proxy/gateways.ts`) when credentials change. It reuses an address with the same remembered username, or chooses an unused hostname/port. Residential entry points offer a finite pool; pinning an entry point reduces it. Chrome/Edge refuse a switch and request a browser restart if every address has conflicting cached credentials; Firefox retains its restart warning.
- Version 0.1.1 removes all browsing-data deletion and the `browsingData` permission. No cookies are cleared on connect, switch, or disconnect. The prior gateway-origin cookie deletion also removed dashboard cookies across the `shifter.io` registrable domain.
- ISP plans exposing only `isp.shifter.io:443` need a browser restart to change to a different proxy username. Chrome/Edge reject the switch until restart; Firefox warns that the old IP may remain.
- Entry point latency is shown in Settings → Entry point.

End-to-end tests (`e2e/`) run the real extension in Chrome for Testing and Firefox against a stand-in Shifter API and a login-protected local gateway: `cd e2e && npm install`, then `npm run e2e` from the root (`npm run e2e -- firefox`, `-- --offline`). See `e2e/README.md`. Test builds go to `build-test/` and `build-test-live/`, never `build/`.

## Architecture

```
src/
  entrypoints/
    background.ts        owns the proxy: connect / disconnect, answers the gateway login, IP check
    popup/               React entry (380×600)
  lib/
    types.ts             domain models (Membership, Geo*, Target, ProxySettings…)
    api/types.ts         ShifterApi interface  ← the only contract the UI uses
    api/index.ts         HttpShifterApi, or MockShifterApi when WXT_USE_MOCK=true
    api/http/            live client + wire types for the documented endpoints
    api/mock/            in-memory implementation + fixtures
    proxy/username.ts    residential username builder (country-/region-/city-/asn-/sid-/ttl-)
    proxy/controller.ts  BrowserProxyController (chrome.proxy / Firefox proxy.onRequest) + mock
    proxy/messages.ts    typed popup → background messages
    storage.ts           typed chrome.storage items (session, settings, targets, connection, active proxy)
  ui/
    state/AppState.tsx   routing stack + app state, synced with storage
    screens/, components/
```

### How the API is used

| Endpoint | Used for |
|---|---|
| `GET /api/v1/user/me` | verifying the key at sign-in; name, email and wallet in Settings (refreshed on every popup open) |
| `GET /api/v1/user/memberships` | plan list: product, status, `renews_at` / `expires_at` / trial, `pool` (Full Geo / Country Geo / Non-Geo) |
| `GET /api/v1/user/usage` | traffic left per plan (joined by hash); `metered: false` shows "Unlimited" |
| `GET /api/v1/user/proxy-config` | which plans are live, gateway host/port, login, entry points, sticky-session flag, ISP proxies |
| `GET /api/v1/residential/geo/asns` | only to name an ISP plan's carrier when the bundled catalog doesn't know its ASN (cached a day) |

- A plan is usable when it's listed in proxy-config and not past `expires_at`. Cancelled plans work until then ("Expiring soon"); unpaid / not-yet-active plans show the panel status. Other product lines are hidden.
- Any 401 signs the customer out. 429 and network errors show a retry message.
- The Renew / "Open in panel" link goes to `/panel/membership/{hash}` (the memberships `uri` is an API path, not a page).

### Location catalog

Locations (browse and search) come from `src/lib/geo/catalog.json`, bundled with the extension and loaded when the picker opens. It's built from the gateway's own inventory, so every pick has IPs behind it:

- source: `config/weights.json` in authorized gateway inventory (`country → region → city → member → ASN → provider = unique IPs`, summed over enabled providers), plus the panel's `resources/geo/geo-data.json` for country and ASN names
- kept: every country with IPs, and each state, city, country+ISP and city+ISP combination with **at least 50 unique IPs** (third argument changes the threshold)
- search covers all of it, ranked by name match then IP count; "comcast new york" finds the city+ISP combination
- with a city picked, the ASN tab lists only ISPs with IPs in that city

Rebuild when the inventory changes:

```bash
npm run geo:catalog -- ./private-data/weights.json "./private-data/geo-data.json"
```

### How the proxy works

- Chrome: `proxy.settings` fixed_servers, `http://<host>:<port>` (443), bypass list = `localhost`, `127.0.0.1`, `[::1]`, `shifter.io`, `*.shifter.io` + the user's list. Firefox: `proxy.onRequest` with the same rules (`src/lib/proxy/bypass.ts`).
- Bypass entries: `example.com`, `*.example.com` (includes `example.com` on both browsers), an IPv4 address, or an IPv4 range like `192.168.0.0/16`. Defaults: `localhost`, `127.0.0.1`, `*.local` and the private ranges `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`.
- `webRequest.onAuthRequired` answers the gateway login from `local:activeProxy`; a second challenge for the same request means the login was rejected, and the connection goes to an error state.
- Residential username: `customer-<user>[-country-…][-region-…][-city-…][-asn-…][-sid-…][-ttl-…][-strict-true]`. "New IP" = new `sid`. Rotating mode drops `sid`/`ttl`. Strict location adds `-strict-true` (only the exact scope). The entry point setting swaps the host.
- ISP: the chosen proxy's own username on `isp.shifter.io:443`. proxy-config has no address per proxy, so the picker lists carrier + city, numbered `#1`, `#2`… when several share country, city and ASN; the IP is shown only while connected.
- After applying, the worker fetches `https://ip-info.com/json` to show the exit IP and flag; if that fails the proxy is removed again so the browser isn't left offline.
- While connected the worker re-checks `https://ip-info.com/json` every 15 s (and when the popup opens) and updates the shown IP and flag when the exit changes; a failed re-check keeps the last IP.
- WebRTC protection sets `privacy.network.webRTCIPHandlingPolicy = disable_non_proxied_udp` while connected.
- Changing session, TTL, strict, entry point, bypass list or WebRTC while connected re-applies at once (same sticky session).
