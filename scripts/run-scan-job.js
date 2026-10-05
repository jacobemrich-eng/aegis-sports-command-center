'use strict';

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKET_SETS = new Set(['h2h', 'spreads', 'totals', 'h2h,spreads,totals']);

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('persistent_storage_not_configured');
  return { url, key };
}

async function database(path, options = {}) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: key,
      ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error('scan_job_storage_error');
  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function query(values) {
  return new URLSearchParams(values).toString();
}

async function processJob(jobId) {
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error('invalid_scan_job_id');
  const rows = await database(`/rest/v1/aegis_scan_jobs?${query({ id: `eq.${jobId}`, select: 'id,sport,markets,status,expires_at' })}`);
  const job = Array.isArray(rows) ? rows[0] : null;
  if (!job || job.status !== 'queued' || new Date(job.expires_at).getTime() <= Date.now()) {
    return { ok: true, skipped: true };
  }

  const allowlist = String(process.env.AEGIS_SCAN_ALLOWED_SPORTS || 'baseball_mlb,americanfootball_ncaaf').split(',').map(value => value.trim()).filter(Boolean);
  if (!allowlist.includes(job.sport) || !MARKET_SETS.has(job.markets)) {
    await finishJob(jobId, { status: 'failed', error_code: 'scan_request_not_allowed' }, 'queued');
    return { ok: false, code: 'scan_request_not_allowed' };
  }

  const claimed = await database(`/rest/v1/aegis_scan_jobs?${query({ id: `eq.${jobId}`, status: 'eq.queued', expires_at: `gt.${new Date().toISOString()}`, select: 'id' })}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'running', updated_at: new Date().toISOString() })
  });
  if (!Array.isArray(claimed) || !claimed.length) return { ok: true, skipped: true };

  try {
    const engine = require('../src/engine');
    const autopilot = require('../src/autopilot');
    const store = require('../src/store');
    if (store.persistent !== true) throw new Error('durable_storage_unavailable');

    const endpoint = `sports/${encodeURIComponent(job.sport)}/odds?bookmakers=${encodeURIComponent(engine.config().bookmakers)}&markets=${encodeURIComponent(job.markets)}&oddsFormat=american&dateFormat=iso`;
    const odds = await engine.oddsFetch(endpoint, { force: false });
    const events = engine.pregameOnly(odds.data || []).map(engine.sanitizeEvent);
    if (!events.length) throw new Error('no_upcoming_events');

    const card = await engine.scanSlate(events);
    card.board_refreshed = !odds.meta?.cached;
    card.board_age_ms = odds.meta?.cached ? Number(odds.meta.cache_age_ms || 0) : 0;
    card.board_source = 'canonical_node_provider';
    card.gateway_mode = 'github-actions-direct';
    card.release_enabled = autopilot.config.RELEASE_SPORTS.includes(job.sport);
    card.autopilot = { generated: false, reason: 'operator-approved canonical scan', release_enabled: card.release_enabled };
    const persistence = await autopilot.captureScan(job.sport, card, events, 'operator-approved canonical scan');
    if (persistence?.saved !== true || persistence?.persistent !== true) throw new Error('scan_result_persistence_failed');
    await finishJob(jobId, { status: 'completed', result: card, error_code: null });
    return { ok: true, skipped: false, sport: job.sport, games: events.length };
  } catch (error) {
    const allowed = new Set(['persistent_storage_not_configured', 'durable_storage_unavailable', 'no_upcoming_events', 'scan_result_persistence_failed']);
    const code = allowed.has(error?.message) ? error.message : 'canonical_scan_failed';
    await finishJob(jobId, { status: 'failed', error_code: code });
    return { ok: false, code };
  }
}

async function finishJob(jobId, values, expectedStatus = 'running') {
  await database(`/rest/v1/aegis_scan_jobs?${query({ id: `eq.${jobId}`, status: `eq.${expectedStatus}` })}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
}

if (require.main === module) {
  const jobId = String(process.env.AEGIS_SCAN_JOB_ID || '').trim();
  processJob(jobId).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  }).catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'scan_job_failed' })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { processJob, JOB_ID_PATTERN, MARKET_SETS };
