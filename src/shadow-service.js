'use strict';

const store = require('./store');
const registry = require('./sport-engines/registry');
const { flags } = require('./sport-engines/feature-flags');
const { POSTGAME_AUDIT_LABELS, validateStandardOutput } = require('./sport-engines/contract');

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

async function ingest({ sport, engine_output: engineOutput, game, market, source = 'nfl-simulator' } = {}) {
  assertShadowEnabled(sport);
  const output = registry.adapt(sport, engineOutput, { game, market });
  const record = sanitizeRecord(output);

  const result = await store.mutate(async state => {
    state.shadow_engines = state.shadow_engines || { games: {}, audit: [] };
    state.shadow_engines.games = state.shadow_engines.games || {};
    state.shadow_engines.audit = Array.isArray(state.shadow_engines.audit) ? state.shadow_engines.audit : [];
    const games = state.shadow_engines.games[sport] || (state.shadow_engines.games[sport] = {});
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

module.exports = { SPORT_FLAGS, assertShadowEnabled, sanitizeRecord, ingest, list, audit };
