'use strict';

const store = require('./store');
const registry = require('./sport-engines/registry');
const { flags } = require('./sport-engines/feature-flags');
const { POSTGAME_AUDIT_LABELS, validateStandardOutput } = require('./sport-engines/contract');
const grading = require('./shadow-grading');
const nflAdapter = require('./sport-engines/adapters/nfl-adapter');
const { canonicalJson, sha256 } = require('./shadow-integrity');

const NFL_CHAMPION = 'NFL_v1.0_FEATURE_ABLATION';

const SPORT_FLAGS = Object.freeze({
  americanfootball_nfl: ['NFL_SIM_ENABLED', 'NFL_SIM_SHADOW_ONLY'],
  americanfootball_ncaaf: ['NCAAF_SIM_ENABLED', 'NCAAF_SIM_SHADOW_ONLY'],
  baseball_mlb: ['MLB_SIM_ENABLED', 'MLB_SIM_SHADOW_ONLY']
});

function assertShadowEnabled(sport) {
  const names = SPORT_FLAGS[sport];
  if (!names) throw new Error(`Unsupported shadow sport: ${sport}`);
  const current = flags();
  if (!current[names[0]]) throw new Error(`${names[0]} is disabled`);
  if (!current[names[1]]) throw new Error(`${names[1]} must remain true for challenger ingestion`);
  if (current.AEGIS_NEW_ENGINE_AUTO_RELEASE) {
    throw new Error('AEGIS_NEW_ENGINE_AUTO_RELEASE is not permitted by the shadow service');
  }
  return current;
}

function sanitizeRecord(output, recordedAt = new Date().toISOString()) {
  const checked = validateStandardOutput(output, output.sport);
  if (!checked.ok) throw new Error(`Shadow schema validation failed: ${checked.errors.join(', ')}`);
  return {
    ...checked.value,
    recorded_at: recordedAt,
    shadow: true,
    release_status: 'SHADOW_ONLY',
    official_final_card_eligible: false,
    official_bankroll_eligible: false
  };
}

function prepareBlindArchive({ sport, engine_output: engineOutput, blind_json: blindJson, original_file_sha256: originalFileSha256 } = {}) {
  if (sport !== grading.NFL) throw new Error('Durable blind archive currently accepts NFL only');
  let parsed = engineOutput;
  if (blindJson != null) {
    if (typeof blindJson !== 'string' || !blindJson.trim()) throw new Error('blind_json must be a non-empty JSON string');
    parsed = JSON.parse(blindJson);
    if (engineOutput && canonicalJson(engineOutput) !== canonicalJson(parsed)) throw new Error('blind_json does not match engine_output');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('NFL engine output is required for blind archive');
  nflAdapter.assertBlindIntegrity(parsed);
  nflAdapter.assertBlindPayloadSeparation(parsed);
  if (!['nfl', grading.NFL].includes(String(parsed.sport || '').toLowerCase())) throw new Error('Blind archive must declare NFL');
  if (parsed.engine_version !== NFL_CHAMPION) throw new Error(`Blind archive requires current Champion ${NFL_CHAMPION}`);
  const gameId = String(parsed.game?.id || parsed.game_id || '').trim();
  if (!gameId) throw new Error('Blind archive requires game_id');
  const generatedAt = new Date(parsed.generated_at || '');
  if (!Number.isFinite(generatedAt.getTime())) throw new Error('Blind archive requires valid generated_at');
  const canonical = canonicalJson(parsed);
  const originalJson = blindJson == null ? canonical : blindJson;
  const originalHash = sha256(originalJson);
  if (originalFileSha256 && String(originalFileSha256).toLowerCase() !== originalHash) throw new Error('Original blind file SHA-256 mismatch');
  return {
    game_id: gameId,
    generated_at: generatedAt.toISOString(),
    engine_version: parsed.engine_version,
    canonical_sha256: sha256(canonical),
    original_file_sha256: originalHash,
    canonical_json: canonical,
    original_json: originalJson,
    engine_output: parsed,
    archived_at: new Date().toISOString(),
    release_status: 'SHADOW_ONLY',
    shadow_only: true
  };
}

function archiveIntoState(state, sport, candidate) {
  state.shadow_engines = state.shadow_engines || { games: {}, blind_snapshots: {}, audit: [], errors: [] };
  state.shadow_engines.blind_snapshots = state.shadow_engines.blind_snapshots || {};
  const archives = state.shadow_engines.blind_snapshots[sport] || (state.shadow_engines.blind_snapshots[sport] = {});
  const persisted = state.shadow_engines.games?.[sport]?.[candidate.game_id];
  const persistedAt = persisted?.governance?.pipeline_timestamps?.blind_generated_at;
  if (persistedAt && new Date(persistedAt).toISOString() !== candidate.generated_at) {
    throw new Error('Existing NFL blind projection is immutable: archive generated_at does not match persisted shadow game');
  }
  const existing = archives[candidate.game_id];
  if (existing) {
    if (existing.generated_at !== candidate.generated_at) throw new Error('Archived blind generated_at is immutable');
    if (existing.canonical_sha256 !== candidate.canonical_sha256) throw new Error('Archived blind content is immutable');
    return { archived: false, duplicate: true, archive: existing };
  }
  archives[candidate.game_id] = candidate;
  state.shadow_engines.audit = Array.isArray(state.shadow_engines.audit) ? state.shadow_engines.audit : [];
  state.shadow_engines.audit.push({
    recorded_at: candidate.archived_at, sport, game_id: candidate.game_id,
    event: 'SHADOW_BLIND_ARCHIVED', canonical_sha256: candidate.canonical_sha256,
    release_status: 'SHADOW_ONLY', official_bankroll_eligible: false
  });
  return { archived: true, duplicate: false, archive: candidate };
}

async function archiveBlind(input = {}) {
  const sport = input.sport || grading.NFL;
  assertShadowEnabled(sport);
  const candidate = prepareBlindArchive({ ...input, sport });
  const result = await store.mutate(async state => archiveIntoState(state, sport, candidate));
  return { ...result.result, persistent: store.persistent, shadow_only: true };
}

async function archiveMany({ sport = grading.NFL, archives = [] } = {}) {
  assertShadowEnabled(sport);
  if (!Array.isArray(archives) || !archives.length) throw new Error('Blind backfill requires a non-empty archives array');
  if (archives.length > 64) throw new Error('Blind backfill is limited to 64 snapshots');
  const candidates = archives.map(row => prepareBlindArchive({ ...row, sport }));
  const result = await store.mutate(async state => ({
    results: candidates.map(candidate => archiveIntoState(state, sport, candidate))
  }));
  return { ...result.result, persistent: store.persistent, shadow_only: true };
}

async function listBlinds({ sport = grading.NFL, game_id: gameId } = {}) {
  const state = await store.load();
  let archives = Object.values(state.shadow_engines?.blind_snapshots?.[sport] || {});
  if (gameId) archives = archives.filter(row => row.game_id === gameId);
  archives.sort((a, b) => String(a.generated_at).localeCompare(String(b.generated_at)));
  return { sport, shadow_only: true, current_champion: NFL_CHAMPION, count: archives.length, archives };
}

async function ingest({ sport, engine_output: engineOutput, game, market, publisher, blind_archive: blindArchiveInput, source = 'nfl-simulator' } = {}) {
  assertShadowEnabled(sport);
  const blindArchive = prepareBlindArchive({
    sport, engine_output: engineOutput,
    blind_json: blindArchiveInput?.original_json,
    original_file_sha256: blindArchiveInput?.original_file_sha256
  });
  const output = registry.adapt(sport, engineOutput, { game, market, publisher });
  const record = sanitizeRecord(output);

  const result = await store.mutate(async state => {
    state.shadow_engines = state.shadow_engines || { games: {}, blind_snapshots: {}, audit: [] };
    archiveIntoState(state, sport, blindArchive);
    state.shadow_engines.games = state.shadow_engines.games || {};
    state.shadow_engines.audit = Array.isArray(state.shadow_engines.audit) ? state.shadow_engines.audit : [];
    const games = state.shadow_engines.games[sport] || (state.shadow_engines.games[sport] = {});
    const existing = games[record.game_id];
    const blindAt = record.governance?.pipeline_timestamps?.blind_generated_at;
    const marketAt = record.governance?.pipeline_timestamps?.market_captured_at;
    if (existing) {
      const existingBlindAt = existing.governance?.pipeline_timestamps?.blind_generated_at;
      const existingMarketAt = existing.governance?.pipeline_timestamps?.market_captured_at;
      if (blindAt !== existingBlindAt) throw new Error('Existing NFL blind projection is immutable; reuse it for later market snapshots');
      if (Date.parse(marketAt || '') < Date.parse(existingMarketAt || '')) throw new Error('NFL market snapshots must be chronological');
      if (marketAt === existingMarketAt) return { saved: false, duplicate: true, persistent: store.persistent, record: existing };
    }
    const snapshot = {
      captured_at: marketAt,
      challenger_projection: record.market?.challenger_projection || {},
      current_price: record.market?.current_price || {},
      post_model_projection: record.market?.post_model_projection || {}
    };
    record.market_snapshots = [...(existing?.market_snapshots || []), snapshot].slice(-80);
    if (existing?.shadow_grade) record.shadow_grade = existing.shadow_grade;
    games[record.game_id] = record;
    state.shadow_engines.audit.push({
      recorded_at: record.recorded_at,
      sport,
      game_id: record.game_id,
      engine_version: record.engine_version,
      decision_status: record.decision.status,
      execution_status: record.decision.execution_status,
      release_status: 'SHADOW_ONLY',
      source,
      official_bankroll_eligible: false
    });
    state.shadow_engines.audit = state.shadow_engines.audit.slice(-2500);
    return { saved: true, persistent: store.persistent, record };
  });
  return result.result;
}

async function recordError({ sport, stage, game_id: gameId = null, error, occurred_at: occurredAt, source = 'nfl-shadow-automation' } = {}) {
  assertShadowEnabled(sport);
  const row = {
    occurred_at: occurredAt || new Date().toISOString(),
    sport,
    stage: String(stage || 'unknown').slice(0, 80),
    game_id: gameId == null ? null : String(gameId).slice(0, 160),
    error: String(error || 'Unknown shadow error').slice(0, 500),
    source: String(source).slice(0, 120),
    shadow_only: true,
    production_affected: false
  };
  const result = await store.mutate(async state => {
    state.shadow_engines.errors = Array.isArray(state.shadow_engines?.errors) ? state.shadow_engines.errors : [];
    state.shadow_engines.errors.push(row);
    state.shadow_engines.errors = state.shadow_engines.errors.slice(-1000);
    return { saved: true, persistent: store.persistent, error: row };
  });
  return result.result;
}

async function gradeMany({ sport, results = [], source = 'nfl-shadow-grader' } = {}) {
  assertShadowEnabled(sport);
  if (sport !== grading.NFL) throw new Error('Only NFL shadow grading is implemented');
  if (!Array.isArray(results)) throw new Error('Shadow grading results must be an array');
  const result = await store.mutate(async state => {
    const games = state.shadow_engines?.games?.[sport] || {};
    const graded = [], failures = [], skipped = [];
    for (const supplied of results) {
      const gameId = String(supplied?.game_id || '');
      try {
        if (!gameId) throw new Error('Shadow grading result requires game_id');
        if (!games[gameId]) { skipped.push({ game_id: gameId, reason: 'NO_SHADOW_RECORD' }); continue; }
        const grade = grading.gradeNFL(games[gameId], { ...supplied, source: supplied.source || source });
        games[gameId].shadow_grade = grade;
        graded.push({ game_id: gameId, grade });
        state.shadow_engines.audit.push({
          recorded_at: grade.graded_at, sport, game_id: gameId, event: 'SHADOW_GRADED',
          classification: grade.aegis_postgame_classification, release_status: 'SHADOW_ONLY', official_bankroll_eligible: false
        });
      } catch (error) {
        failures.push({ game_id: gameId || null, error: error.message });
        state.shadow_engines.errors = Array.isArray(state.shadow_engines.errors) ? state.shadow_engines.errors : [];
        state.shadow_engines.errors.push({
          occurred_at: new Date().toISOString(), sport, stage: 'shadow_grade', game_id: gameId || null,
          error: String(error.message || error).slice(0, 500), source, shadow_only: true, production_affected: false
        });
      }
    }
    return { graded, skipped, failures, persistent: store.persistent, shadow_only: true };
  });
  return result.result;
}

async function list({ sport, game_id: gameId } = {}) {
  const state = await store.load();
  const bySport = state.shadow_engines?.games || {};
  let games = sport ? Object.values(bySport[sport] || {}) : Object.values(bySport).flatMap(Object.values);
  if (gameId) games = games.filter(game => game.game_id === gameId);
  games.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
  return {
    schema_version: 'AEGIS_STANDARD_GAME_OUTPUT_v1',
    shadow_only: true,
    flags: flags(),
    registrations: registry.registrations(),
    postgame_audit_labels: POSTGAME_AUDIT_LABELS,
    games
  };
}

async function audit({ sport } = {}) {
  const state = await store.load();
  const rows = state.shadow_engines?.audit || [];
  return sport ? rows.filter(row => row.sport === sport) : rows;
}

async function scoreboard({ sport = grading.NFL } = {}) {
  const state = await store.load();
  const games = Object.values(state.shadow_engines?.games?.[sport] || {});
  const errors = (state.shadow_engines?.errors || []).filter(row => row.sport === sport);
  return grading.summarize(games, errors);
}

module.exports = { SPORT_FLAGS, NFL_CHAMPION, assertShadowEnabled, sanitizeRecord, prepareBlindArchive, archiveIntoState, archiveBlind, archiveMany, listBlinds, ingest, recordError, gradeMany, list, audit, scoreboard };
