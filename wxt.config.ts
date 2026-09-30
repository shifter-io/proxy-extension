import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Shifter — Proxy & VPN',
    description:
      'Browse through Shifter Residential and ISP proxies with your existing Shifter membership.',
    // Only what the mock UI needs today. The live proxy phase adds
    // "proxy", "webRequest" and "webRequestAuthProvider" (see README).
    permissions: ['storage'],
    action: { default_title: 'Shifter' },
  },
});
