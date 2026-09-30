# Shifter API for the browser extension

Everything the extension needs to sign a customer in, show their account and set up their proxy.

- **Base URL:** `https://shifter.io`
- **Format:** JSON over HTTPS. All dates are ISO-8601 in UTC (`2026-10-23T08:44:14+00:00`). Money is USD. Traffic is in bytes and in decimal GB (1 GB = 1,000,000,000 bytes).

---

## 1. Signing in: the API key

The customer signs in by pasting their **API key**. There is no separate extension login.

| The customer... | Tell them to... |
|---|---|
| has a Shifter account | open **https://shifter.io/user/profile**, copy the key from the **API Key** section, and paste it into the extension |
| has no account | create one at **https://shifter.io/login** (email, Google or GitHub), buy or start a plan, then copy the key as above |

Send the key on every request, either way:

```
Authorization: Bearer <API_KEY>              (recommended)
GET /api/v1/user/me?api_token=<API_KEY>      (also accepted)
```

The geo endpoints (section 4) take the same key as `X-Api-Key: <API_KEY>` or `?api_key=<API_KEY>`.

**How to treat the key:**
- The key gives full access to the account, so treat it like a password.
- Store it only in `chrome.storage.local`, never in logs or analytics.
- "Log out" in the extension simply deletes it.
- If a call ever returns 401, the key is no longer valid: sign the customer out and ask for the key again.

### Checking a key

Call `GET /api/v1/user/me`:
- **200:** the key is valid, and you get who is signed in.
- **401:** show "Invalid API key" and ask for it again.

---

## 2. Response format and errors

The `/api/v1/user/*` endpoints wrap every response like this:

```json
{ "error": null, "code": 200, "data": { ... } }
```

| HTTP | Body | Meaning |
|---|---|---|
| 200 | `{"error":null,"code":200,"data":{...}}` | OK |
| 401 | `{"error":"Unauthorized","code":401}` | missing or wrong key |
| 429 | Too Many Attempts | rate limit hit; wait and retry |
| 5xx | | our side; retry later |

**Rate limit:** 60 requests per minute per key on `/user/me`, `/user/usage` and `/user/proxy-config`, and 60 per minute per IP on the geo endpoints. The popup only needs one refresh when it opens; please don't poll more often than once a minute.

---

## 3. Endpoints

### `GET /api/v1/user/me`: who is signed in

Use it for the header of the popup ("Hi Demo, $440.50 in your wallet").

```json
{
  "error": null, "code": 200,
  "data": {
    "user_id": 1001,
    "username": "demo",
    "first_name": "Demo",
    "last_name": "User",
    "email": "demo@example.invalid",
    "wallet_balance": 440.5,
    "currency": "USD",
    "created_at": "2022-05-04T10:12:00+00:00"
  }
}
```

`first_name` and `last_name` can be `null`, so fall back to `username`.

---

### `GET /api/v1/user/memberships`: the customer's plans

An object keyed by the plan's short id (hash). It includes cancelled plans; use `canceled_at` and `status` to decide what to show.

```json
{
  "error": null, "code": 200,
  "data": {
    "DEMO1": {
      "name": "demo  #DEMO1 - Spark",
      "status": "Active",
      "color": "success",
      "service": "backconnect",
      "uri": "backconnect/DEMO1/",
      "membership_id": 2001,
      "product": "Spark",
      "category": "Residential Proxies",
      "is_recurring": true,
      "is_trial": false,
      "created_at": "2026-09-23T08:44:14+00:00",
      "expires_at": "2026-10-23T09:09:18+00:00",
      "renews_at": "2026-10-23T08:44:14+00:00",
      "trial_ends_at": null,
      "canceled_at": null
    }
  }
}
```

| Field | Meaning |
|---|---|
| `product` | plan name to show ("Spark", "Business", "50 ISP Proxies"...) |
| `category` | product line: "Residential Proxies", "ISP Proxies", "Special Backconnect Proxies", ... |
| `status` | human-readable status: "Active", "Active, Recurring", "Active Trial", "Canceled", "Pending Payment", ... |
| `color` | `success` (green, OK), `warning` (amber, needs attention), `danger` (red, cancelled/expired), `info` |
| `expires_at` | the date the plan is paid until |
| `renews_at` | next automatic renewal; `null` when the plan does not renew (one-time or cancelled) |
| `trial_ends_at` | only while a free trial is running |
| `canceled_at` | set when the customer cancelled; the plan still works until `expires_at` |

**What to show:** if `renews_at` is set, say "Renews <renews_at>"; otherwise say "Expires <expires_at>".

---

### `GET /api/v1/user/usage`: traffic left and wallet

Traffic for every live plan, including plans in team workspaces the customer belongs to. Optional `?workspace=<id>` narrows it to one workspace.

```json
{
  "error": null, "code": 200,
  "data": {
    "totals": {
      "quota_bytes": 50000000000, "used_bytes": 12500000000, "remaining_bytes": 37500000000, "overage_bytes": 0,
      "quota_gb": 50, "used_gb": 12.5, "remaining_gb": 37.5, "overage_gb": 0, "used_percent": 25
    },
    "workspaces": [
      { "id": "DEMO3", "name": "Personal", "role": "owner", "personal": true, "wallet_balance": 440.5 }
    ],
    "memberships": [
      {
        "id": "DEMO1",
        "plan": "Spark",
        "service": "backconnect",
        "status": "Active",
        "metered": true,
        "quota_bytes": 5000000000, "used_bytes": 1250000000, "remaining_bytes": 3750000000, "overage_bytes": 0,
        "quota_gb": 5, "used_gb": 1.25, "remaining_gb": 3.75, "overage_gb": 0,
        "used_percent": 25,
        "resets_at": "2026-10-23T08:44:14+00:00",
        "overage_billed": true,
        "overage_rate_per_gb": 2,
        "wallet_balance": 440.5,
        "wallet_covers_gb": 220.25,
        "workspace": { "id": "DEMO3", "name": "Personal", "role": "owner", "personal": true }
      }
    ]
  }
}
```

- `memberships[].id` is the same short id (hash) as the keys of `/user/memberships`, so use it to join the two.
- `metered: false` means the plan has no traffic cap to show (ISP lists, some legacy plans, scraping/SERP). All traffic fields are then `null`, not `0`; show "Unlimited" or nothing.
- `resets_at` is when the traffic allowance resets (the next billing cycle).
- `overage_billed: true` means traffic over the allowance is charged from the wallet at `overage_rate_per_gb`, and `wallet_covers_gb` is how much extra traffic the current wallet balance pays for.

---

### `GET /api/v1/user/proxy-config`: proxy login details

Everything needed to configure the proxy, for each **live** plan the customer owns that runs on our gateway. Unpaid and not-yet-active plans are not listed, and neither are older product lines, which keep their own endpoints.

```json
{
  "error": null, "code": 200,
  "data": {
    "plans": [
      {
        "membership_id": 2001,
        "hash": "DEMO1",
        "product": "Spark",
        "status": "Active",
        "protocol": "http",
        "type": "residential",
        "pool": "full",
        "pool_label": "Full Geo",
        "host": "p.shifter.io",
        "port": 443,
        "entry_points": [
          { "key": "auto", "host": "p.shifter.io",     "city": null,        "region": "Automatic" },
          { "key": "fra",  "host": "fra.p.shifter.io", "city": "Frankfurt", "region": "Europe" },
          { "key": "ams",  "host": "ams.p.shifter.io", "city": "Amsterdam", "region": "Europe" },
          { "key": "lon",  "host": "lon.p.shifter.io", "city": "London",    "region": "Europe" },
          { "key": "nyc",  "host": "nyc.p.shifter.io", "city": "New York",  "region": "North America" },
          { "key": "tor",  "host": "tor.p.shifter.io", "city": "Toronto",   "region": "North America" },
          { "key": "sgp",  "host": "sgp.p.shifter.io", "city": "Singapore", "region": "Asia Pacific" },
          { "key": "blr",  "host": "blr.p.shifter.io", "city": "Bangalore", "region": "Asia Pacific" },
          { "key": "syd",  "host": "syd.p.shifter.io", "city": "Sydney",    "region": "Asia Pacific" }
        ],
        "username": "customer-demo",
        "password": "XXXXXXXX",
        "targeting": { "country": true, "region": true, "city": true, "asn": true, "sticky_session": true },
        "username_format": "customer-{username}[-country-{iso2}][-region-{slug}][-city-{slug}][-asn-{number}][-sid-{session_id}][-ttl-{seconds}]"
      },
      {
        "membership_id": 2002,
        "hash": "DEMO2",
        "product": "4 ISP Proxies",
        "status": "Active, Recurring",
        "protocol": "http",
        "type": "isp",
        "host": "isp.shifter.io",
        "port": 443,
        "password": "XXXXXXXX",
        "proxies": [
          { "username": "us-new_york-new_york-as9009-DEMO1", "country": "us", "city": "New York", "asn": 9009 },
          { "username": "ro-bucharest-bucharest-as8708-DEMO2", "country": "ro", "city": "Bucharest", "asn": 8708 }
        ]
      }
    ]
  }
}
```

An empty `plans` array means the customer has nothing to connect yet; link them to https://shifter.io/order.

#### Residential plans (`"type": "residential"`)

The customer gets one login, and targeting goes **into the username**, dash-separated:

```
customer-demo                                         any IP, rotates on every request
customer-demo-country-us                              a US IP
customer-demo-country-us-city-new_york                a New York IP
customer-demo-country-us-region-california            a California IP
customer-demo-country-de-asn-3320                     Deutsche Telekom (AS3320) in Germany
customer-demo-country-us-sid-a1b2c3                   sticky: same IP for this session id
customer-demo-country-us-sid-a1b2c3-ttl-600           sticky for 600 seconds (default 120)
```

- **Which targeting is allowed:** it depends on the pool, so only offer what `targeting` marks `true`:
  - **Full Geo:** country, region, city, ASN.
  - **Country Geo:** country only.
  - **Non-Geo:** no targeting at all.
- **Sticky sessions:** a new `sid` value means a new IP. Keep the same `sid` to keep the IP until its `ttl` runs out. Use letters and digits only.
- **Entry point:** `host` is the gateway the customer picked in the panel; the default, `p.shifter.io`, connects to the nearest region automatically. Offer `entry_points` as an "Entry point" choice if you want: a fixed region keeps a sticky session on the same IP even if the customer's network changes location.
- **Protocol:** use **HTTP** on port **443** (a plain HTTP proxy, even though the port is 443).

#### ISP Select plans (`"type": "isp"`)

- Each purchased IP has its own username, all sharing the plan `password`, on `isp.shifter.io:443`.
- Each IP is a fixed address in a chosen city and ISP, so offer the list and let the customer pick one.
- There's no targeting to build.

---

## 4. Geo lists for the targeting dropdowns

These list the countries, regions, cities and ASNs available, so the customer picks from a list instead of typing slugs. They're plain JSON arrays with no `data` wrapper, and they take the key as `X-Api-Key` or `?api_key=`.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/residential/geo/countries` | `[{"code":"us","name":"United States"}, ...]` |
| `GET /api/v1/residential/geo/regions?country=us` | `[{"slug":"california","name":"California"}, ...]` |
| `GET /api/v1/residential/geo/cities?country=us&region=new_york` | `[{"slug":"new_york","name":"New York"}, ...]` (drop `region` for every city in the country) |
| `GET /api/v1/residential/geo/asns?country=de` | `[{"asn":3320,"name":"Deutsche Telekom AG"}, ...]` |

- **Use the slug:** put the `slug` (or `code` / `asn`) into the username, never the display name.
- **How slugs are made:** accents become plain letters, everything is lowercase, and each run of other characters becomes one `_`. For example `São Paulo` becomes `sao_paulo`, `Île-de-France` becomes `ile_de_france`, and `St. John's` becomes `st_john_s`.
- **Cache the lists:** they change rarely. Cache them for a day, per country.

---

## 5. Setting the proxy in Chrome (Manifest V3)

`manifest.json`:

```json
{
  "manifest_version": 3,
  "permissions": ["proxy", "storage", "webRequest", "webRequestAuthProvider"],
  "host_permissions": ["https://shifter.io/*", "<all_urls>"]
}
```

`host_permissions` for `https://shifter.io/*` lets the extension call the API without cross-site (CORS) restrictions. `<all_urls>` is needed to answer the proxy login.

Turning the proxy on (service worker):

```js
async function enableProxy(host, port) {
  await chrome.proxy.settings.set({
    scope: 'regular',
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: 'http', host, port },       // e.g. p.shifter.io, 443
        bypassList: ['localhost', '127.0.0.1', 'shifter.io', '*.shifter.io']
      }
    }
  });
}

async function disableProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
}
```

Answering the proxy login:

```js
// username = the plan's username plus the chosen targeting, e.g.
// "customer-demo-country-us-sid-a1b2c3"; password from proxy-config.
chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (!details.isProxy) return callback({});
    chrome.storage.local.get(['proxyUser', 'proxyPass'], (s) => {
      callback({ authCredentials: { username: s.proxyUser, password: s.proxyPass } });
    });
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking']
);
```

- **Bypass `shifter.io`:** keep `shifter.io` in the bypass list, so the extension can always reach the API even when the proxy has a problem.
- **HTTP only:** Chrome can't send a username and password to a SOCKS5 proxy, so use HTTP.
- **Checking it works:** with the proxy on, fetch `https://ipinfo.io/json` and show the IP and country the customer now appears from.

---

## 6. Suggested popup flow

1. No key stored: show the sign-in screen with the two cases from section 1.
2. Key entered: call `/user/me`. On 401 show the error; on 200 save the key.
3. Overview: call `/user/me`, `/user/memberships` and `/user/usage` together. Show the name, wallet balance, and one card per plan that isn't cancelled, with its status, "Renews/Expires" date and traffic left (from `usage` by `id`).
4. Connect: call `/user/proxy-config`, let the customer pick a plan, then targeting (from the geo lists) and an optional sticky session, and switch the proxy on.
5. Log out: clear the proxy settings and delete the stored key and credentials.

---

API documentation: https://shifter.io/docs.
