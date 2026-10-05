import operationsModule from '../src/operations.js';
import { ENGINE_VERSION, MODELS, SPORTS } from './generated/registry.js';

const evaluateOperations = operationsModule.evaluate;
const SERVICE = 'aegis-sports-command-center';
const SESSION_COOKIE = 'aegis_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const ASSISTANT_BODY_BYTES = 16 * 1024;
const ASSISTANT_PROMPT_CHARS = 1000;
const ASSISTANT_HISTORY_ITEMS = 6;
const ASSISTANT_HISTORY_CHARS = 4000;
const ASSISTANT_TOOL_ROUNDS = 3;
const ASSISTANT_TOOL_CALLS = 6;
const SCAN_BODY_BYTES = 2048;
const SCAN_MARKET_SETS = new Set(['h2h', 'spreads', 'totals', 'h2h,spreads,totals']);
const SCAN_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ASSISTANT_KNOWN_SPORTS = new Set([...SPORTS.map(item => item.key), 'icehockey_nhl', 'basketball_nba']);
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
  const raw = envText(env, key);
  if (!raw) return fallback;
  const value = Number(raw);
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
  if (!response.ok) {
    let code = '';
    try {
      const payload = await response.json();
      if (typeof payload?.code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(payload.code)) code = payload.code;
    } catch {}
    const error = new Error(`supabase_${response.status}`);
    error.status = response.status;
    error.code = code;
    throw error;
  }
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

const ASSISTANT_TOOLS = Object.freeze([
  {
    type: 'function',
    name: 'get_sports',
    description: 'List sports present in the canonical public AEGIS registry.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
  },
  {
    type: 'function',
    name: 'get_models',
    description: 'List canonical AEGIS model systems, optionally narrowed to a sport.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { sport: { type: ['string', 'null'], description: 'Canonical sport key, or null for all models.' } },
      required: ['sport'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'get_latest_card',
    description: 'Read the latest published canonical AEGIS card for one sport. This never runs a scan.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { sport: { type: 'string', description: 'Canonical sport key.' } },
      required: ['sport'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'get_results',
    description: 'Read bounded public AEGIS result records, optionally filtered to a sport.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        sport: { type: ['string', 'null'], description: 'Canonical sport key, or null for all sports.' },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: 50, description: 'Maximum rows, or null for the default.' }
      },
      required: ['sport', 'limit'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'get_play_details',
    description: 'Find a play or Pass decision only in existing published canonical AEGIS cards. This never runs a scan.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'Canonical sport key.' },
        event_id: { type: ['string', 'null'], description: 'Published event ID when known.' },
        matchup: { type: ['string', 'null'], description: 'Published matchup or team text when the event ID is unknown.' }
      },
      required: ['sport', 'event_id', 'matchup'],
      additionalProperties: false
    }
  }
]);

const ASSISTANT_INSTRUCTIONS = `You are Ask AEGIS, the public explanation and retrieval layer for AEGIS Sports Command Center.
Canonical published AEGIS data is authoritative. Use the provided read-only tools for any claim about sports, models, cards, plays, tiers, prices, projections, or results.
Never invent or simulate a scan, play, price, injury, projection, result, or model output. Never upgrade SECONDARY to CORE, WATCH to actionable, or PASS to a recommendation. WATCH is not actionable. PASS is not actionable.
If published data is absent, say so. If a fresh scan is required, say it has not been started here and direct the authenticated operator to review and explicitly confirm one in Scan Desk. Never start paid compute without that separate human confirmation.
Request independent read-only lookups together in one response and never repeat a tool call with identical arguments.
For broad overview questions, use bounded registry, model, and recent-result lookups; do not fetch a separate card for every registered sport.
When asked what is currently published, call exactly get_sports, get_models with sport null, and get_results with sport null and limit 10 together, then answer from those results. Do not call get_latest_card or get_play_details for that overview.
Do not provide guaranteed-profit language. Keep answers concise, plain text, and grounded in returned tool data.`;

function assistantHeaders(extra = {}) {
  return { 'Cache-Control': 'no-store', ...extra };
}

function assistantError(error, code, status, extraHeaders = {}) {
  return json({ error, code }, status, assistantHeaders(extraHeaders));
}

function canonicalSport(value, allowNull = false) {
  if (allowNull && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string') throw new Error('invalid_tool_arguments');
  const sport = value.trim();
  if (!ASSISTANT_KNOWN_SPORTS.has(sport)) throw new Error('invalid_tool_arguments');
  return sport;
}

function publicPlay(play) {
  const event = play?.event || {};
  return {
    event_id: String(play?.event_id || event.id || ''),
    matchup: event.away_team && event.home_team ? `${event.away_team} at ${event.home_team}` : String(play?.matchup || ''),
    commence_time: event.commence_time || play?.commence_time || null,
    market: play?.market || null,
    selection: play?.selection || null,
    point: play?.point ?? null,
    price: play?.price ?? null,
    book: play?.book || null,
    tier: String(play?.tier || 'PASS').toUpperCase(),
    units: Number(play?.units || 0),
    why: play?.why || null,
    timing: play?.timing || null,
    how_it_loses: Array.isArray(play?.how_it_loses) ? play.how_it_loses.slice(0, 8) : [],
    play_to: play?.play_to ?? null,
    pass_at: play?.pass_at ?? null,
    final_verification: play?.final_verification || null,
    projected_score: play?.market_projection_score || play?.projection?.projected_score || null,
    projected_total: play?.market_projection_total ?? play?.projection?.projected_total ?? null
  };
}

function publicCard(card, sport) {
  if (!card || typeof card !== 'object') return null;
  return {
    sport,
    generated_at: card.generated_at || null,
    version: card.version || null,
    slate_grade: card.slate_grade || null,
    release_enabled: card.release_enabled !== false,
    plays: (Array.isArray(card.plays) ? card.plays : []).slice(0, 20).map(publicPlay),
    passes: (Array.isArray(card.passes) ? card.passes : []).slice(0, 20).map(item => ({
      event_id: String(item?.event_id || ''),
      matchup: String(item?.matchup || ''),
      tier: 'PASS',
      reason: item?.reason || null
    }))
  };
}

function modelRowsForSport(sport) {
  if (!sport) return MODELS;
  const title = SPORTS.find(item => item.key === sport)?.title?.toLowerCase() || '';
  const category = sport.split('_').slice(-1)[0].toLowerCase();
  const shared = new Set(['governance', 'execution', 'projection', 'market', 'risk', 'data']);
  return MODELS.filter(item => shared.has(String(item?.[1] || '').toLowerCase()) || [title, category].includes(String(item?.[1] || '').toLowerCase()));
}

function parseToolArguments(call) {
  let args;
  try { args = JSON.parse(call?.arguments || '{}'); } catch { throw new Error('invalid_tool_arguments'); }
  if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('invalid_tool_arguments');
  return args;
}

function exactKeys(args, allowed) {
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('invalid_tool_arguments');
}

function matchesPublished(play, eventId, matchup) {
  if (eventId && String(play?.event_id || play?.event?.id || '') === eventId) return true;
  if (!matchup) return false;
  const haystack = [play?.matchup, play?.event_name, play?.event?.away_team, play?.event?.home_team]
    .filter(Boolean).join(' ').toLowerCase();
  const tokens = matchup.toLowerCase().split(/\s+(?:at|vs\.?|@)\s+/).map(value => value.trim()).filter(value => value.length >= 2);
  return tokens.length ? tokens.every(token => haystack.includes(token)) : haystack.includes(matchup.toLowerCase());
}

async function executeAssistantTool(name, args, env) {
  if (name === 'get_sports') {
    exactKeys(args, []);
    return { sports: SPORTS };
  }
  if (name === 'get_models') {
    exactKeys(args, ['sport']);
    const sport = canonicalSport(args.sport, true);
    return { sport, models: modelRowsForSport(sport).map(item => ({ name: item[0], category: item[1], description: item[2] })) };
  }
  if (name === 'get_latest_card') {
    exactKeys(args, ['sport']);
    const sport = canonicalSport(args.sport);
    const row = await selectState(env, `card:value->latest_cards->${sport}`);
    const card = publicCard(row?.card, sport);
    return { sport, card, published: Boolean(card) };
  }
  if (name === 'get_results') {
    exactKeys(args, ['sport', 'limit']);
    const sport = canonicalSport(args.sport, true);
    const requested = args.limit === null || args.limit === undefined ? 20 : Number(args.limit);
    if (!Number.isInteger(requested) || requested < 1 || requested > 50) throw new Error('invalid_tool_arguments');
    const row = await selectState(env, 'audit:value->audit');
    const audit = (Array.isArray(row?.audit) ? row.audit : [])
      .filter(item => item?.result !== null && item?.result !== undefined)
      .filter(item => !sport || item?.sport_key === sport || item?.sport === sport)
      .slice(-requested).reverse()
      .map(item => ({
        event_id: item?.event_id || null,
        sport: item?.sport_key || item?.sport || null,
        matchup: [item?.away_team, item?.home_team].filter(Boolean).join(' at '),
        market: item?.market || null,
        selection: item?.selection || null,
        tier: String(item?.locked_tier || item?.tier || 'PASS').toUpperCase(),
        price: item?.locked_price ?? item?.price ?? null,
        result: item?.result || null,
        graded_at: item?.graded_at || null
      }));
    return { sport, results: audit };
  }
  if (name === 'get_play_details') {
    exactKeys(args, ['sport', 'event_id', 'matchup']);
    const sport = canonicalSport(args.sport);
    const eventId = args.event_id === null ? '' : String(args.event_id || '').trim();
    const matchup = args.matchup === null ? '' : String(args.matchup || '').trim();
    if (!eventId && !matchup) throw new Error('invalid_tool_arguments');
    if (eventId.length > 160 || matchup.length > 240) throw new Error('invalid_tool_arguments');
    const row = await selectState(env, `card:value->latest_cards->${sport}`);
    const card = publicCard(row?.card, sport);
    const pool = [...(card?.plays || []), ...(card?.passes || [])];
    const found = pool.find(item => matchesPublished(item, eventId, matchup)) || null;
    return found
      ? { sport, found: true, play: found, requires_scan: false }
      : { sport, found: false, play: null, requires_scan: true, message: 'A fresh canonical AEGIS scan is required for that request. Live scan execution is not connected to the public assistant yet.' };
  }
  throw new Error('unknown_tool');
}

function assistantInput(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_request');
  if (Object.keys(body).some(key => !['prompt', 'history'].includes(key))) throw new Error('invalid_request');
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > ASSISTANT_PROMPT_CHARS || /<[^>]*>/.test(prompt)) throw new Error('invalid_request');
  const history = body.history === undefined ? [] : body.history;
  if (!Array.isArray(history) || history.length > ASSISTANT_HISTORY_ITEMS) throw new Error('invalid_request');
  let historyChars = 0;
  const normalizedHistory = history.map(item => {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') throw new Error('invalid_request');
    const content = item.content.trim();
    historyChars += content.length;
    if (!content || content.length > ASSISTANT_PROMPT_CHARS || /<[^>]*>/.test(content)) throw new Error('invalid_request');
    return { role: item.role, content };
  });
  if (historyChars > ASSISTANT_HISTORY_CHARS) throw new Error('invalid_request');
  return { prompt, input: [...normalizedHistory, { role: 'user', content: prompt }] };
}

function responseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  const chunks = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== 'message') continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function actionLanguage(text) {
  return /\b(?:bet|wager|lock|play it|take it|recommend(?:ed|ation)?|actionable|upgrade)\b/i.test(text);
}

function governanceFallback(toolResults) {
  const plays = toolResults.flatMap(result => [
    ...(result?.card?.plays || []),
    ...(result?.card?.passes || []),
    ...(result?.play ? [result.play] : [])
  ]);
  if (!plays.length) return 'No published AEGIS recommendation is available for that request. AEGIS will not invent a play when canonical card data is absent.';
  return plays.slice(0, 4).map(play => {
    const label = play.matchup || play.event_id || 'Published decision';
    const tier = String(play.tier || 'PASS').toUpperCase();
    const reason = play.why || play.reason || 'The published release gates remain authoritative.';
    return `${label}: ${tier}. ${reason}${['WATCH', 'PASS'].includes(tier) ? ` ${tier} is not an actionable recommendation.` : ''}`;
  }).join('\n');
}

function enforceAssistantGovernance(text, toolResults) {
  const flattened = toolResults.flatMap(result => [
    ...(result?.card?.plays || []),
    ...(result?.card?.passes || []),
    ...(result?.play ? [result.play] : [])
  ]);
  const tiers = new Set(flattened.map(item => String(item?.tier || 'PASS').toUpperCase()));
  const specificNonActionable = toolResults
    .map(result => result?.play)
    .filter(play => play && ['WATCH', 'PASS'].includes(String(play.tier || 'PASS').toUpperCase()));
  const noPublished = toolResults.some(result => result && ('card' in result) && !result.card);
  if ((noPublished && actionLanguage(text)) ||
      (tiers.size > 0 && [...tiers].every(tier => ['WATCH', 'PASS'].includes(tier)) && actionLanguage(text)) ||
      (specificNonActionable.length && /\b(?:CORE|SECONDARY)\b/i.test(text)) ||
      (!tiers.has('CORE') && /\bcore\b/i.test(text) && actionLanguage(text))) {
    return governanceFallback(toolResults);
  }
  return text;
}

async function openAIResponse(env, input) {
  const controller = new AbortController();
  const timeoutMs = Math.max(50, Math.min(30000, envNumber(env, 'AEGIS_ASSISTANT_TIMEOUT_MS', 12000)));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${envText(env, 'OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function anonymousAssistantIdentity(request) {
  const source = request.headers.get('CF-Connecting-IP') || 'unknown';
  return digestHex(source);
}

async function assistantRateAllowed(request, env) {
  if (!env?.AEGIS_ASSISTANT_RATE_LIMITER || typeof env.AEGIS_ASSISTANT_RATE_LIMITER.limit !== 'function') return false;
  const result = await env.AEGIS_ASSISTANT_RATE_LIMITER.limit({ key: await anonymousAssistantIdentity(request) });
  return result?.success === true;
}

function looksLikeFreshScanRequest(prompt) {
  return /\b(?:run|perform|start)\s+(?:a\s+)?(?:fresh\s+)?(?:aegis\s+)?scan\b|\b(?:run|perform)\s+aegis\s+(?:on|for)\b/i.test(prompt);
}

function isPublishedOverviewRequest(prompt) {
  return String(prompt || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === 'what is currently published';
}

function publishedOverviewText(overview) {
  const sports = Array.isArray(overview?.get_sports?.sports) ? overview.get_sports.sports : [];
  const models = Array.isArray(overview?.get_models?.models) ? overview.get_models.models : [];
  const results = Array.isArray(overview?.get_results?.results) ? overview.get_results.results : [];
  const sportNames = sports.map(item => item?.title).filter(Boolean);
  const sportSummary = sportNames.length ? `: ${sportNames.join(', ')}` : '';
  const lines = [
    `AEGIS currently publishes ${sports.length} sports in its canonical registry${sportSummary}.`,
    `${models.length} governed model and system definitions are published.`
  ];
  lines.push(results.length
    ? `The latest public results lookup returned ${results.length} graded record${results.length === 1 ? '' : 's'}.`
    : 'No recent graded result records are currently published.');
  lines.push('This overview is read-only and does not run a scan or create a recommendation.');
  return lines.join('\n');
}

function promptMatchesPublishedAnalysis(prompt, card) {
  const normalized = prompt.toLowerCase();
  const pool = [...(card?.plays || []), ...(card?.passes || [])];
  return pool.some(item => {
    const event = item?.event || {};
    const matchup = String(item?.matchup || '');
    const teams = event.away_team && event.home_team
      ? [event.away_team, event.home_team]
      : matchup.split(/\s+(?:at|vs\.?|@)\s+/i);
    return teams.length >= 2 && teams.every(team => String(team).trim().length >= 2 && normalized.includes(String(team).trim().toLowerCase()));
  });
}

async function scanRequirement(prompt, env) {
  if (!looksLikeFreshScanRequest(prompt)) return null;
  const row = await selectState(env, 'cards:value->latest_cards');
  const cards = row?.cards && typeof row.cards === 'object' ? Object.values(row.cards) : [];
  if (cards.some(card => promptMatchesPublishedAnalysis(prompt, card))) return null;
  return {
    response: 'A fresh canonical AEGIS scan is required for that request. Ask AEGIS has not started one; an authenticated operator can review and explicitly confirm the scan in Scan Desk.',
    tools_used: ['get_play_details'],
    grounded: true,
    requires_scan: true
  };
}

async function assistant(request, env) {
  if (!sameOrigin(request)) return assistantError('Request origin rejected.', 'invalid_origin', 403);
  if (!envBoolean(env, 'AEGIS_ASSISTANT_ENABLED', false)) return assistantError('Ask AEGIS is not enabled yet.', 'assistant_disabled', 503);
  if (!envText(env, 'OPENAI_API_KEY')) return assistantError('Ask AEGIS is not configured yet.', 'assistant_unavailable', 503);
  if (!String(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return assistantError('A JSON request body is required.', 'invalid_request', 415);
  }
  const declaredBytes = Number(request.headers.get('Content-Length') || 0);
  if (declaredBytes > ASSISTANT_BODY_BYTES) return assistantError('Request body is too large.', 'invalid_request', 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > ASSISTANT_BODY_BYTES) return assistantError('Request body is too large.', 'invalid_request', 413);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return assistantError('Invalid JSON request.', 'invalid_request', 400); }
  let input;
  try { input = assistantInput(parsed); } catch { return assistantError('Invalid assistant request.', 'invalid_request', 400); }
  if (!await assistantRateAllowed(request, env)) {
    return assistantError('Ask AEGIS is receiving too many requests. Please try again shortly.', 'rate_limited', 429, { 'Retry-After': '60' });
  }

  const requiresScan = await scanRequirement(input.prompt, env);
  if (requiresScan) return json(requiresScan, 200, assistantHeaders());

  const model = envText(env, 'AEGIS_ASSISTANT_MODEL', 'gpt-5-mini');
  const maxOutputTokens = Math.max(128, Math.min(1200, envNumber(env, 'AEGIS_ASSISTANT_MAX_OUTPUT_TOKENS', 500)));
  const publishedOverview = isPublishedOverviewRequest(input.prompt);
  const items = input.input.slice();
  const toolsUsed = [];
  const toolResults = [];
  let toolCalls = 0;

  if (publishedOverview) {
    const plan = [
      ['get_sports', {}],
      ['get_models', { sport: null }],
      ['get_results', { sport: null, limit: 10 }]
    ];
    const seededCalls = [];
    for (const [name, args] of plan) {
      const result = await executeAssistantTool(name, args, env);
      seededCalls.push({ name, result });
      toolCalls++;
      toolsUsed.push(name);
      toolResults.push(result);
    }
    const canonicalOverview = Object.fromEntries(seededCalls.map(call => [call.name, call.result]));
    return json({
      response: publishedOverviewText(canonicalOverview),
      tools_used: [...new Set(toolsUsed)],
      grounded: true,
      requires_scan: false
    }, 200, assistantHeaders());
  }

  for (let round = 0; round <= ASSISTANT_TOOL_ROUNDS; round++) {
    let upstream;
    try {
      upstream = await openAIResponse(env, {
        model,
        store: false,
        instructions: ASSISTANT_INSTRUCTIONS,
        input: items,
        tools: ASSISTANT_TOOLS,
        tool_choice: publishedOverview ? 'none' : 'auto',
        parallel_tool_calls: true,
        reasoning: { effort: 'minimal' },
        max_output_tokens: maxOutputTokens
      });
    } catch (error) {
      if (error?.name === 'AbortError') return assistantError('Ask AEGIS took too long to respond.', 'assistant_timeout', 504);
      return assistantError('Ask AEGIS is temporarily unavailable.', 'assistant_upstream_error', 502);
    }
    let payload;
    try { payload = await upstream.json(); } catch { payload = null; }
    if (!upstream.ok) {
      const upstreamCode = String(payload?.error?.code || '');
      if (upstream.status === 429 && /insufficient_quota|billing_hard_limit_reached/.test(upstreamCode)) {
        return assistantError('Ask AEGIS has reached its current usage limit.', 'assistant_credits_exhausted', 503);
      }
      if (upstream.status === 429) return assistantError('Ask AEGIS is busy. Please try again shortly.', 'assistant_upstream_rate_limited', 429, { 'Retry-After': '30' });
      return assistantError('Ask AEGIS is temporarily unavailable.', 'assistant_upstream_error', 502);
    }
    if (!payload || !Array.isArray(payload.output)) return assistantError('Ask AEGIS returned an invalid response.', 'assistant_malformed_response', 502);
    const calls = payload.output.filter(item => item?.type === 'function_call');
    if (!calls.length) {
      const text = responseText(payload);
      if (!text && payload.status === 'incomplete' && payload.incomplete_details?.reason === 'max_output_tokens') {
        return assistantError('Ask AEGIS reached its response limit. Please try a narrower question.', 'assistant_output_limit', 422);
      }
      if (!text) return assistantError('Ask AEGIS returned an invalid response.', 'assistant_malformed_response', 502);
      return json({
        response: enforceAssistantGovernance(text, toolResults),
        tools_used: [...new Set(toolsUsed)],
        grounded: toolsUsed.length > 0,
        requires_scan: toolResults.some(result => result?.requires_scan === true)
      }, 200, assistantHeaders());
    }
    if (round === ASSISTANT_TOOL_ROUNDS || toolCalls + calls.length > ASSISTANT_TOOL_CALLS) {
      return assistantError('Ask AEGIS could not complete that request safely.', 'assistant_tool_limit', 422);
    }
    items.push(...payload.output);
    for (const call of calls) {
      let result;
      try {
        const args = parseToolArguments(call);
        result = await executeAssistantTool(call.name, args, env);
      } catch (error) {
        const code = error?.message === 'unknown_tool' ? 'assistant_unknown_tool' : 'assistant_invalid_tool_arguments';
        return assistantError('Ask AEGIS requested an invalid tool operation.', code, 422);
      }
      toolCalls++;
      toolsUsed.push(call.name);
      toolResults.push(result);
      items.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
  }
  return assistantError('Ask AEGIS could not complete that request safely.', 'assistant_tool_limit', 422);
}

function scanOrchestrationReady(env) {
  return envBoolean(env, 'AEGIS_SCAN_ORCHESTRATION_ENABLED', false)
    && Boolean(envText(env, 'AEGIS_GITHUB_ACTIONS_TOKEN'))
    && Boolean(envText(env, 'SUPABASE_URL') && supabaseHeaders(env));
}

async function dispatchScanWorkflow(env, jobId) {
  const token = envText(env, 'AEGIS_GITHUB_ACTIONS_TOKEN');
  const ref = envText(env, 'AEGIS_SCAN_WORKFLOW_REF', 'main');
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(ref) || ref.includes('..')) throw new Error('invalid_workflow_ref');
  const response = await fetch('https://api.github.com/repos/jacobemrich-eng/aegis-sports-command-center/actions/workflows/aegis-scan-job.yml/dispatches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref, inputs: { job_id: jobId } }),
    signal: AbortSignal.timeout(8000)
  });
  if (response.status !== 204) {
    // GitHub's status alone is ambiguous (a 403 can mean token scope, repository
    // access, organization policy, Actions being disabled, or rate limiting).
    // Read its response only to classify it; never persist or return raw upstream
    // text because it is external input and may contain sensitive details.
    const upstreamBody = await response.text().catch(() => '');
    const upstreamMessage = (() => {
      try { return String(JSON.parse(upstreamBody)?.message || '').toLowerCase(); }
      catch { return ''; }
    })();
    let detail = '';
    if (response.status === 403) {
      if (/rate limit|secondary rate limit/.test(upstreamMessage)) detail = '_rate_limited';
      else if (/resource not accessible by personal access token|must have.*actions.*write|fine.grained.*token/.test(upstreamMessage)) detail = '_token_access';
      else if (/actions.*disabled|disabled.*actions|workflow.*disabled/.test(upstreamMessage)) detail = '_actions_disabled';
      else if (/organization.*policy|policy.*organization|approved.*organization/.test(upstreamMessage)) detail = '_organization_policy';
      else detail = '_access_policy';
    }
    const category = response.status === 401 ? 'unauthorized'
      : response.status === 403 ? 'forbidden'
      : response.status === 404 ? 'not_found'
      : response.status === 422 ? 'invalid_request'
      : response.status >= 500 ? 'github_unavailable'
      : 'rejected';
    throw new Error(`workflow_dispatch_${category}${detail}_${response.status}`);
  }
}

function scanDispatchFailureMessage(code) {
  if (code === 'workflow_dispatch_unauthorized_401') return 'GitHub rejected the configured Actions token (401). Replace the Cloudflare Preview secret AEGIS_GITHUB_ACTIONS_TOKEN with a valid token that can access this repository.';
  if (code === 'workflow_dispatch_forbidden_token_access_403') return 'GitHub says this token cannot access the workflow. Check that the saved Cloudflare Preview token is the same token you updated and that it is authorized for jacobemrich-eng/aegis-sports-command-center.';
  if (code === 'workflow_dispatch_forbidden_actions_disabled_403') return 'GitHub says Actions or this workflow is disabled. Enable Actions for the repository and enable the aegis-scan-job workflow.';
  if (code === 'workflow_dispatch_forbidden_organization_policy_403') return 'GitHub organization policy is blocking this token. The organization owner must approve or allow this fine-grained token.';
  if (code === 'workflow_dispatch_forbidden_rate_limited_403') return 'GitHub rate-limited the workflow request. No scan ran; wait and try later.';
  if (code === 'workflow_dispatch_forbidden_access_policy_403' || code === 'workflow_dispatch_forbidden_403') return 'GitHub denied workflow dispatch (403). The token must be authorized for this repository with Actions: write, and GitHub organization policy must permit it.';
  if (code === 'workflow_dispatch_not_found_404') return 'GitHub could not find the scan workflow or repository (404). Verify the workflow exists on the default branch and the token can access this repository.';
  if (code === 'workflow_dispatch_invalid_request_422') return 'GitHub rejected the workflow ref or dispatch request (422). Verify AEGIS_SCAN_WORKFLOW_REF names an existing branch and the workflow accepts job_id.';
  if (code === 'workflow_dispatch_github_unavailable_5xx') return 'GitHub Actions is temporarily unavailable. No scan was run; try again later.';
  if (code === 'workflow_dispatch_network_error') return 'The worker could not reach GitHub Actions. No scan was run; check connectivity and retry later.';
  return 'GitHub rejected the workflow dispatch. No scan was run; check the configured repository, workflow ref, and Actions token permissions.';
}

async function createScanJob(request, env, session) {
  if (!sameOrigin(request)) return json({ error: 'Request origin rejected.', code: 'invalid_origin' }, 403, { 'Cache-Control': 'no-store' });
  if (!scanOrchestrationReady(env)) return json({ error: 'Canonical scan orchestration is not configured yet.', code: 'scan_orchestration_unavailable' }, 503, { 'Cache-Control': 'no-store' });
  if (!String(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'A JSON request body is required.', code: 'invalid_request' }, 415, { 'Cache-Control': 'no-store' });
  }
  const declaredBytes = Number(request.headers.get('Content-Length') || 0);
  if (declaredBytes > SCAN_BODY_BYTES) return json({ error: 'Request body is too large.', code: 'invalid_request' }, 413, { 'Cache-Control': 'no-store' });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > SCAN_BODY_BYTES) return json({ error: 'Request body is too large.', code: 'invalid_request' }, 413, { 'Cache-Control': 'no-store' });
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON request.', code: 'invalid_request' }, 400, { 'Cache-Control': 'no-store' }); }
  const sport = String(body?.sport || '').trim();
  const markets = String(body?.markets || '').trim();
  const allowedSports = new Set(csv(env, 'AEGIS_SCAN_ALLOWED_SPORTS', 'baseball_mlb,americanfootball_ncaaf'));
  if (Object.keys(body || {}).some(key => !['sport', 'markets'].includes(key)) || !allowedSports.has(sport) || !SCAN_MARKET_SETS.has(markets)) {
    return json({ error: 'This scan request is outside the approved canonical compute scope.', code: 'scan_request_not_allowed' }, 422, { 'Cache-Control': 'no-store' });
  }
  if (!safeEqual(request.headers.get('X-AEGIS-CSRF'), session.csrf_token)) {
    return json({ error: 'Request verification failed.', code: 'invalid_csrf' }, 403, { 'Cache-Control': 'no-store' });
  }
  const jobId = crypto.randomUUID();
  let created;
  try {
    created = await supabaseRequest(env, '/rest/v1/rpc/aegis_create_scan_job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_id: jobId, p_session_id_hash: session.sessionIdHash, p_sport: sport, p_markets: markets })
    });
  } catch (error) {
    console.error('scan_job_rpc_failed', {
      status: Number.isInteger(error?.status) ? error.status : null,
      code: typeof error?.code === 'string' ? error.code : ''
    });
    return json({ error: 'Canonical scan requests are temporarily unavailable.', code: 'scan_job_unavailable' }, 503, { 'Cache-Control': 'no-store' });
  }
  if (!Array.isArray(created) || !created.length) {
    return json({ error: 'Scan request limit reached. Please wait before starting another scan.', code: 'scan_rate_limited' }, 429, { 'Cache-Control': 'no-store', 'Retry-After': '900' });
  }
  if (created[0].job_id !== jobId || !created[0].expires_at) {
    return json({ error: 'Canonical scan requests are temporarily unavailable.', code: 'scan_job_unavailable' }, 503, { 'Cache-Control': 'no-store' });
  }
  let dispatchErrorCode = 'workflow_dispatch_failed';
  try {
    await dispatchScanWorkflow(env, jobId);
  } catch (error) {
    const message = typeof error?.message === 'string' ? error.message : '';
    dispatchErrorCode = /^workflow_dispatch_(?:unauthorized_401|forbidden_(?:token_access|actions_disabled|organization_policy|rate_limited|access_policy)_403|forbidden_403|not_found_404|invalid_request_422|github_unavailable_5xx)$/.test(message)
      ? message
      : 'workflow_dispatch_network_error';
    const query = new URLSearchParams({ id: `eq.${jobId}`, session_id_hash: `eq.${session.sessionIdHash}` });
    await supabaseRequest(env, `/rest/v1/aegis_scan_jobs?${query}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'failed', error_code: dispatchErrorCode, updated_at: new Date().toISOString() })
    }).catch(() => {});
    return json({ error: scanDispatchFailureMessage(dispatchErrorCode), code: dispatchErrorCode }, 503, { 'Cache-Control': 'no-store' });
  }
  return json({ job_id: jobId, status: 'queued', expires_at: created[0].expires_at }, 202, { 'Cache-Control': 'no-store' });
}

async function scanJobStatus(request, env, session, jobId) {
  if (!SCAN_JOB_ID.test(jobId)) return json({ error: 'Scan request not found.', code: 'scan_job_not_found' }, 404, { 'Cache-Control': 'no-store' });
  const query = new URLSearchParams({
    id: `eq.${jobId}`,
    session_id_hash: `eq.${session.sessionIdHash}`,
    expires_at: `gt.${new Date().toISOString()}`,
    select: 'id,status,result,error_code,created_at,updated_at,expires_at'
  });
  let rows;
  try { rows = await supabaseRequest(env, `/rest/v1/aegis_scan_jobs?${query}`, { headers: { Accept: 'application/json' } }); }
  catch { return json({ error: 'Scan status is temporarily unavailable.', code: 'scan_status_unavailable' }, 503, { 'Cache-Control': 'no-store' }); }
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return json({ error: 'Scan request not found.', code: 'scan_job_not_found' }, 404, { 'Cache-Control': 'no-store' });
  return json({ job_id: row.id, status: row.status, result: row.status === 'completed' ? row.result : undefined, error_code: row.status === 'failed' ? row.error_code : undefined, updated_at: row.updated_at, expires_at: row.expires_at }, 200, { 'Cache-Control': 'no-store' });
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
  if (pathname === '/api/assistant') {
    if (request.method !== 'POST') return assistantError('Method not allowed.', 'method_not_allowed', 405, { Allow: 'POST' });
    return assistant(request, env);
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
    scan_orchestration_enabled: envBoolean(env, 'AEGIS_SCAN_ORCHESTRATION_ENABLED', false),
    scan_dispatch_ready: scanOrchestrationReady(env),
    scan_allowed_sports: csv(env, 'AEGIS_SCAN_ALLOWED_SPORTS', 'baseball_mlb,americanfootball_ncaaf'),
      last_autopilot_success: auto.last_success_at,
      last_autopilot_error: auto.last_error,
      daily_odds_budget: auto.usage.daily_budget,
      monthly_odds_budget: auto.usage.monthly_budget,
      max_deep_market_credits: envNumber(env, 'MAX_DEEP_MARKET_CREDITS', 10),
      odds_cache_ttl_ms: envNumber(env, 'ODDS_CACHE_TTL_MS', 120000),
      release_sports: auto.release_sports
    }, 200, { 'Cache-Control': 'no-store' });
  }
  if (request.method === 'POST' && pathname === '/api/scan') {
    const session = await requireAdminMutation(request, env);
    if (session instanceof Response) return session;
    return createScanJob(request, env, session);
  }
  const scanJobPath = pathname.match(/^\/api\/scan-jobs\/([^/]+)$/);
  if (request.method === 'GET' && scanJobPath) {
    const session = await requireAdmin(request, env);
    if (session instanceof Response) return session;
    return scanJobStatus(request, env, session, scanJobPath[1]);
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
  LOGIN_WINDOW_SECONDS,
  ASSISTANT_BODY_BYTES,
  ASSISTANT_PROMPT_CHARS,
  ASSISTANT_HISTORY_ITEMS,
  ASSISTANT_TOOL_ROUNDS,
  ASSISTANT_TOOL_CALLS,
  SCAN_BODY_BYTES,
  SCAN_MARKET_SETS: [...SCAN_MARKET_SETS],
  ASSISTANT_TOOL_NAMES: ASSISTANT_TOOLS.map(tool => tool.name)
});
