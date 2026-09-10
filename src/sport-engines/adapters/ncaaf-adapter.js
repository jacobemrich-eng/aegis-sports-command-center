'use strict';

const { finiteOrNull, normalizeStandardOutput, validateStandardOutput } = require('../contract');
const challenger = require('../ncaaf-market-challenger');
const SPORT_KEY = 'americanfootball_ncaaf';
const INTERNAL_CHAMPION = 'NCAAF_v0.1_POSSESSION_ENSEMBLE_CANDIDATE';
const HISTORICAL_REFERENCE = 'SB101_AEGIS_NCAAF_PRODUCTION_REFERENCE';
const FORBIDDEN_KEYS = new Set(['sportsbook_spread','sportsbook_total','sportsbook_odds','spread_line','total_line','closing_line','market_price','market_consensus','final_score','home_score','away_score','result','postgame_statistics','future_injury_status','provider_id','numeric_id']);
const FORBIDDEN_PATTERNS = [/(^|_)(sportsbook|market|closing|close)(_|$)/i,/(^|_)(final|postgame|result)(_|$)/i,/future.*injur/i];

function featureNames(raw) { const value = raw?.blind_features || raw?.diagnostics?.blind_features || []; return Array.isArray(value) ? value.map(String) : Object.keys(value || {}); }
function assertBlindIntegrity(raw) {
  const violations = [];
  for (const name of featureNames(raw)) if (FORBIDDEN_PATTERNS.some(pattern => pattern.test(name))) violations.push(`blind_features.${name}`);
  function visit(value, path = '') {
    if (Array.isArray(value)) return value.forEach((child, index) => visit(child, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { const childPath = path ? `${path}.${key}` : key; if (FORBIDDEN_KEYS.has(key.toLowerCase())) violations.push(childPath); visit(child, childPath); }
  }
  if (raw?.market != null || raw?.market_expressions != null) violations.push('market');
  visit(raw);
  if (violations.length) { const error = new Error(`NCAAF blind hygiene failed: ${[...new Set(violations)].join(', ')}`); error.code = 'NCAAF_BLIND_HYGIENE'; throw error; }
}
function assertPipelineOrder(raw, context) {
  const blindAt = Date.parse(raw.generated_at || ''), marketAt = Date.parse(context.market?.captured_at || '');
  if (!Number.isFinite(blindAt)) throw new Error('NCAAF blind generated_at is required');
  if (!Number.isFinite(marketAt) || marketAt <= blindAt) throw new Error('NCAAF market capture must occur after immutable blind lock');
  return { blind_generated_at: new Date(blindAt).toISOString(), market_captured_at: new Date(marketAt).toISOString() };
}
function researchFirewall(raw, postMarket, context) {
  const worst = Math.max(postMarket.disagreement.margin, postMarket.disagreement.total);
  const structural = raw.quality?.structural_break === true || raw.quality?.early_season_high_uncertainty === true;
  const dispersion = finiteOrNull(raw.quality?.model_dispersion ?? raw.quality?.ensemble_dispersion) || 0;
  let status = 'RESEARCH_CORE_BLOCK', reason = 'NCAAF disagreement thresholds have not earned OOS promotion';
  if (worst >= 7) { status = 'RESEARCH_PASS'; reason = 'Large NCAAF disagreement is uncertainty, not evidence of edge'; }
  if (structural) { status = 'RESEARCH_PASS'; reason = 'Roster/regime structural-break uncertainty blocks Core'; }
  if (dispersion >= 7) { status = 'RESEARCH_PASS'; reason = 'High internal ensemble disagreement blocks Core'; }
  const price = context.market?.current_price || {}, favorite = Math.abs(Number(price.spread?.home?.point ?? price.home_spread ?? 0));
  const gates = { favorite_points: favorite, garbage_time_required: favorite >= 21, independent_first_half_required: favorite >= 28, backup_rotation_cover_proof_required: favorite >= 35, garbage_time_assessed: raw.diagnostics?.sport_specific?.ncaaf?.garbage_time != null, independent_first_half_present: raw.projection?.period_probabilities?.first_half != null };
  const expression = context.market?.best_market_expression || {};
  const expressionType = String(expression.market_type || expression.market || '').toLowerCase();
  const expressionPoint = Math.abs(Number(expression.point));
  gates.fragile_team_total_under = expressionType.includes('team') && expressionType.includes('total') && String(expression.selection || expression.name || '').toLowerCase().includes('under') && expressionPoint <= 10.5;
  gates.team_total_core_prohibited = gates.fragile_team_total_under;
  if ((gates.garbage_time_required && !gates.garbage_time_assessed) || (gates.independent_first_half_required && !gates.independent_first_half_present)) { status = 'RESEARCH_PASS'; reason = 'Mandatory large-favorite validation is incomplete'; }
  return { status, max_tier: 'PASS', disagreement_points: worst, reason, thresholds_validated: false, large_favorite_gates: gates };
}
function adapt(raw, context = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('NCAAF engine output is required');
  if (![SPORT_KEY,'ncaaf'].includes(String(raw.sport || '').toLowerCase())) throw new Error('NCAAF adapter cannot accept another sport');
  if (raw.engine_version !== INTERNAL_CHAMPION) throw new Error(`NCAAF shadow requires ${INTERNAL_CHAMPION}`);
  assertBlindIntegrity(raw);
  const timestamps = assertPipelineOrder(raw, context), projection = raw.projection || {}, score = projection.projected_score || {};
  const margin = finiteOrNull(projection.margin), total = finiteOrNull(projection.total);
  const postMarket = challenger.run({ internal_margin: margin, internal_total: total, market: context.market });
  const firewall = researchFirewall(raw, postMarket, context);
  const standard = normalizeStandardOutput({
    sport: SPORT_KEY, engine_version: raw.engine_version, game_id: raw.game_id || raw.game?.id, home_team: raw.home_team || raw.game?.home, away_team: raw.away_team || raw.game?.away, start_time: raw.start_time || raw.game?.start_time,
    projection: { projected_score: { home: score.home, away: score.away }, margin, total, moneyline_probabilities: projection.moneyline_probabilities, spread_probabilities: projection.spread_probabilities, total_probabilities: projection.total_probabilities, period_probabilities: projection.period_probabilities, percentiles: projection.percentiles },
    quality: raw.quality,
    market: { ...context.market, challenger_projection: postMarket.challenger_projection, post_model_projection: postMarket.post_model_projection, challenger_engine_version: challenger.ENGINE_VERSION },
    decision: { best_market_expression: context.market?.best_market_expression || null, status: 'PASS', execution_status: 'PASS' },
    diagnostics: { why_it_wins: raw.diagnostics?.why_it_wins || [], how_it_loses: raw.diagnostics?.how_it_loses || [], tail_risks: raw.diagnostics?.tail_risks || [], matchup_drivers: raw.diagnostics?.matchup_drivers || [], sport_specific: { ncaaf: raw.diagnostics?.sport_specific?.ncaaf || {}, market_challenger: postMarket, disagreement_firewall: firewall } },
    governance: { same_thesis_lock: true, parlay_firewall: true, core_cap: true, top3_gate: true, exposure_ledger: 'SHADOW_SEPARATE', disagreement_firewall: firewall, market_challenger_is_post_model: true, pipeline_order: ['blind_internal_projection','immutable_blind_archive','market_capture','market_challenger','research_disagreement_gate','aegis_shadow_governance'], internal_champion: INTERNAL_CHAMPION, historical_predecessor: null, historical_reference: HISTORICAL_REFERENCE, market_challenger_version: challenger.ENGINE_VERSION, monitoring_state: 'INSUFFICIENT_SAMPLE', production_promotion_allowed: false, pipeline_timestamps: timestamps, publisher: context.publisher || null }
  });
  const checked = validateStandardOutput(standard, SPORT_KEY); if (!checked.ok) throw new Error(`Invalid standardized NCAAF output: ${checked.errors.join(', ')}`); return checked.value;
}
module.exports = { SPORT_KEY, INTERNAL_CHAMPION, HISTORICAL_REFERENCE, FORBIDDEN_KEYS, assertBlindIntegrity, assertPipelineOrder, researchFirewall, adapt };
