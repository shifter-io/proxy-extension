import { defineConfig } from 'wxt';

// Node global (the project doesn't pull in @types/node).
declare const process: { env: Record<string, string | undefined> };

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // Visible folders (Chrome's "Load unpacked" picker hides dot-folders).
  // build/ is always the live extension; mock builds (WXT_USE_MOCK=true) go
  // to build-mock/, which is what preview:ui serves.
  // WXT_SHIFTER_BASE_URL (end-to-end tests against a stand-in API) builds to
  // build-test/, so build/ is never a test build. WXT_OUT_DIR overrides (e2e runner).
  outDir:
    process.env.WXT_OUT_DIR ||
    (process.env.WXT_USE_MOCK === 'true' ? 'build-mock' : process.env.WXT_SHIFTER_BASE_URL ? 'build-test' : 'build'),
  modules: ['@wxt-dev/module-react'],
  // Keep reviewer sources reproducible and exclude local test builds and data.
  zip: {
    includeSources: [
      'src/**', 'public/**', 'scripts/**',
      'package.json', 'package-lock.json', '*.config.*', 'tsconfig.json', 'BUILD.html',
    ],
  },
  manifest: ({ browser, manifestVersion }) => ({
    name: 'Shifter — Proxy & VPN',
    description:
      'Browse through Shifter Residential and ISP proxies with your existing Shifter membership.',
    // proxy: route the browser through the gateway. webRequest (+ AuthProvider
    // on Chrome MV3, Blocking on MV2): answer the gateway login. privacy: keep
    // WebRTC on the proxied route.
    permissions: [
      'storage',
      // Hourly gateway latency check.
      'alarms',
      'proxy',
      'webRequest',
      'privacy',
      manifestVersion === 3 && browser !== 'firefox' ? 'webRequestAuthProvider' : 'webRequestBlocking',
    ],
    // shifter.io: API calls without CORS. <all_urls>: answer the proxy login
    // for every site, and the ip-info.com exit-IP check.
    host_permissions: ['https://shifter.io/*', '<all_urls>'],
    action: { default_title: 'Shifter' },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'extension@shifter.io',
          // 140 (ESR) / 142 on Android: first versions with data_collection_permissions.
          strict_min_version: '140.0',
          // Firefox's data-consent declaration: the API key goes to shifter.io
          // (authenticationInfo) and browsing traffic goes through the Shifter
          // gateway (browsingActivity).
          data_collection_permissions: { required: ['authenticationInfo', 'browsingActivity'] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),
});
