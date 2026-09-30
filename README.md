# Shifter — Proxy & VPN browser extension

Browse through Shifter **Residential** and **ISP** proxies like a VPN, using an existing Shifter membership.
Sign in with your Shifter API key, pick a membership, choose where your traffic exits (country → state → city, plus ASN), and connect.

> **Status:** UI/UX phase. Every screen runs on mock data (`src/lib/api/mock`). No real proxying happens yet.

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
npm run build          # .output/chrome-mv3
npm run zip            # store-ready zip
npm run compile        # typecheck
npm run icons          # regenerate public/icon/* from src/assets/shifter-app-icon.svg
npm run preview:ui     # after build: popup in a normal tab at http://localhost:4178/popup.html (?reset clears state, ?demo opens signed in)
```

### Mock scenarios (chosen by the API key's prefix)

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

## Architecture (built for the API phase)

```
src/
  entrypoints/
    background.ts        owns the proxy; handles proxy:connect / proxy:disconnect
    popup/               React entry (380×600)
  lib/
    types.ts             domain models (Membership, Geo*, Target, ProxySettings…)
    api/types.ts         ShifterApi interface  ← the only contract the UI uses
    api/index.ts         picks the implementation (Mock today → Http later)
    api/mock/            in-memory implementation + fixtures
    proxy/username.ts    gateway username builder (country-/region-/city-/asn-/sid-/ttl-/strict-)
    proxy/controller.ts  ProxyController interface + MockProxyController
    proxy/messages.ts    typed popup → background messages
    storage.ts           typed chrome.storage items (session, settings, targets, connection)
  ui/
    state/AppState.tsx   routing stack + app state, synced with storage
    screens/, components/
```

**Going live** means swapping two classes; no screen changes:

- `HttpShifterApi implements ShifterApi`. The API key already authenticates `/api/v1/*` (`?api_token=`), e.g. `GET /api/v1/user/memberships`, geo catalog (`ResidentialGeoController`: countries/regions/cities/asns), static-residential proxies. New endpoints needed: a key-verify / `me` endpoint (returns the user for a key), `GET /geo/search?q=`, and per-membership gateway credentials.
- `ChromeProxyController implements ProxyController`: `chrome.proxy.settings` with a PAC script (applies the bypass list), `webRequest.onAuthRequired` for credentials, and `privacy.network.webRTCIPHandlingPolicy`. Add the `proxy`, `webRequest`, `webRequestAuthProvider` and `privacy` permissions. Chrome can't authenticate SOCKS5, so the extension needs an HTTP(S) gateway port.
