// Stand-in Shifter for end-to-end tests:
//   API      http://127.0.0.1:18080  the /api/v1 endpoints the extension uses
//   gateway  :18081 :18082 :18083     login-protected HTTP proxy (like 443 / 80 / 8080)
// The gateway logs every request with the username it was given, so tests
// can see exactly which login the browser sent.
import http from 'node:http';
import net from 'node:net';

export const API_URL = 'http://127.0.0.1:18080';
export const GATEWAY_PORTS = [18081, 18082, 18083];
export const KEY = 'k'.repeat(64);
const PASSWORD = 'pw-secret';
let options = {};

/** { user, target } for every request the gateway handled (or refused: user "(407 …)"). */
export const log = [];

const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

export const MEMBERSHIPS = {
  DEMO1: {
    name: 'test #DEMO1 - Spark', status: 'Active', color: 'success', service: 'backconnect', uri: 'backconnect/DEMO1/',
    membership_id: 1, product: 'Spark', category: 'Residential Proxies', is_recurring: true, is_trial: false,
    created_at: iso(-5), expires_at: iso(25), renews_at: iso(25), trial_ends_at: null, canceled_at: null,
    pool: 'full', pool_label: 'Full Geo',
  },
  // Active on the panel but not current product lines: the extension hides them.
  YG7L: {
    name: 'test #YG7L - 4 ISP Proxies', status: 'Active, Recurring', color: 'success', service: 'static-residential-proxies',
    uri: 'static-residential-proxies/YG7L/', membership_id: 2, product: '4 ISP Proxies', category: 'Static Residential Proxies',
    is_recurring: true, is_trial: false, created_at: iso(-5), expires_at: iso(20), renews_at: iso(20), trial_ends_at: null, canceled_at: null,
  },
  lKNm: {
    name: 'test #lKNm - 5 Special Rotating Proxies', status: 'Active, Recurring', color: 'success', service: 'backconnect',
    uri: 'backconnect/lKNm/', membership_id: 3, product: '5 Special Rotating Proxies', category: 'Special Backconnect Proxies',
    is_recurring: true, is_trial: false, created_at: iso(-5), expires_at: iso(20), renews_at: iso(20), trial_ends_at: null, canceled_at: null,
  },
};

export const USAGE = {
  memberships: [{
    id: 'DEMO1', plan: 'Spark', service: 'backconnect', status: 'Active', metered: true,
    quota_bytes: 5e9, used_bytes: 1.25e9, remaining_bytes: 3.75e9, overage_bytes: 0, used_percent: 25,
    resets_at: iso(25), overage_billed: false, overage_rate_per_gb: null, wallet_balance: 10, wallet_covers_gb: null,
  }],
};

// *.localhost always resolves to this machine, so these stand in for fra/ams/lon.p.shifter.io.
export const PROXY_CONFIG = {
  plans: [{
    membership_id: 1, hash: 'DEMO1', product: 'Spark', status: 'Active', protocol: 'http', type: 'residential',
    pool: 'full', pool_label: 'Full Geo', host: '127.0.0.1', port: GATEWAY_PORTS[0],
    entry_points: [
      { key: 'auto', host: '127.0.0.1', city: null, region: 'Automatic' },
      { key: 'fra', host: 'fra.localhost', city: 'Frankfurt', region: 'Europe' },
      { key: 'ams', host: 'ams.localhost', city: 'Amsterdam', region: 'Europe' },
      { key: 'lon', host: 'lon.localhost', city: 'London', region: 'Europe' },
    ],
    username: 'customer-test', password: PASSWORD,
    targeting: { country: true, region: true, city: true, asn: true, sticky_session: true },
    username_format: 'customer-{username}[-country-{iso2}][-region-{slug}][-city-{slug}][-asn-{number}][-sid-{session_id}][-ttl-{seconds}]',
  }],
};

const api = http.createServer((req, res) => {
  const url = new URL(req.url, API_URL);
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const authed = req.headers.authorization === `Bearer ${KEY}` || req.headers['x-api-key'] === KEY;
  if (!authed) return send(401, { error: 'Unauthorized', code: 401 });
  const ok = (data) => send(200, { error: null, code: 200, data });
  switch (url.pathname) {
    case '/api/v1/user/me':
      return ok({ user_id: 1, username: 'tester', first_name: 'Test', last_name: 'User', email: 't@example.com', wallet_balance: 10, currency: 'USD', created_at: iso(-100) });
    case '/api/v1/user/memberships':
      return ok(options.memberships ?? MEMBERSHIPS);
    case '/api/v1/user/usage':
      return ok(options.usage ?? USAGE);
    case '/api/v1/user/proxy-config':
      return ok(options.gatewayHosts ? {
        plans: PROXY_CONFIG.plans.map(plan => ({
          ...plan,
          host: options.gatewayHosts[0],
          entry_points: plan.entry_points.map((entry, i) => ({ ...entry, host: options.gatewayHosts[i] })),
        })),
      } : options.proxyConfig ?? PROXY_CONFIG);
    default:
      if (url.pathname.startsWith('/api/v1/residential/geo/')) return send(200, []);
      return send(404, { error: 'not found', code: 404 });
  }
});

function userOf(req) {
  const h = req.headers['proxy-authorization'];
  if (!h?.startsWith('Basic ')) return null;
  const [user, pass] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  return pass === PASSWORD ? user : null;
}

function onRequest(req, res) {
  const user = userOf(req);
  log.push({ user: user ?? `(407 auth=${req.headers['proxy-authorization'] ? 'bad' : 'none'})`, target: `HTTP ${req.url}` });
  if (!user) {
    res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="shifter"' });
    return res.end();
  }
  let u;
  try {
    u = new URL(req.url);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  const headers = { ...req.headers };
  delete headers['proxy-authorization'];
  const up = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => res.destroy());
  req.pipe(up);
}

const tunnels = new Set();

/** Close every open tunnel (like a network change): the browser has to reconnect. */
export function dropTunnels() {
  for (const s of tunnels) s.destroy();
  tunnels.clear();
}

function onConnect(req, sock, head) {
  tunnels.add(sock);
  sock.on('close', () => tunnels.delete(sock));
  const user = userOf(req);
  if (!user) {
    sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="shifter"\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  log.push({ user, target: req.url });
  const [host, port] = req.url.split(':');
  const up = net.connect(options.tunnelPort ?? Number(port), options.tunnelPort ? '127.0.0.1' : host, () => {
    sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
}

const gateways = GATEWAY_PORTS.map(() => http.createServer(onRequest).on('connect', onConnect));

export function start(testOptions = {}) {
  options = testOptions;
  log.length = 0;
  return Promise.all([
    new Promise((r) => api.listen(18080, '127.0.0.1', r)),
    // '::' so both 127.0.0.1 and *.localhost (which may resolve to ::1) reach it.
    ...gateways.map((g, i) => new Promise((r) => g.listen(GATEWAY_PORTS[i], '::', r))),
  ]);
}

export function stop() {
  dropTunnels();
  api.close();
  gateways.forEach((g) => g.close());
}
