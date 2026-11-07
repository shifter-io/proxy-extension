# End-to-end tests

Runs the real extension (popup, background worker, proxy, login answering, WebRTC policy) in **Chrome for Testing** (same engine as Chrome, Edge and Brave) and **Firefox**, against a stand-in Shifter:

- `fake-shifter.mjs`: the `/api/v1` endpoints on `127.0.0.1:18080`, and a login-protected HTTP proxy gateway on `:18081–18083` (like 443 / 80 / 8080; see [Running scripts side by side](#running-scripts-side-by-side) for other ports) that logs the username of every request. `fra/ams/lon.localhost` stand in for the regional entry points.
- `suite.mjs`: the checks (sign-in, plan, traffic, connect, username format, WebRTC, strict, bypass list, New IP ×8 on an open site, cookies kept, latency, 15 s IP re-check, disconnect).
- `drivers.mjs`: how each browser is launched and the popup found.
- `run.mjs`: builds `build-test/` (stand-in API) and `build-test-live/` (real API, one bad-key check), then runs everything.
- `build.mjs`: `buildExtension({ browser, env, outDir })`, the one way the scripts build the extension (holding the build lock below); returns the build folder.

```bash
cd e2e
npm install              # also downloads Chrome for Testing + Firefox (~400 MB, once)
npm run setup            # only if your npm skipped install scripts
npm test                 # chrome + firefox, ~2 min
npm test -- firefox      # one browser
npm test -- --offline    # skip the real shifter.io check
npm test -- --live-only  # only the real shifter.io check (no stand-in server)
```

Exit code 1 when any check fails. Test builds contain a hook (open the popup in a tab on install) and a stand-in API address; `build/` never does.

## Workspace regression

Run `node e2e/workspaces.mjs` from the repository root, optionally followed by `chrome` or `firefox`. The test uses local API and TLS gateway fixtures with synthetic credentials. It verifies workspace ordering and empty states, all member roles, team traffic and connection credentials, the ISP picker, team-only accounts, revoked access, and compatibility with responses that lack workspace metadata. Requests must opt in with exactly `workspaces=all`; usage remains unfiltered. Test builds and certificates live in a unique temporary directory and are removed in a finally block; isolated browser profiles are closed after each browser.

## Running scripts side by side

Every script (`npm test`, `toolbar.mjs`, `usage.mjs`, `workspaces.mjs`, `cookies.mjs`) can run at the same time as the others in one checkout:

- **Ports.** `E2E_PORT_BASE` sets the stand-in API port, and the gateway uses the next three (`base+1` to `base+3`). Unset, it is 18080, so the ports are the ones above. Give each script running at the same time its own base, at least 4 apart. A value that is not an integer port from 1 to 65532 stops the script with an error. The TLS fixtures in `cookies.mjs` and `workspaces.mjs` take a free port of their own.
- **Build lock.** WXT rewrites `.wxt/tsconfig.json` on every build whose output folder differs, so two builds (or a build and `tsc`) at the same moment can read a half-written file. `build.mjs` therefore builds holding a lock, `node_modules/.cache/wxt-build.lock` (a folder holding the owner's pid), made by `scripts/wxt-lock.mjs`. Builds take turns (2 to 4 s each); the browser tests themselves still run in parallel. A lock left by a process that is no longer running is taken over. After 5 minutes of waiting the script fails; it never builds unlocked. If that happens with no build running, remove the folder.
- **Other commands.** `node scripts/wxt-lock.mjs <command> [args...]` runs any command (for example `npm run compile`) holding the same lock and exits with its exit code (128 + the signal number if it was killed). Its tests: `node --test scripts/wxt-lock.test.mjs`.

```bash
E2E_PORT_BASE=18100 node e2e/usage.mjs chrome &
E2E_PORT_BASE=18110 node e2e/workspaces.mjs chrome &
wait
```
