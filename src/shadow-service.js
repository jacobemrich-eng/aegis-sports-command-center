'use strict';

const store = require('./store');
const registry = require('./sport-engines/registry');
const { flags } = require('./sport-engines/feature-flags');
const { POSTGAME_AUDIT_LABELS, validateStandardOutput } = require('./sport-engines/contract');
const grading = require('./shadow-grading');
const nflAdapter = require('./sport-engines/adapters/nfl-adapter');
const ncaafAdapter = require('./sport-engines/adapters/ncaaf-adapter');
const { canonicalJson, sha256 } = require('./shadow-integrity');

const NFL_CHAMPION = 'NFL_v1.0_FEATURE_ABLATION';
const SPORT_CONFIG = Object.freeze({
  [grading.NFL]: { champion: NFL_CHAMPION, adapter: nflAdapter, label: 'NFL' },
  [grading.NCAAF]: { champion: ncaafAdapter.INTERNAL_CHAMPION, adapter: ncaafAdapter, label: 'NCAAF' }
});

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
  const config = SPORT_CONFIG[sport];
  if (!config) throw new Error('Durable blind archive currently accepts football shadow engines only');
  let parsed = engineOutput;
  if (blindJson != null) {
    if (typeof blindJson !== 'string' || !blindJson.trim()) throw new Error('blind_json must be a non-empty JSON string');
    parsed = JSON.parse(blindJson);
    if (engineOutput && canonicalJson(engineOutput) !== canonicalJson(parsed)) throw new Error('blind_json does not match engine_output');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${config.label} engine output is required for blind archive`);
  config.adapter.assertBlindIntegrity(parsed);
  if (typeof config.adapter.assertBlindPayloadSeparation === 'function') config.adapter.assertBlindPayloadSeparation(parsed);
  const declarations = sport === grading.NFL ? ['nfl', grading.NFL] : ['ncaaf', grading.NCAAF];
  if (!declarations.includes(String(parsed.sport || '').toLowerCase())) throw new Error(`Blind archive must declare ${config.label}`);
  if (parsed.engine_version !== config.champion) throw new Error(`Blind archive requires current Champion ${config.champion}`);
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
    throw new Error(`Existing ${SPORT_CONFIG[sport]?.label || sport} blind projection is immutable: archive generated_at does not match persisted shadow game`);
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

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function jsonValue(value, fallback = null) {
  if (value == null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function marketSnapshot(record) {
  const price = record.market?.current_price || {};
  const disagreement = record.governance?.disagreement_firewall || {};
  const row = {
    captured_at: record.governance?.pipeline_timestamps?.market_captured_at,
    snapshot_target: record.market?.snapshot_target || null,
    consensus_spread: numberOrNull(price.spread?.home?.point ?? price.home_spread ?? price.spread),
    consensus_total: numberOrNull(price.total?.point ?? price.total_line ?? price.total),
    selected_book_prices: jsonValue(price, {}),
    bookmaker_count: numberOrNull(price.bookmaker_count),
    challenger_margin: numberOrNull(record.market?.challenger_projection?.margin),
    challenger_total: numberOrNull(record.market?.challenger_projection?.total),
    calibrated_margin: numberOrNull(record.market?.post_model_projection?.margin),
    calibrated_total: numberOrNull(record.market?.post_model_projection?.total),
    disagreement_points: numberOrNull(disagreement.disagreement_points),
    firewall_status: disagreement.status || 'UNKNOWN',
    best_market_expression: jsonValue(record.decision?.best_market_expression),
    execution_status: record.decision?.execution_status || 'PASS',
    quota: jsonValue(record.market?.quota)
  };
  row.snapshot_sha256 = sha256(canonicalJson(row));
  return row;
}

function marketMovement(snapshots = []) {
  if (!snapshots.length) return null;
  const first = snapshots[0], current = snapshots[snapshots.length - 1];
  const disagreements = snapshots.map(row => numberOrNull(row.disagreement_points)).filter(value => value != null);
  const firewallStates = snapshots.map(row => row.firewall_status || 'UNKNOWN');
  const firstDisagreement = disagreements.length ? disagreements[0] : null;
  const currentDisagreement = disagreements.length ? disagreements[disagreements.length - 1] : null;
  const disagreementMovement = firstDisagreement == null || currentDisagreement == null ? null : currentDisagreement - firstDisagreement;
  return {
    snapshot_count: snapshots.length,
    first_captured_at: first.captured_at,
    current_captured_at: current.captured_at,
    first_spread: numberOrNull(first.consensus_spread),
    current_spread: numberOrNull(current.consensus_spread),
    spread_movement: numberOrNull(first.consensus_spread) == null || numberOrNull(current.consensus_spread) == null ? null : current.consensus_spread - first.consensus_spread,
    first_total: numberOrNull(first.consensus_total),
    current_total: numberOrNull(current.consensus_total),
    total_movement: numberOrNull(first.consensus_total) == null || numberOrNull(current.consensus_total) == null ? null : current.consensus_total - first.consensus_total,
    first_disagreement: firstDisagreement,
    current_disagreement: currentDisagreement,
    maximum_disagreement: disagreements.length ? Math.max(...disagreements) : null,
    minimum_disagreement: disagreements.length ? Math.min(...disagreements) : null,
    disagreement_movement: disagreementMovement,
    disagreement_direction: disagreementMovement == null || disagreementMovement === 0 ? 'UNCHANGED' : disagreementMovement < 0 ? 'COMPRESSION' : 'EXPANSION',
    model_vs_market_convergence: disagreementMovement == null ? null : disagreementMovement < 0,
    model_vs_market_divergence: disagreementMovement == null ? null : disagreementMovement > 0,
    firewall_state_changes: firewallStates.slice(1).reduce((count, value, index) => count + (value !== firewallStates[index] ? 1 : 0), 0),
    firewall_states: firewallStates
  };
}

function normalizeLegacySnapshot(snapshot, existing) {
  if (!snapshot || snapshot.snapshot_sha256) return snapshot;
  const price = snapshot.current_price || {};
  const challenger = snapshot.challenger_projection || {};
  const margin = numberOrNull(existing?.projection?.margin), total = numberOrNull(existing?.projection?.total);
  const marginDisagreement = margin == null || numberOrNull(challenger.margin) == null ? null : Math.abs(margin - Number(challenger.margin));
  const totalDisagreement = total == null || numberOrNull(challenger.total) == null ? null : Math.abs(total - Number(challenger.total));
  const disagreementPoints = Math.max(marginDisagreement ?? 0, totalDisagreement ?? 0);
  const firewallStatus = disagreementPoints >= 7 ? 'PASS' : disagreementPoints >= 5 ? 'SECONDARY_MAX' : disagreementPoints >= 3 ? 'CORE_BLOCK' : 'NORMAL';
  const row = {
    captured_at: snapshot.captured_at,
    snapshot_target: snapshot.snapshot_target || null,
    consensus_spread: numberOrNull(price.spread?.home?.point ?? price.home_spread ?? price.spread),
    consensus_total: numberOrNull(price.total?.point ?? price.total_line ?? price.total),
    selected_book_prices: jsonValue(price, {}),
    bookmaker_count: numberOrNull(price.bookmaker_count),
    challenger_margin: numberOrNull(challenger.margin), challenger_total: numberOrNull(challenger.total),
    calibrated_margin: numberOrNull(snapshot.post_model_projection?.margin), calibrated_total: numberOrNull(snapshot.post_model_projection?.total),
    disagreement_points: disagreementPoints,
    firewall_status: firewallStatus,
    best_market_expression: null, execution_status: 'PASS', quota: null
  };
  row.snapshot_sha256 = sha256(canonicalJson(row));
  return row;
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
  return { sport, shadow_only: true, current_champion: SPORT_CONFIG[sport]?.champion || null, count: archives.length, archives };
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
      if (blindAt !== existingBlindAt) throw new Error('Existing blind projection is immutable; reuse it for later market snapshots');
      if (Date.parse(marketAt || '') < Date.parse(existingMarketAt || '')) throw new Error('Shadow market snapshots must be chronological');
    }
    const snapshot = marketSnapshot(record);
    if (existing && marketAt === existing.governance?.pipeline_timestamps?.market_captured_at) {
      const latest = existing.market_snapshots?.[existing.market_snapshots.length - 1];
      if (latest?.snapshot_sha256 === snapshot.snapshot_sha256) return { saved: false, duplicate: true, persistent: store.persistent, record: existing };
      const legacySame = latest && !latest.snapshot_sha256
        && canonicalJson(latest.challenger_projection || {}) === canonicalJson(record.market?.challenger_projection || {})
        && canonicalJson(latest.current_price || {}) === canonicalJson(record.market?.current_price || {})
        && canonicalJson(latest.post_model_projection || {}) === canonicalJson(record.market?.post_model_projection || {});
      if (legacySame) return { saved: false, duplicate: true, persistent: store.persistent, record: existing };
      throw new Error('Shadow market snapshot timestamp already exists with different content');
    }
    const history = (existing?.market_snapshots || []).map(row => normalizeLegacySnapshot(row, existing));
    record.market_snapshots = [...history, snapshot].slice(-80);
    record.market_movement = marketMovement(record.market_snapshots);
    if (existing?.shadow_grade) record.shadow_grade = existing.shadow_grade;
    if (existing?.shadow_grade_history) record.shadow_grade_history = existing.shadow_grade_history;
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
  if (![grading.NFL, grading.NCAAF].includes(sport)) throw new Error('Only football shadow grading is implemented');
  if (!Array.isArray(results)) throw new Error('Shadow grading results must be an array');
  const result = await store.mutate(async state => {
    const games = state.shadow_engines?.games?.[sport] || {};
    const graded = [], failures = [], skipped = [];
    for (const supplied of results) {
      const gameId = String(supplied?.game_id || '');
      try {
        if (!gameId) throw new Error('Shadow grading result requires game_id');
        if (!games[gameId]) { skipped.push({ game_id: gameId, reason: 'NO_SHADOW_RECORD' }); continue; }
        const normalized = { ...supplied, source: supplied.source || source };
        const resultFingerprint = grading.resultFingerprint(normalized);
        const prior = games[gameId].shadow_grade;
        if (prior?.result_fingerprint === resultFingerprint) {
          skipped.push({ game_id: gameId, reason: 'ALREADY_GRADED' });
          continue;
        }
        const grade = sport === grading.NCAAF ? grading.gradeNCAAF(games[gameId], normalized) : grading.gradeNFL(games[gameId], normalized);
        grade.result_fingerprint = resultFingerprint;
        grade.grade_revision = prior ? Number(prior.grade_revision || 1) + 1 : 1;
        if (prior) {
          grade.supersedes_result_fingerprint = prior.result_fingerprint || null;
          games[gameId].shadow_grade_history = [...(games[gameId].shadow_grade_history || []), prior].slice(-20);
        }
        games[gameId].shadow_grade = grade;
        graded.push({ game_id: gameId, grade, revised: !!prior });
        state.shadow_engines.audit.push({
          recorded_at: grade.graded_at, sport, game_id: gameId, event: prior ? 'SHADOW_GRADE_REVISED' : 'SHADOW_GRADED',
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
  return grading.summarize(games, errors, sport);
}

async function schedulerState({ sport = grading.NFL } = {}) {
  const state = await store.load();
  const archives = state.shadow_engines?.blind_snapshots?.[sport] || {};
  const games = Object.values(state.shadow_engines?.games?.[sport] || {}).map(game => ({
    game_id: game.game_id,
    start_time: game.start_time,
    blind_archived: !!archives[game.game_id],
    blind_generated_at: game.governance?.pipeline_timestamps?.blind_generated_at || null,
    market_snapshots: (game.market_snapshots || []).map(row => ({ captured_at: row.captured_at, snapshot_target: row.snapshot_target || null })),
    graded: !!game.shadow_grade,
    completed_at: game.shadow_grade?.completed_at || null
  }));
  return { sport, shadow_only: true, current_champion: SPORT_CONFIG[sport]?.champion || null, games };
}

module.exports = { SPORT_FLAGS, SPORT_CONFIG, NFL_CHAMPION, assertShadowEnabled, sanitizeRecord, prepareBlindArchive, archiveIntoState, archiveBlind, archiveMany, listBlinds, marketSnapshot, marketMovement, ingest, recordError, gradeMany, list, audit, scoreboard, schedulerState };
