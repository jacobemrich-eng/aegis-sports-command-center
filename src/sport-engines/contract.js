'use strict';

const SCHEMA_VERSION = 'AEGIS_STANDARD_GAME_OUTPUT_v1';
const DECISION_STATUSES = new Set(['CORE_CANDIDATE', 'SECONDARY', 'PASS']);
const EXECUTION_STATUSES = new Set(['BET_NOW', 'WAIT', 'PASS']);
const POSTGAME_AUDIT_LABELS = Object.freeze([
  'clean thesis win',
  'fragile / variance-assisted win',
  'market-selection win',
  'execution/price win',
  'near-threshold variance loss',
  'market-selection loss',
  'model/thesis miss',
  'personnel/regime miss',
  'data-quality miss'
]);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function normalizeStandardOutput(input) {
  const row = object(input);
  const game = object(row.game);
  const projection = object(row.projection);
  const score = object(projection.projected_score);
  const quality = object(row.quality);
  const market = object(row.market);
  const decision = object(row.decision);
  const diagnostics = object(row.diagnostics);
  const governance = object(row.governance);

  return {
    schema_version: SCHEMA_VERSION,
    sport: stringOrNull(row.sport),
    engine_version: stringOrNull(row.engine_version),
    game_id: stringOrNull(row.game_id || game.id),
    home_team: stringOrNull(row.home_team || game.home_team || game.home),
    away_team: stringOrNull(row.away_team || game.away_team || game.away),
    start_time: stringOrNull(row.start_time || game.start_time || game.commence_time),
    projection: {
      projected_score: {
        home: finiteOrNull(score.home),
        away: finiteOrNull(score.away)
      },
      margin: finiteOrNull(projection.margin),
      total: finiteOrNull(projection.total),
      moneyline_probabilities: object(projection.moneyline_probabilities),
      spread_probabilities: object(projection.spread_probabilities),
      total_probabilities: object(projection.total_probabilities),
      team_total_probabilities: object(projection.team_total_probabilities),
      period_probabilities: object(projection.period_probabilities),
      percentiles: object(projection.percentiles)
    },
    quality: {
      data_quality_score: finiteOrNull(quality.data_quality_score),
      data_quality_grade: stringOrNull(quality.data_quality_grade),
      uncertainty: finiteOrNull(quality.uncertainty),
      model_dispersion: finiteOrNull(quality.model_dispersion),
      ensemble_agreement: stringOrNull(quality.ensemble_agreement)
    },
    market: {
      current_price: object(market.current_price),
      challenger_projection: object(market.challenger_projection),
      implied_probability: finiteOrNull(market.implied_probability),
      fair_probability: finiteOrNull(market.fair_probability),
      ev: finiteOrNull(market.ev),
      play_to: market.play_to == null ? null : market.play_to,
      line_sensitivity: market.line_sensitivity == null ? null : market.line_sensitivity
    },
    decision: {
      best_market_expression: decision.best_market_expression == null ? null : decision.best_market_expression,
      status: stringOrNull(decision.status) || 'PASS',
      execution_status: stringOrNull(decision.execution_status) || 'PASS'
    },
    diagnostics: {
      why_it_wins: Array.isArray(diagnostics.why_it_wins) ? diagnostics.why_it_wins : [],
      how_it_loses: Array.isArray(diagnostics.how_it_loses) ? diagnostics.how_it_loses : [],
      tail_risks: Array.isArray(diagnostics.tail_risks) ? diagnostics.tail_risks : [],
      matchup_drivers: Array.isArray(diagnostics.matchup_drivers) ? diagnostics.matchup_drivers : [],
      sport_specific: object(diagnostics.sport_specific)
    },
    governance: {
      ...governance,
      release_authority: 'SHADOW_ONLY',
      official_final_card_eligible: false,
      official_bankroll_eligible: false,
      auto_release_allowed: false
    }
  };
}

function validateStandardOutput(input, expectedSport) {
  const row = normalizeStandardOutput(input);
  const errors = [];
  if (input?.schema_version && input.schema_version !== SCHEMA_VERSION) errors.push('unsupported_schema_version');
  if (!row.sport) errors.push('sport_required');
  if (expectedSport && row.sport !== expectedSport) errors.push(`sport_mismatch:${expectedSport}`);
  if (!row.engine_version) errors.push('engine_version_required');
  if (!row.game_id) errors.push('game_id_required');
  if (!row.home_team) errors.push('home_team_required');
  if (!row.away_team) errors.push('away_team_required');
  if (!DECISION_STATUSES.has(row.decision.status)) errors.push('invalid_decision_status');
  if (!EXECUTION_STATUSES.has(row.decision.execution_status)) errors.push('invalid_execution_status');
  if (row.governance.official_final_card_eligible !== false) errors.push('shadow_final_card_guard_required');
  if (row.governance.official_bankroll_eligible !== false) errors.push('shadow_bankroll_guard_required');
  return { ok: errors.length === 0, errors, value: row };
}

module.exports = {
  SCHEMA_VERSION,
  DECISION_STATUSES,
  EXECUTION_STATUSES,
  POSTGAME_AUDIT_LABELS,
  finiteOrNull,
  normalizeStandardOutput,
  validateStandardOutput
};
