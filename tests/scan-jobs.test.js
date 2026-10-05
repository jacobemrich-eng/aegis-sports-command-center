const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
let workerModule;
async function worker() {
  workerModule ||= import(pathToFileURL(path.join(ROOT, 'cloudflare', 'worker.mjs')).href);
  return workerModule;
}

const secret = 'test-session-secret';
const sessionId = 'test-session-id';
const csrf = 'test-csrf-value';
const expiry = Date.now() + 60 * 60 * 1000;
const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
const tokenPayload = `v1.${sessionId}.${expiry}`;
const tokenSignature = crypto.createHmac('sha256', secret).update(tokenPayload).digest('base64url');
const cookie = `aegis_session=${encodeURIComponent(`${tokenPayload}.${tokenSignature}`)}`;

function request(pathname, { method = 'GET', body, csrfHeader = false } = {}) {
  return new Request(`https://edge.example${pathname}`, {
    method,
    headers: {
      Origin: 'https://edge.example',
      'Sec-Fetch-Site': 'same-origin',
      Cookie: cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrfHeader ? { 'X-AEGIS-CSRF': csrf } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function environment(overrides = {}) {
  return {
    AEGIS_SESSION_SECRET: secret,
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SECRET_KEY: 'sb_secret_test_value',
    AEGIS_SCAN_ORCHESTRATION_ENABLED: 'true',
    AEGIS_SCAN_ALLOWED_SPORTS: 'baseball_mlb,americanfootball_ncaaf',
    AEGIS_GITHUB_ACTIONS_TOKEN: 'never-real-test-token',
    AEGIS_SCAN_WORKFLOW_REF: 'review/v9-6-scan-desk',
    ...overrides
  };
}

async function withFetch(mock, callback) {
  const original = global.fetch;
  global.fetch = mock;
  try { return await callback(); } finally { global.fetch = original; }
}

function supabaseSessionResponse() {
  return new Response(JSON.stringify([{ session_id_hash: sessionHash, csrf_token: csrf, expires_at: new Date(expiry).toISOString(), revoked_at: null }]), { status: 200 });
}

test('Scan Desk queue requires admin CSRF, enabled orchestration, and approved scope', { concurrency: false }, async () => {
  const module = await worker();
  let githubCalls = 0;
  const response = await withFetch(async url => {
    if (String(url).includes('/aegis_admin_sessions?')) return supabaseSessionResponse();
    githubCalls++;
    throw new Error('unexpected dispatch');
  }, async () => {
    let result = await module.default.fetch(request('/api/scan', { method: 'POST', body: { sport: 'baseball_mlb', markets: 'h2h' } }), environment({ AEGIS_SCAN_ORCHESTRATION_ENABLED: 'false' }));
    assert.equal(result.status, 403); // The mutation guard rejects missing CSRF before any work.
    result = await module.default.fetch(request('/api/scan', { method: 'POST', body: { sport: 'baseball_mlb', markets: 'h2h' }, csrfHeader: true }), environment({ AEGIS_SCAN_ORCHESTRATION_ENABLED: 'false' }));
    assert.equal(result.status, 503);
    assert.equal((await result.json()).code, 'scan_orchestration_unavailable');
    return module.default.fetch(request('/api/scan', { method: 'POST', body: { sport: 'icehockey_nhl', markets: 'h2h' }, csrfHeader: true }), environment());
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'scan_request_not_allowed');
  assert.equal(githubCalls, 0);
});

test('confirmed scan stores only bounded intent and dispatches a fixed workflow with opaque job ID', { concurrency: false }, async () => {
  const module = await worker();
  const calls = [];
  const response = await withFetch(async (url, options = {}) => {
    const address = String(url);
    calls.push({ address, options });
    if (address.includes('/aegis_admin_sessions?')) return supabaseSessionResponse();
    if (address.includes('/rpc/aegis_create_scan_job')) {
      const job = JSON.parse(options.body);
      return new Response(JSON.stringify([{ job_id: job.p_id, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }]), { status: 200 });
    }
    if (address.includes('/actions/workflows/aegis-scan-job.yml/dispatches')) return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch ${address}`);
  }, () => module.default.fetch(request('/api/scan', { method: 'POST', body: { sport: 'baseball_mlb', markets: 'h2h,spreads,totals' }, csrfHeader: true }), environment()));

  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.match(payload.job_id, /^[0-9a-f-]{36}$/i);
  assert.equal(payload.status, 'queued');
  const create = calls.find(call => call.address.includes('/rpc/aegis_create_scan_job'));
  const storedIntent = JSON.parse(create.options.body);
  assert.deepEqual(Object.keys(storedIntent).sort(), ['p_id', 'p_markets', 'p_session_id_hash', 'p_sport']);
  assert.equal(storedIntent.p_id, payload.job_id);
  assert.equal(storedIntent.p_session_id_hash, sessionHash);
  const dispatch = calls.find(call => call.address.includes('/actions/workflows/'));
  assert.match(dispatch.address, /jacobemrich-eng\/aegis-sports-command-center\/actions\/workflows\/aegis-scan-job\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(dispatch.options.body), { ref: 'review/v9-6-scan-desk', inputs: { job_id: payload.job_id } });
  assert.equal(dispatch.options.headers.Authorization, 'Bearer never-real-test-token');
});

test('scan queue rejects injected analysis data, rate limits, and hides GitHub dispatch errors', { concurrency: false }, async () => {
  const module = await worker();
  let rpcCalls = 0;
  const rejectedBody = await withFetch(async url => String(url).includes('/aegis_admin_sessions?') ? supabaseSessionResponse() : (() => { rpcCalls++; return new Response('[]'); })(), () =>
    module.default.fetch(request('/api/scan', { method: 'POST', body: { sport: 'baseball_mlb', markets: 'h2h', events: [{ id: 'forged' }] }, csrfHeader: true }), environment()));
  assert.equal(rejectedBody.status, 422);
  assert.equal(rpcCalls, 0);

  const limited = await withFetch(async url => {
    if (String(url).includes('/aegis_admin_sessions?')) return supabaseSessionResponse();
    return new Response('[]', { status: 200 });
  }, () => module.default.fetch(request('/api/scan', { method: 'POST', body: { sport: 'baseball_mlb', markets: 'h2h' }, csrfHeader: true }), environment()));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'scan_rate_limited');

  const dispatchFailure = await withFetch(async (url, options = {}) => {
    const address = String(url);
    if (address.includes('/aegis_admin_sessions?')) return supabaseSessionResponse();
    if (address.includes('/rpc/aegis_create_scan_job')) {
      return new Response(JSON.stringify([{ job_id: JSON.parse(options.body).p_id, expires_at: new Date(Date.now() + 10000).toISOString() }]), { status: 200 });
    }
    if (address.includes('/actions/workflows/')) return new Response('private token leaked upstream', { status: 403 });
    return new Response(null, { status: 204 });
  }, () => module.default.fetch(request('/api/scan', { method: 'POST', body: { sport: 'baseball_mlb', markets: 'h2h' }, csrfHeader: true }), environment()));
  const raw = await dispatchFailure.text();
  assert.equal(dispatchFailure.status, 503);
  assert.match(raw, /scan_dispatch_failed/);
  assert.doesNotMatch(raw, /private token leaked upstream|never-real-test-token/);
});

test('job status is admin-session scoped, no-store, and returns results only after completion', { concurrency: false }, async () => {
  const module = await worker();
  const id = 'cfb2dc23-ae2d-4faf-83da-f980850e4fb9';
  let queried;
  const response = await withFetch(async url => {
    const address = String(url);
    if (address.includes('/aegis_admin_sessions?')) return supabaseSessionResponse();
    queried = new URL(address).searchParams;
    return new Response(JSON.stringify([{ id, status: 'completed', result: { slate_grade: 'PASS', plays: [] }, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10000).toISOString() }]), { status: 200 });
  }, () => module.default.fetch(request(`/api/scan-jobs/${id}`), environment()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(queried.get('session_id_hash'), `eq.${sessionHash}`);
  assert.equal(queried.get('expires_at').startsWith('gt.'), true);
  assert.deepEqual((await response.json()).result, { slate_grade: 'PASS', plays: [] });
});

test('job runner validates opaque IDs and never receives user-supplied event or recommendation data', async () => {
  const runner = require('../scripts/run-scan-job');
  await assert.rejects(() => runner.processJob('not-a-uuid'), /invalid_scan_job_id/);
  const source = read('scripts/run-scan-job.js');
  assert.match(source, /engine\.oddsFetch\(endpoint, \{ force: false \}\)/);
  assert.match(source, /engine\.scanSlate\(events\)/);
  assert.match(source, /autopilot\.captureScan\(/);
  assert.match(source, /status: 'eq\.queued'/);
  assert.match(source, /release_enabled = autopilot\.config\.RELEASE_SPORTS\.includes\(job\.sport\)/);
  assert.doesNotMatch(source, /job\.(?:events|analyses|plays|result)\b/);
  assert.doesNotMatch(source, /openai|responses\.create/i);
});

test('scan migration locks jobs to service role and applies per-admin request limits', () => {
  const sql = read('sql/supabase.sql');
  assert.match(sql, /create table if not exists public\.aegis_scan_jobs/i);
  assert.match(sql, /alter table public\.aegis_scan_jobs enable row level security/i);
  assert.match(sql, /revoke all on public\.aegis_scan_jobs from anon, authenticated/i);
  assert.match(sql, /grant all on public\.aegis_scan_jobs to service_role/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_session_id_hash, 0\)\)/i);
  assert.match(sql, /delete from public\.aegis_scan_jobs as expired_job\s+where expired_job\.created_at/i);
  assert.match(sql, /public\.aegis_scan_jobs as recent_job\s+where recent_job\.session_id_hash[\s\S]*recent_job\.created_at/i);
  assert.match(sql, />= 3 then/i);
  assert.match(sql, /interval '15 minutes'/i);
});

test('standalone scan RPC repair migration qualifies created_at references and preserves service-role-only access', () => {
  const sql = read('sql/2026-10-05-fix-scan-job-rpc-400.sql');
  assert.match(sql, /create or replace function public\.aegis_create_scan_job/i);
  assert.match(sql, /expired_job\.created_at/i);
  assert.match(sql, /recent_job\.created_at/i);
  assert.match(sql, /revoke all on function public\.aegis_create_scan_job[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.aegis_create_scan_job[\s\S]*to service_role/i);
});

test('scan workflow is manual, least-privilege Node 22, and accepts only an opaque job ID', () => {
  const workflow = read('.github/workflows/aegis-scan-job.yml');
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.match(workflow, /permissions:\s+contents: read/m);
  assert.match(workflow, /node-version: "22"/);
  assert.match(workflow, /node scripts\/run-scan-job\.js/);
  assert.match(workflow, /AEGIS_SCAN_JOB_ID: \$\{\{ inputs\.job_id \}\}/);
  assert.match(workflow, /ODDS_API_KEY: \$\{\{ secrets\.ODDS_API_KEY \}\}/);
  assert.match(workflow, /secrets\.SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|onrender\.com|^\s*BASE_URL:/im);
});
