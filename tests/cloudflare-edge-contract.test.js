const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const workerSource = read('cloudflare/worker.mjs');
const sql = read('sql/cloudflare_edge_auth.sql');
const workflow = read('.github/workflows/aegis-cloudflare-autopilot.yml');
const wrangler = JSON.parse(read('wrangler.jsonc'));

let workerModule;
async function worker() {
  workerModule ||= import(pathToFileURL(path.join(ROOT, 'cloudflare', 'worker.mjs')).href);
  return workerModule;
}

test('Cloudflare public health preserves the exact minimal contract', async () => {
  const module = await worker();
  const response = await module.default.fetch(new Request('https://edge.example/api/health'), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: 'UP',
    service: 'aegis-sports-command-center'
  });
});

test('Wrangler uses asset-first static hosting without global Worker invocation', () => {
  assert.equal(wrangler.name, 'aegis-sports-command-center');
  assert.equal(wrangler.main, 'cloudflare/worker.mjs');
  assert.equal(wrangler.compatibility_date, '2026-09-17');
  assert.equal(wrangler.assets.directory, './public');
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.notEqual(wrangler.assets.run_worker_first, true);
  assert.equal('run_worker_first' in wrangler.assets, false);
});

test('static assets preserve the production security-header contract', () => {
  const headers = read('public/_headers');
  for (const expected of [
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: same-origin',
    'X-Frame-Options: DENY',
    'Permissions-Policy: camera=(), microphone=(), geolocation=()',
    "default-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ]) assert.match(headers, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Worker exposes required public, session, and administrator read routes', () => {
  for (const route of [
    '/api/health',
    '/api/session',
    '/api/models',
    '/api/sports',
    '/api/cards/latest',
    '/api/results/ledger',
    '/api/assistant',
    '/api/login',
    '/api/logout',
    '/api/admin/status',
    '/api/autopilot/status',
    '/api/operations/status',
    '/api/state/export'
  ]) assert.match(workerSource, new RegExp(route.replaceAll('/', '\\/')));
});

test('administrator sessions are Supabase-backed and never process-local authority', () => {
  assert.match(workerSource, /aegis_admin_sessions/);
  assert.doesNotMatch(workerSource, /(?:const|let|var)\s+sessions\s*=\s*new\s+Map/i);
  assert.doesNotMatch(workerSource, /(?:const|let|var)\s+sessionRegistry/i);
  assert.match(sql, /alter table public\.aegis_admin_sessions enable row level security/i);
  assert.match(sql, /revoke all on table public\.aegis_admin_sessions from public, anon, authenticated/i);
  assert.match(sql, /alter table public\.aegis_login_rate_limits enable row level security/i);
  assert.match(sql, /revoke all on table public\.aegis_login_rate_limits from public, anon, authenticated/i);
});

test('session cookie, rotation, expiry, logout, origin, and CSRF contracts are explicit', async () => {
  const module = await worker();
  assert.equal(module.contracts.SESSION_TTL_SECONDS, 8 * 60 * 60);
  assert.match(workerSource, /crypto\.getRandomValues/);
  assert.match(workerSource, /await revokeSession\(request, env\)/);
  assert.match(workerSource, /revoked_at/);
  assert.match(workerSource, /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=/);
  assert.match(workerSource, /X-AEGIS-CSRF/);
  assert.match(workerSource, /Sec-Fetch-Site/);
  assert.match(workerSource, /request\.headers\.get\('Origin'\)/);
  assert.match(workerSource, /request\.headers\.get\('Referer'\)/);
  const anonymous = await module.default.fetch(new Request('https://edge.example/api/session'), {});
  assert.deepEqual(await anonymous.json(), { authenticated: false });
  assert.equal(anonymous.headers.get('Cache-Control'), 'no-store');
});

test('shared login limiter preserves eight attempts per 15-minute fixed window', async () => {
  const module = await worker();
  assert.equal(module.contracts.LOGIN_ATTEMPTS, 8);
  assert.equal(module.contracts.LOGIN_WINDOW_SECONDS, 15 * 60);
  assert.match(workerSource, /rpc\/aegis_edge_consume_login_attempt/);
  assert.match(sql, /on conflict \(source_hash, window_start\)/i);
  assert.match(sql, /p_max_attempts <> 8/i);
  assert.match(sql, /interval '30 minutes'/i);
});

test('Supabase modern secret and legacy service-role headers match Node persistence semantics', async () => {
  const module = await worker();
  const modern = module.supabaseHeaders({ SUPABASE_SECRET_KEY: 'sb_secret_test_value' });
  assert.equal(modern.apikey, 'sb_secret_test_value');
  assert.equal(modern.Authorization, undefined);
  const legacy = module.supabaseHeaders({ SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.value' });
  assert.equal(legacy.apikey, 'legacy.jwt.value');
  assert.equal(legacy.Authorization, 'Bearer legacy.jwt.value');
});

test('public state reads select bounded JSON paths and cache only safe endpoints', () => {
  assert.match(workerSource, /card:value->latest_cards/);
  assert.match(workerSource, /audit:value->audit,locks:value->locks,tier_history:value->tier_history/);
  assert.match(workerSource, /Cache-Control': 'public, max-age=5, s-maxage=15/);
  assert.match(workerSource, /Cache-Control': 'no-store/);
  assert.doesNotMatch(workerSource, /publicLatestCard[\s\S]{0,900}selectState\(env, 'value'/);
  assert.doesNotMatch(workerSource, /publicLedger[\s\S]{0,700}selectState\(env, 'value'/);
});

test('Phase 1 compute routes fail explicitly instead of emulating the engine', async () => {
  assert.match(workerSource, /edge_compute_not_enabled/);
  for (const route of [
    '/api/scan',
    '/api/odds',
    '/api/results/grade',
    '/api/results/resolve',
    '/api/admin/diagnostics/provider-failover',
    '/api/autopilot/tick',
    '/api/autopilot/heartbeat'
  ]) assert.match(workerSource, new RegExp(route.replaceAll('/', '\\/')));
  for (const forbidden of [
    '../src/engine.js',
    '../src/autopilot.js',
    '../src/store.js',
    '../src/provider-router.js',
    '../src/odds-provider.js'
  ]) assert.doesNotMatch(workerSource, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const module = await worker();
  const response = await module.default.fetch(new Request('https://edge.example/api/autopilot/heartbeat', { method: 'POST' }), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'This operation is not enabled on the Cloudflare Phase 1 edge.',
    code: 'edge_compute_not_enabled'
  });
});

test('direct Autopilot runner requires and re-verifies durable Supabase persistence', () => {
  const runner = read('scripts/autopilot-direct.js');
  assert.match(runner, /require\('\.\.\/src\/autopilot'\)/);
  assert.match(runner, /require\('\.\.\/src\/store'\)/);
  assert.match(runner, /if \(!store\.persistent\)/);
  assert.match(runner, /storage\?\.persistent !== true/);
  assert.match(runner, /storage\?\.backend !== 'supabase'/);
  assert.match(runner, /status\?\.last_error/);
  assert.doesNotMatch(runner, /console\.log\(.*process\.env/s);
});

test('direct workflow is manual-only Node 22 compute and never calls Render', () => {
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.match(workflow, /node-version: "22"/);
  assert.match(workflow, /node scripts\/autopilot-direct\.js/);
  assert.doesNotMatch(workflow, /onrender\.com/i);
  assert.doesNotMatch(workflow, /^\s*BASE_URL:/m);
  assert.doesNotMatch(workflow, /\/api\/autopilot\/tick/);
  assert.match(workflow, /secrets\.SUPABASE_SECRET_KEY/);
  assert.match(workflow, /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
});

test('generated Cloudflare registry is synchronized with the canonical engine registry', async () => {
  const generator = require('../scripts/build-cloudflare-registry');
  assert.equal(read('cloudflare/generated/registry.js'), generator.generateRegistrySource());
  const generated = await import(pathToFileURL(path.join(ROOT, 'cloudflare', 'generated', 'registry.js')).href);
  const engine = require('../src/engine');
  assert.deepEqual(generated.MODELS, engine.MODELS);
  assert.deepEqual(generated.SPORTS, engine.SPORTS);
  assert.equal(generated.ENGINE_VERSION, engine.VERSION);
});

test('Cloudflare Phase 1 leaves betting-engine and governance identity unchanged', () => {
  const engine = require('../src/engine');
  const pkg = require('../package.json');
  assert.equal(engine.VERSION, '8.8.0-decision-intelligence');
  assert.equal(pkg.version, '9.1.2');
  assert.equal(fs.existsSync(path.join(ROOT, 'render.yaml')), true);
  assert.equal(fs.existsSync(path.join(ROOT, '.github', 'workflows', 'aegis-autopilot.yml')), true);
});
