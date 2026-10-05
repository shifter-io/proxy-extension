# End-to-end tests

Runs the real extension (popup, background worker, proxy, login answering, WebRTC policy) in **Chrome for Testing** (same engine as Chrome, Edge and Brave) and **Firefox**, against a stand-in Shifter:

- `fake-shifter.mjs`: the `/api/v1` endpoints on `127.0.0.1:18080`, and a login-protected HTTP proxy gateway on `:18081–18083` (like 443 / 80 / 8080) that logs the username of every request. `fra/ams/lon.localhost` stand in for the regional entry points.
- `suite.mjs`: the checks (sign-in, plan, traffic, connect, username format, WebRTC, strict, bypass list, New IP ×8 on an open site, cookies kept, latency, 15 s IP re-check, disconnect).
- `drivers.mjs`: how each browser is launched and the popup found.
- `run.mjs`: builds `build-test/` (stand-in API) and `build-test-live/` (real API, one bad-key check), then runs everything.

```bash
cd e2e
npm install              # also downloads Chrome for Testing + Firefox (~400 MB, once)
npm run setup            # only if your npm skipped install scripts
npm test                 # chrome + firefox, ~2 min
npm test -- firefox      # one browser
npm test -- --offline    # skip the real shifter.io check
```

Exit code 1 when any check fails. Test builds contain a hook (open the popup in a tab on install) and a stand-in API address; `build/` never does.
