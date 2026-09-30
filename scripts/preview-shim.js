// Browser-tab stand-in for the extension APIs the popup uses, so the built
// popup can be previewed/screenshotted at http://localhost without loading
// the extension. Storage persists in localStorage; ?reset clears it.
(function () {
  if (new URLSearchParams(location.search).has('reset')) {
    Object.keys(localStorage).filter((k) => k.startsWith('ext:')).forEach((k) => localStorage.removeItem(k));
  }
  // ?demo[=<membershipId>] opens signed in with the mock demo key, straight on
  // Connect (default: the Residential plan). Handy for headless screenshots.
  const demo = new URLSearchParams(location.search).get('demo');
  if (demo !== null) {
    localStorage.setItem('ext:session', JSON.stringify({ user: { id: 'u_mock', email: 'demo@example.invalid' }, apiKey: 'demo0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV', createdAt: new Date().toISOString() }));
    localStorage.setItem('ext:activeMembership', JSON.stringify(demo || 'm_res_1'));
  }
  const listeners = new Set();
  const read = (k) => {
    const raw = localStorage.getItem('ext:' + k);
    return raw == null ? undefined : JSON.parse(raw);
  };
  const emit = (changes) => listeners.forEach((l) => l(changes, 'local'));
  const local = {
    async get(keys) {
      const list = keys == null ? Object.keys(localStorage).filter((k) => k.startsWith('ext:')).map((k) => k.slice(4)) : [].concat(keys);
      const out = {};
      for (const k of list) { const v = read(k); if (v !== undefined) out[k] = v; }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: read(k), newValue: v };
        localStorage.setItem('ext:' + k, JSON.stringify(v));
      }
      emit(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) { changes[k] = { oldValue: read(k) }; localStorage.removeItem('ext:' + k); }
      emit(changes);
    },
    onChanged: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
  };

  // Mirrors entrypoints/background.ts with the MockProxyController timings.
  async function sendMessage(msg) {
    if (msg.type === 'proxy:disconnect') {
      await local.set({ connection: { status: 'disconnected' } });
      return { ok: true };
    }
    await local.set({ connection: { status: 'connecting', membershipId: msg.membershipId, target: msg.target } });
    await new Promise((r) => setTimeout(r, 1100));
    const o = () => Math.floor(Math.random() * 254) + 1;
    const exitIp = msg.target.kind === 'isp' ? msg.target.ip.ip : `192.0.2.${o()}`;
    await local.set({ connection: { status: 'connected', membershipId: msg.membershipId, target: msg.target, exitIp, since: new Date().toISOString() } });
    return { ok: true };
  }

  globalThis.chrome = {
    runtime: { id: 'preview', sendMessage, getManifest: () => ({ version: 'preview' }), onMessage: { addListener() {} } },
    storage: { local, onChanged: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) } },
    tabs: { create: ({ url }) => window.open(url, '_blank') },
  };
})();
