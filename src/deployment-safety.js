'use strict';

const STAGING_ENVIRONMENT = 'nfl-shadow-staging';
const PRODUCTION_STATE_ID = 'main';
const REAL_RELEASE_SPORTS = new Set(['baseball_mlb', 'americanfootball_ncaaf', 'americanfootball_nfl']);

function text(env, name, fallback = '') {
  return String(env?.[name] ?? fallback).trim();
}

function enabled(env, name, fallback) {
  const value = text(env, name, fallback ? 'true' : 'false').toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

function sports(env, name) {
  return text(env, name).split(',').map(value => value.trim()).filter(Boolean);
}

function identity(env = process.env) {
  const environment = text(env, 'AEGIS_DEPLOYMENT_ENV', text(env, 'NODE_ENV', 'development'));
  const stateId = text(env, 'AEGIS_STATE_ID', PRODUCTION_STATE_ID) || PRODUCTION_STATE_ID;
  const releaseSports = sports(env, 'AEGIS_RELEASE_SPORTS');
  const staging = environment === STAGING_ENVIRONMENT;
  return {
    environment,
    state_id: stateId,
    nfl_shadow_staging: staging,
    shadow_only: staging,
    production_release_allowed: !staging,
    autopilot_enabled: enabled(env, 'AEGIS_AUTOPILOT_ENABLED', true),
    auto_release_enabled: enabled(env, 'AEGIS_NEW_ENGINE_AUTO_RELEASE', false),
    nfl_sim_enabled: enabled(env, 'NFL_SIM_ENABLED', true),
    nfl_shadow_only: enabled(env, 'NFL_SIM_SHADOW_ONLY', true),
    release_sports: releaseSports
  };
}

function stagingViolations(env = process.env) {
  const row = identity(env);
  if (!row.nfl_shadow_staging) return [];
  const violations = [];
  if (row.state_id !== STAGING_ENVIRONMENT) violations.push(`AEGIS_STATE_ID must be ${STAGING_ENVIRONMENT}`);
  if (row.autopilot_enabled) violations.push('AEGIS_AUTOPILOT_ENABLED must be false');
  if (row.auto_release_enabled) violations.push('AEGIS_NEW_ENGINE_AUTO_RELEASE must be false');
  if (!row.nfl_sim_enabled) violations.push('NFL_SIM_ENABLED must be true');
  if (!row.nfl_shadow_only) violations.push('NFL_SIM_SHADOW_ONLY must be true');
  const active = row.release_sports.filter(sport => REAL_RELEASE_SPORTS.has(sport));
  if (active.length) violations.push(`AEGIS_RELEASE_SPORTS contains live sport(s): ${active.join(',')}`);
  return violations;
}

function assertStagingConfiguration(env = process.env) {
  const violations = stagingViolations(env);
  if (violations.length) throw new Error(`Unsafe NFL shadow staging configuration: ${violations.join('; ')}`);
  return identity(env);
}

module.exports = {
  STAGING_ENVIRONMENT,
  PRODUCTION_STATE_ID,
  REAL_RELEASE_SPORTS,
  identity,
  stagingViolations,
  assertStagingConfiguration
};
