'use strict';

const { finiteOrNull, normalizeStandardOutput, validateStandardOutput } = require('../contract');
const marketChallenger = require('../nfl-market-challenger');

const SPORT_KEY = 'americanfootball_nfl';
const FORBIDDEN_BLIND_FEATURES = [
  /(^|_)(sportsbook|market|closing|close)(_|$)/i,
  /(^|_)(spread_line|total_line|book_odds|american_odds|decimal_odds|market_price|closing_line)(_|$)/i,
  /(^|_)(final|postgame|overtime|ot_result)(_|$)/i,
  /(^|_)(game_id|provider_id|numeric_id)(_|$)/i,
  /future.*injur/i
];
const FORBIDDEN_BLIND_KEYS = new Set([
  'sportsbook_spread', 'sportsbook_total', 'sportsbook_odds', 'spread_line', 'total_line',
  'closing_line', 'market_price', 'final_score', 'home_score', 'away_score', 'result',
  'postgame_overtime', 'future_injury_status', 'provider_id', 'numeric_id'
]);

function blindFeatureNames(raw) {
  const source = raw?.blind_features || raw?.diagnostics?.blind_features || raw?.metadata?.blind_features || [];
  if (Array.isArray(source)) return source.map(String);
  if (source && typeof source === 'object') return Object.keys(source);
  return [];
}

function assertBlindIntegrity(raw) {
  const rejected = blindFeatureNames(raw).filter(name => FORBIDDEN_BLIND_FEATURES.some(pattern => pattern.test(name)));
  if (rejected.length) {
    const error = new Error(`NFL blind feature hygiene failed: ${rejected.join(', ')}`);
    error.code = 'NFL_BLIND_FEATURE_HYGIENE';
    error.rejected_features = rejected;
    throw error;
  }
}

function assertBlindPayloadSeparation(raw) {
  const violations = [];
  if (raw.market != null) violations.push('market');
  if (raw.market_expressions != null) violations.push('market_expressions');
  if (raw.decision?.primary != null) violations.push('decision.primary');
  if (raw.decision?.best_market_expression != null) violations.push('decision.best_market_expression');
  function inspect(value, prefix = '') {
    if (Array.isArray(value)) return value.forEach((child, index) => inspect(child, `${prefix}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (FORBIDDEN_BLIND_KEYS.has(key.toLowerCase())) violations.push(path);
      inspect(child, path);
    }
  }
  inspect(raw);
  if (violations.length) {
    const error = new Error(`NFL blind payload contains post-model market data: ${violations.join(', ')}`);
    error.code = 'NFL_BLIND_MARKET_SEPARATION';
    error.violations = violations;
    throw error;
  }
}

function assertPipelineOrder(raw, context) {
  const blindAt = Date.parse(raw.generated_at || '');
  const marketAt = Date.parse(context.market?.captured_at || '');
  if (!Number.isFinite(blindAt)) throw new Error('NFL blind generated_at is required to prove pipeline order');
  if (!Number.isFinite(marketAt)) throw new Error('NFL market captured_at is required to prove pipeline order');
  if (marketAt <= blindAt) throw new Error('NFL Market Challenger must run after the blind internal projection');
  return {
    blind_generated_at: new Date(blindAt).toISOString(),
    market_captured_at: new Date(marketAt).toISOString()
  };
}

function score(raw) {
  const projection = raw?.projection || {};
  return {
    home: finiteOrNull(projection.projected_score?.home ?? projection.mean_home),
    away: finiteOrNull(projection.projected_score?.away ?? projection.mean_away)
  };
}

function primaryExpression(context) {
  return context?.market?.best_market_expression || null;
}

function disagreementFirewall(internalMargin, internalTotal, challenger) {
  const marketMargin = finiteOrNull(challenger?.margin);
  const marketTotal = finiteOrNull(challenger?.total);
  const margin = internalMargin == null || marketMargin == null ? null : Math.abs(internalMargin - marketMargin);
  const total = internalTotal == null || marketTotal == null ? null : Math.abs(internalTotal - marketTotal);
  const worst = Math.max(margin ?? 0, total ?? 0);
  if (worst >= 7) return { status: 'PASS', max_tier: 'PASS', disagreement_points: worst, reason: '7+ point model-vs-market disagreement' };
  if (worst >= 5) return { status: 'SECONDARY_MAX', max_tier: 'SECONDARY', disagreement_points: worst, reason: '5–7 point disagreement caps the decision at Secondary' };
  if (worst >= 3) return { status: 'CORE_BLOCK', max_tier: 'SECONDARY', disagreement_points: worst, reason: '3–5 point disagreement blocks Core' };
  return { status: 'NORMAL', max_tier: 'CORE_CANDIDATE', disagreement_points: worst, reason: 'Small model-vs-market disagreement' };
}

function capDecision(requested, firewall) {
  if (firewall.max_tier === 'PASS') return 'PASS';
  if (firewall.max_tier === 'SECONDARY' && requested === 'CORE_CANDIDATE') return 'SECONDARY';
  return ['CORE_CANDIDATE', 'SECONDARY'].includes(requested) ? requested : 'PASS';
}

function adapt(raw, context = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('NFL engine output is required');
  const declared = String(raw.sport || context.sport || '').toLowerCase();
  if (!['nfl', SPORT_KEY].includes(declared)) throw new Error(`NFL adapter cannot accept sport: ${raw.sport || context.sport || 'missing'}`);
  if (raw.engine_version !== marketChallenger.INTERNAL_CHAMPION) {
    throw new Error(`NFL shadow publisher requires current internal Champion ${marketChallenger.INTERNAL_CHAMPION}`);
  }
  assertBlindIntegrity(raw);
  assertBlindPayloadSeparation(raw);
  const pipelineTimestamps = assertPipelineOrder(raw, context);

  const projectedScore = score(raw);
  const internalMargin = finiteOrNull(raw.projection?.margin ?? raw.projection?.mean_home_margin ?? (
    projectedScore.home != null && projectedScore.away != null ? projectedScore.home - projectedScore.away : null
  ));
  const internalTotal = finiteOrNull(raw.projection?.total ?? raw.projection?.mean_total ?? (
    projectedScore.home != null && projectedScore.away != null ? projectedScore.home + projectedScore.away : null
  ));
  const expression = primaryExpression(context);
  const internalCoverProbability = finiteOrNull(raw.projection?.spread_probabilities?.home ?? raw.projection?.home_cover_probability ?? raw.projection?.challenger_cover_prob);
  const internalOverProbability = finiteOrNull(raw.projection?.total_probabilities?.over ?? raw.projection?.over_probability ?? raw.projection?.challenger_over_prob);
  const postMarket = marketChallenger.run({
    internal_margin: internalMargin,
    internal_total: internalTotal,
    internal_cover_probability: internalCoverProbability,
    internal_over_probability: internalOverProbability,
    margin_standard_deviation: raw.projection?.distribution?.margin_standard_deviation ?? raw.quality?.margin_standard_deviation,
    total_standard_deviation: raw.projection?.distribution?.total_standard_deviation ?? raw.quality?.total_standard_deviation,
    market: context.market
  });
  const challenger = postMarket.challenger_projection;
  const firewall = disagreementFirewall(internalMargin, internalTotal, challenger);
  const requested = context.market?.decision_status || expression?.aegis_release_status || expression?.release_status || 'PASS';
  const status = capDecision(requested, firewall);
  const executionRequested = context.market?.execution_status || 'PASS';
  const execution = status === 'PASS' ? 'PASS' : (['BET_NOW', 'WAIT'].includes(executionRequested) ? executionRequested : 'WAIT');
  const quality = raw.quality || {};
  const market = { ...(context.market || {}), challenger_projection: challenger, post_model_projection: postMarket.post_model_projection, challenger_engine_version: postMarket.engine_version };
  const game = { ...(raw.game || {}), ...(context.game || {}) };

  const standard = normalizeStandardOutput({
    schema_version: 'AEGIS_STANDARD_GAME_OUTPUT_v1',
    sport: SPORT_KEY,
    engine_version: raw.engine_version,
    game_id: raw.game_id || game.id,
    home_team: raw.home_team || game.home_team || game.home,
    away_team: raw.away_team || game.away_team || game.away,
    start_time: raw.start_time || game.start_time || game.commence_time,
    projection: {
      projected_score: projectedScore,
      margin: internalMargin,
      total: internalTotal,
      moneyline_probabilities: raw.projection?.moneyline_probabilities || {
        home: raw.projection?.home_ml,
        away: raw.projection?.away_ml
      },
      spread_probabilities: raw.projection?.spread_probabilities,
      total_probabilities: raw.projection?.total_probabilities,
      team_total_probabilities: raw.projection?.team_total_probabilities,
      period_probabilities: raw.projection?.period_probabilities || {
        first_quarter: raw.projection?.first_quarter,
        first_half: raw.projection?.first_half
      },
      percentiles: raw.projection?.percentiles || raw.projection?.score_percentiles
    },
    quality: {
      data_quality_score: quality.data_quality_score,
      data_quality_grade: quality.data_quality_grade,
      uncertainty: quality.uncertainty ?? quality.simulation_uncertainty_multiplier,
      model_dispersion: quality.model_dispersion ?? quality.ensemble_dispersion,
      ensemble_agreement: quality.ensemble_agreement
    },
    market: {
      ...market,
      current_price: market.current_price || (expression ? {
        market: expression.market_type || expression.market,
        selection: expression.name || expression.selection,
        point: expression.point,
        odds: expression.odds ?? expression.price,
        book: expression.book
      } : {}),
      implied_probability: market.implied_probability ?? expression?.implied_probability,
      fair_probability: market.fair_probability ?? expression?.fair_probability ?? expression?.model_probability,
      ev: market.ev ?? expression?.adjusted_ev ?? expression?.ev,
      play_to: market.play_to ?? expression?.play_to,
      line_sensitivity: market.line_sensitivity ?? expression?.key_number_sensitivity
    },
    decision: {
      best_market_expression: expression,
      status,
      execution_status: execution
    },
    diagnostics: {
      why_it_wins: raw.diagnostics?.why_it_wins || expression?.why_it_wins || [],
      how_it_loses: raw.diagnostics?.how_it_loses || expression?.how_it_loses || [],
      tail_risks: raw.diagnostics?.tail_risks || expression?.tail_risks || [],
      matchup_drivers: raw.diagnostics?.matchup_drivers || [],
      sport_specific: {
        nfl: raw.matchup || raw.diagnostics?.sport_specific?.nfl || {},
        disagreement_firewall: firewall,
        market_challenger: postMarket,
        blocked_same_thesis_expressions: context.market?.blocked_same_thesis_expressions || []
      }
    },
    governance: {
      same_thesis_lock: true,
      parlay_firewall: true,
      core_cap: true,
      top3_gate: true,
      exposure_ledger: 'SHADOW_SEPARATE',
      disagreement_firewall: firewall,
      market_challenger_is_post_model: true,
      pipeline_order: ['blind_internal_projection', 'market_challenger', 'post_model_calibration', 'disagreement_firewall', 'aegis_governance'],
      source_release_status: requested,
      internal_champion: marketChallenger.INTERNAL_CHAMPION,
      historical_predecessor: marketChallenger.HISTORICAL_PREDECESSOR,
      internal_promotion_gate: 'PROMOTE_V10_INTERNAL_CHALLENGER',
      market_challenger_version: marketChallenger.ENGINE_VERSION,
      pipeline_timestamps: pipelineTimestamps,
      publisher: context.publisher || null,
      production_release_allowed: false
    }
  });

  const checked = validateStandardOutput(standard, SPORT_KEY);
  if (!checked.ok) throw new Error(`Invalid standardized NFL output: ${checked.errors.join(', ')}`);
  return checked.value;
}

module.exports = { SPORT_KEY, FORBIDDEN_BLIND_FEATURES, FORBIDDEN_BLIND_KEYS, assertBlindIntegrity, assertBlindPayloadSeparation, assertPipelineOrder, disagreementFirewall, adapt };
