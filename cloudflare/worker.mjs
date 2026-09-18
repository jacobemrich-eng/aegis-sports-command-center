import operationsModule from '../src/operations.js';
import { ENGINE_VERSION, MODELS, SPORTS } from './generated/registry.js';

const evaluateOperations = operationsModule.evaluate;
const SERVICE = 'aegis-sports-command-center';
const SESSION_COOKIE = 'aegis_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const EDGE_UNAVAILABLE = Object.freeze({
  error: 'This operation is not enabled on the Cloudflare Phase 1 edge.',
  code: 'edge_compute_not_enabled'
});
const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
});

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

function envText(env, key, fallback = '') {
  const value = String(env?.[key] ?? '').trim();
  return value || fallback;
}

function envNumber(env, key, fallback) {
  const value = Number(envText(env, key));
  return Number.isFinite(value) ? value : fallback;
}

function envBoolean(env, key, fallback = false) {
  const value = envText(env, key);
  return value ? /^(1|true|yes|on)$/i.test(value) : fallback;
}

function csv(env, key, fallback = '') {
  return envText(env, key, fallback).split(',').map(value => value.trim()).filter(Boolean);
}

export function supabaseHeaders(env, extra = {}) {
  const preferred = envText(env, 'SUPABASE_SECRET_KEY');
  const legacy = envText(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const key = preferred || legacy;
  if (!key) return null;
  const headers = { apikey: key, ...extra };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function supabaseConfigured(env) {
  return Boolean(envText(env, 'SUPABASE_URL') && supabaseHeaders(env));
}

async function supabaseRequest(env, path, options = {}) {
  const base = envText(env, 'SUPABASE_URL').replace(/\/+$/, '');
  const headers = supabaseHeaders(env, options.headers || {});
  if (!base || !headers) throw new Error('supabase_not_configured');
  const response = await fetch(`${base}${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`supabase_${response.status}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function selectState(env, select) {
  const id = envText(env, 'AEGIS_STATE_ID', 'main');
  const query = new URLSearchParams({ id: `eq.${id}`, select });
  const rows = await supabaseRequest(env, `/rest/v1/aegis_state?${query}`, {
    headers: { Accept: 'application/json' }
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function digestBytes(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

async function digestHex(value) {
  return Array.from(await digestBytes(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

function safeEqual(left, right) {
  const a = String(left || ''), b = String(right || '');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

function cookieValue(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const item of cookie.split(';')) {
    const at = item.indexOf('=');
    if (at < 0) continue;
    if (item.slice(0, at).trim() === name) {
      try { return decodeURIComponent(item.slice(at + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

async function signedSessionToken(sessionId, expiresAt, secret) {
  const payload = `v1.${sessionId}.${expiresAt}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

async function parseSessionToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const payload = parts.slice(0, 3).join('.');
  if (!safeEqual(parts[3], await hmac(payload, secret))) return null;
  const expiresAt = Number(parts[2]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return { sessionId: parts[1], expiresAt };
}

async function sessionFromRequest(request, env) {
  const secret = envText(env, 'AEGIS_SESSION_SECRET');
  if (!secret || !supabaseConfigured(env)) return null;
  const parsed = await parseSessionToken(cookieValue(request, SESSION_COOKIE), secret);
  if (!parsed) return null;
  const hash = await digestHex(parsed.sessionId);
  const query = new URLSearchParams({
    session_id_hash: `eq.${hash}`,
    select: 'session_id_hash,csrf_token,expires_at,revoked_at'
  });
  const rows = await supabaseRequest(env, `/rest/v1/aegis_admin_sessions?${query}`, {
    headers: { Accept: 'application/json' }
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return { ...row, sessionIdHash: hash };
}

function sameOrigin(request) {
  const target = new URL(request.url);
  const fetchSite = String(request.headers.get('Sec-Fetch-Site') || '').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin') return false;
  const origin = request.headers.get('Origin');
  if (origin) {
    try { return new URL(origin).origin === target.origin; } catch { return false; }
  }
  const referer = request.headers.get('Referer');
  if (referer) {
    try { return new URL(referer).origin === target.origin; } catch { return false; }
  }
  return false;
}

async function requireAdmin(request, env) {
  const session = await sessionFromRequest(request, env);
  return session || json({ error: 'Authentication required.', code: 'authentication_required' }, 401, { 'Cache-Control': 'no-store' });
}

async function requireAdminMutation(request, env) {
  if (!sameOrigin(request)) return json({ error: 'Request origin rejected.', code: 'invalid_origin' }, 403, { 'Cache-Control': 'no-store' });
  const session = await sessionFromRequest(request, env);
  if (!session) return json({ error: 'Authentication required.', code: 'authentication_required' }, 401, { 'Cache-Control': 'no-store' });
  if (!safeEqual(request.headers.get('X-AEGIS-CSRF'), session.csrf_token)) {
    return json({ error: 'Request verification failed.', code: 'invalid_csrf' }, 403, { 'Cache-Control': 'no-store' });
  }
  return session;
}

async function revokeSession(request, env) {
  const session = await sessionFromRequest(request, env);
  if (!session) return;
  const query = new URLSearchParams({ session_id_hash: `eq.${session.sessionIdHash}` });
  await supabaseRequest(env, `/rest/v1/aegis_admin_sessions?${query}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() })
  });
}

async function consumeLoginAttempt(request, env) {
  const source = request.headers.get('CF-Connecting-IP') || 'unknown';
  const sourceHash = await digestHex(source);
  const windowStartMs = Math.floor(Date.now() / (LOGIN_WINDOW_SECONDS * 1000)) * LOGIN_WINDOW_SECONDS * 1000;
  const result = await supabaseRequest(env, '/rest/v1/rpc/aegis_edge_consume_login_attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_source_hash: sourceHash,
      p_window_start: new Date(windowStartMs).toISOString(),
      p_max_attempts: LOGIN_ATTEMPTS
    })
  });
  return Number(result);
}

async function createSession(request, env) {
  const sessionId = randomToken(32);
  const csrfToken = randomToken(32);
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const row = {
    session_id_hash: await digestHex(sessionId),
    csrf_token: csrfToken,
    expires_at: new Date(expiresAt).toISOString(),
    created_at: new Date().toISOString(),
    revoked_at: null
  };
  await supabaseRequest(env, '/rest/v1/aegis_admin_sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row)
  });
  await revokeSession(request, env);
  return {
    token: await signedSessionToken(sessionId, expiresAt, envText(env, 'AEGIS_SESSION_SECRET')),
    csrfToken,
    expiresAt
  };
}

function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function timezoneKeys(timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}` };
}

function statusFromState(row, env) {
  const autopilot = row?.autopilot || {};
  const timezone = envText(env, 'AEGIS_TIMEZONE', 'America/New_York');
  const keys = timezoneKeys(timezone);
  const dailyBudget = envNumber(env, 'AEGIS_DAILY_ODDS_CREDIT_BUDGET', 18);
  const monthlyBudget = envNumber(env, 'AEGIS_MONTHLY_ODDS_CREDIT_BUDGET', 450);
  const today = Number(autopilot.daily_usage?.[keys.day] || 0);
  const month = Number(autopilot.monthly_usage?.[keys.month] || 0);
  const latestCards = row?.latest_cards || {};
  const cards = Object.entries(latestCards).map(([sport, card]) => ({
    sport,
    generated_at: card?.generated_at || null,
    slate_grade: card?.slate_grade || null,
    core: (card?.plays || []).filter(play => play.tier === 'CORE').length,
    secondary: (card?.plays || []).filter(play => play.tier === 'SECONDARY').length,
    watch: (card?.plays || []).filter(play => play.tier === 'WATCH').length,
    pass: (card?.passes || []).length,
    release_enabled: card?.release_enabled !== false
  }));
  return {
    enabled: envBoolean(env, 'AEGIS_AUTOPILOT_ENABLED', true),
    timezone,
    persistent: true,
    storage_backend: 'supabase',
    last_tick_at: autopilot.last_tick_at || null,
    last_success_at: autopilot.last_success_at || null,
    last_error: autopilot.last_error || null,
    usage: {
      today,
      daily_budget: dailyBudget,
      month,
      monthly_budget: monthlyBudget,
      daily_remaining: Math.max(0, dailyBudget - today),
      monthly_remaining: Math.max(0, monthlyBudget - month)
    },
    provider_quota: autopilot.provider_quota || null,
    release_sports: csv(env, 'AEGIS_RELEASE_SPORTS', 'baseball_mlb,americanfootball_ncaaf'),
    cards,
    alerts: Array.isArray(row?.alerts) ? row.alerts.slice(-20).reverse() : [],
    locks: Array.isArray(row?.locks) ? row.locks.filter(lock => !lock.result).slice(-20).reverse() : [],
    grading: autopilot.grading || { last_run_at: null, last_graded: 0 },
    sport_runs: autopilot.sport_runs || {}
  };
}

async function loadStatusState(env) {
  return (await selectState(
    env,
    'autopilot:value->autopilot,latest_cards:value->latest_cards,alerts:value->alerts,locks:value->locks,updated_at'
  )) || { autopilot: {}, latest_cards: {}, alerts: [], locks: [] };
}

function operationsFromStatus(auto, env) {
  return evaluateOperations({
    auto,
    storage: { ok: true, persistent: true, backend: 'supabase' },
    config: {
      autopilotEnabled: auto.enabled,
      dailyBudget: auto.usage.daily_budget,
      monthlyBudget: auto.usage.monthly_budget,
      scheduleMinutes: 15,
      autoLockMinutes: envNumber(env, 'AEGIS_AUTO_LOCK_MINUTES', 30),
      gradeDelayHours: envNumber(env, 'AEGIS_GRADE_DELAY_HOURS', 2),
      releaseSports: auto.release_sports,
      schedulerRedundancy: {
        ready: false,
        status: 'UNCONFIGURED',
        source: 'cloudflare-phase-1-preview'
      }
    },
    production: true,
    uptimeSeconds: null
  });
}

async function cachedPublicRead(request, seconds, producer) {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const response = await producer();
  if (cache && response.ok) await cache.put(cacheKey, response.clone());
  return response;
}

async function publicLatestCard(request, env) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport');
  if (sport && !SPORTS.some(item => item.key === sport)) return json({ error: 'Unsupported sport.', code: 'invalid_request' }, 400);
  const select = sport
    ? `card:value->latest_cards->${sport}`
    : 'card:value->latest_cards';
  const row = await selectState(env, select);
  return json({ card: row?.card ?? null, sport: sport || null }, 200, {
    'Cache-Control': 'public, max-age=5, s-maxage=15'
  });
}

async function publicLedger(env) {
  const row = await selectState(env, 'audit:value->audit,locks:value->locks,tier_history:value->tier_history');
  return json({
    audit: Array.isArray(row?.audit) ? row.audit : [],
    locks: Array.isArray(row?.locks) ? row.locks : [],
    tier_history: Array.isArray(row?.tier_history) ? row.tier_history : []
  }, 200, { 'Cache-Control': 'public, max-age=5, s-maxage=15' });
}

async function login(request, env) {
  if (!sameOrigin(request)) return json({ error: 'Invalid request.', code: 'invalid_request' }, 403, { 'Cache-Control': 'no-store' });
  if (!supabaseConfigured(env)) {
    return json({ error: 'AEGIS administrator login is unavailable.', code: 'admin_auth_unavailable' }, 503, { 'Cache-Control': 'no-store' });
  }
  const attempts = await consumeLoginAttempt(request, env);
  if (!Number.isFinite(attempts) || attempts > LOGIN_ATTEMPTS) {
    return json({ error: 'Too many authentication attempts.', code: 'rate_limited' }, 429, { 'Cache-Control': 'no-store', 'Retry-After': String(LOGIN_WINDOW_SECONDS) });
  }
  if (!envText(env, 'AEGIS_ACCESS_PIN') || !envText(env, 'AEGIS_SESSION_SECRET')) {
    return json({ error: 'AEGIS administrator login is unavailable.', code: 'admin_auth_unavailable' }, 503, { 'Cache-Control': 'no-store' });
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.', code: 'invalid_request' }, 400, { 'Cache-Control': 'no-store' }); }
  const supplied = await digestHex(String(body?.pin || ''));
  const expected = await digestHex(envText(env, 'AEGIS_ACCESS_PIN'));
  if (!safeEqual(supplied, expected)) return json({ error: 'Authentication failed.', code: 'authentication_failed' }, 401, { 'Cache-Control': 'no-store' });
  const created = await createSession(request, env);
  return json({
    ok: true,
    csrf_token: created.csrfToken,
    expires_at: new Date(created.expiresAt).toISOString()
  }, 200, { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(created.token) });
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/api/health') {
    return json({ ok: true, status: 'UP', service: SERVICE });
  }
  if (request.method === 'GET' && pathname === '/api/session') {
    const session = await sessionFromRequest(request, env);
    return json(session ? {
      authenticated: true,
      csrf_token: session.csrf_token,
      expires_at: session.expires_at
    } : { authenticated: false }, 200, { 'Cache-Control': 'no-store' });
  }
  if (request.method === 'POST' && pathname === '/api/login') return login(request, env);
  if (request.method === 'POST' && pathname === '/api/logout') {
    const session = await requireAdminMutation(request, env);
    if (session instanceof Response) return session;
    await revokeSession(request, env);
    return json({ ok: true }, 200, { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie('', 0) });
  }
  if (request.method === 'GET' && pathname === '/api/models') {
    return json({ models: MODELS }, 200, { 'Cache-Control': 'public, max-age=300' });
  }
  if (request.method === 'GET' && pathname === '/api/sports') {
    return json({ sports: SPORTS }, 200, { 'Cache-Control': 'public, max-age=300' });
  }
  if (request.method === 'GET' && pathname === '/api/cards/latest') {
    return cachedPublicRead(request, 15, () => publicLatestCard(request, env));
  }
  if (request.method === 'GET' && pathname === '/api/results/ledger') {
    return cachedPublicRead(request, 15, () => publicLedger(env));
  }

  if (request.method === 'GET' && pathname === '/api/autopilot/status') {
    const session = await requireAdmin(request, env);
    if (session instanceof Response) return session;
    return json({ ...statusFromState(await loadStatusState(env), env), platform_mode: 'cloudflare-edge-preview', compute_mode: 'github-actions-direct' }, 200, { 'Cache-Control': 'no-store' });
  }
  if (request.method === 'GET' && pathname === '/api/operations/status') {
    const session = await requireAdmin(request, env);
    if (session instanceof Response) return session;
    const auto = statusFromState(await loadStatusState(env), env);
    const operations = operationsFromStatus(auto, env);
    return json({
      ok: operations.status !== 'RED',
      platform_mode: 'cloudflare-edge-preview',
      compute_mode: 'github-actions-direct',
      engine_version: ENGINE_VERSION,
      operations
    }, 200, { 'Cache-Control': 'no-store' });
  }
  if (request.method === 'GET' && pathname === '/api/admin/status') {
    const session = await requireAdmin(request, env);
    if (session instanceof Response) return session;
    const auto = statusFromState(await loadStatusState(env), env);
    const operations = operationsFromStatus(auto, env);
    return json({
      ok: operations.status !== 'RED',
      status: operations.status,
      version: '9.3.0-edge-preview',
      engine_version: ENGINE_VERSION,
      platform_mode: 'cloudflare-edge-preview',
      compute_mode: 'github-actions-direct',
      operations,
      authenticated: true,
      persistent_storage: true,
      storage_backend: 'supabase',
      storage_ok: true,
      odds_ready: Boolean(envText(env, 'ODDS_API_KEY')),
      cfbd_ready: Boolean(envText(env, 'CFBD_API_KEY')),
      autopilot_enabled: auto.enabled,
      autopilot_secret_ready: false,
      last_autopilot_success: auto.last_success_at,
      last_autopilot_error: auto.last_error,
      daily_odds_budget: auto.usage.daily_budget,
      monthly_odds_budget: auto.usage.monthly_budget,
      max_deep_market_credits: envNumber(env, 'MAX_DEEP_MARKET_CREDITS', 10),
      odds_cache_ttl_ms: envNumber(env, 'ODDS_CACHE_TTL_MS', 120000),
      release_sports: auto.release_sports
    }, 200, { 'Cache-Control': 'no-store' });
  }
  if (request.method === 'GET' && pathname === '/api/state/export') {
    const session = await requireAdmin(request, env);
    if (session instanceof Response) return session;
    const row = await selectState(env, 'value,updated_at');
    return json({
      exported_at: new Date().toISOString(),
      version: '9.3.0-edge-preview',
      release_version: '9.3.0-edge-preview',
      engine_version: ENGINE_VERSION,
      platform_mode: 'cloudflare-edge-preview',
      state: row?.value || null
    }, 200, { 'Cache-Control': 'no-store' });
  }

  const unsupportedMutations = new Set([
    '/api/scan',
    '/api/card/lock',
    '/api/results/grade',
    '/api/results/resolve',
    '/api/admin/diagnostics/provider-failover',
    '/api/autopilot/tick'
  ]);
  if (request.method === 'POST' && unsupportedMutations.has(pathname)) {
    const session = await requireAdminMutation(request, env);
    if (session instanceof Response) return session;
    return json(EDGE_UNAVAILABLE, 409, { 'Cache-Control': 'no-store' });
  }
  if (request.method === 'POST' && pathname === '/api/autopilot/heartbeat') {
    return json(EDGE_UNAVAILABLE, 503, { 'Cache-Control': 'no-store' });
  }
  if (request.method === 'GET' && pathname === '/api/odds') {
    const session = await requireAdmin(request, env);
    if (session instanceof Response) return session;
    return json(EDGE_UNAVAILABLE, 503, { 'Cache-Control': 'no-store' });
  }
  if (pathname.startsWith('/api/')) return json({ error: 'Not found.', code: 'not_found' }, 404);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch {
      console.error('AEGIS edge request failed.', { route: new URL(request.url).pathname, code: 'edge_internal_error' });
      return json({ error: 'Internal server error', code: 'internal_server_error' }, 500, { 'Cache-Control': 'no-store' });
    }
  }
};

export const contracts = Object.freeze({
  SESSION_TTL_SECONDS,
  LOGIN_ATTEMPTS,
  LOGIN_WINDOW_SECONDS
});
