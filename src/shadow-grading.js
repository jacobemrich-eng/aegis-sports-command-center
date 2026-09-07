'use strict';

const NFL = 'americanfootball_nfl';
const AUDIT_LABELS = new Set([
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

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  const rows = values.map(finite).filter(value => value != null);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}

function absoluteError(actual, predicted) {
  const a = finite(actual), p = finite(predicted);
  return a == null || p == null ? null : Math.abs(a - p);
}

function binaryOutcome(value) {
  const number = finite(value);
  if (number == null) return null;
  return number > 0 ? 'WIN' : number < 0 ? 'LOSS' : 'PUSH';
}

function brier(probability, outcome) {
  const p = finite(probability);
  if (p == null || outcome === 'PUSH' || !['WIN', 'LOSS'].includes(outcome)) return null;
  return (Math.max(0, Math.min(1, p)) - (outcome === 'WIN' ? 1 : 0)) ** 2;
}

function marketLines(record, closing = {}) {
  const price = record.market?.current_price || {};
  return {
    home_spread: finite(price.spread?.home?.point ?? price.home_spread ?? price.spread),
    total: finite(price.total?.point ?? price.total_line ?? price.total),
    home_spread_price: finite(price.spread?.home?.price ?? price.home_spread_price),
    over_price: finite(price.total?.over?.price ?? price.over_price),
    closing_home_spread: finite(closing.home_spread ?? closing.spread),
    closing_total: finite(closing.total)
  };
}

function selectedOutcome(record, actualMargin, actualTotal) {
  const selected = record.decision?.best_market_expression;
  if (!selected) return 'NO_SELECTION';
  const type = String(selected.market_type || selected.market || '').toLowerCase();
  const selection = String(selected.selection || selected.name || '').toLowerCase();
  const point = finite(selected.point);
  if (type.includes('spread') && point != null) {
    const homeSelected = selection.includes(String(record.home_team || '').toLowerCase()) || selection === 'home';
    const awaySelected = selection.includes(String(record.away_team || '').toLowerCase()) || selection === 'away';
    if (!homeSelected && !awaySelected) return 'UNGRADABLE';
    return binaryOutcome((homeSelected ? actualMargin : -actualMargin) + point);
  }
  if (type.includes('total') && point != null) {
    if (selection.includes('under')) return binaryOutcome(point - actualTotal);
    if (selection.includes('over')) return binaryOutcome(actualTotal - point);
    return 'UNGRADABLE';
  }
  if (type.includes('moneyline') || type === 'h2h') {
    const homeSelected = selection.includes(String(record.home_team || '').toLowerCase()) || selection === 'home';
    return binaryOutcome(homeSelected ? actualMargin : -actualMargin);
  }
  return 'UNGRADABLE';
}

function classification({ selected, firewall, marginError, marketMarginError, dataGrade, result }) {
  if (result.data_quality_miss === true || ['D', 'F'].includes(String(dataGrade || '').toUpperCase())) return 'data-quality miss';
  if (result.personnel_regime_miss === true) return 'personnel/regime miss';
  if (selected === 'WIN' && marginError != null && marketMarginError != null && marginError < marketMarginError) return 'clean thesis win';
  if (selected === 'WIN' && firewall === 'PASS') return 'fragile / variance-assisted win';
  if (selected === 'WIN' && result.execution_price_advantage === true) return 'execution/price win';
  if (selected === 'WIN') return 'market-selection win';
  if (selected === 'LOSS' && result.near_threshold === true) return 'near-threshold variance loss';
  if (selected === 'LOSS' && marginError != null && marketMarginError != null && marginError < marketMarginError) return 'market-selection loss';
  return 'model/thesis miss';
}

function gradeNFL(record, result = {}, gradedAt = new Date().toISOString()) {
  if (record.sport !== NFL) throw new Error('NFL shadow grader cannot grade another sport');
  const home = finite(result.home_score), away = finite(result.away_score);
  if (home == null || away == null) throw new Error('Final home_score and away_score are required');
  if (Date.parse(result.completed_at || gradedAt) < Date.parse(record.start_time || '')) throw new Error('Postgame result timestamp cannot precede kickoff');

  const actualMargin = home - away, actualTotal = home + away;
  const blindMargin = finite(record.projection?.margin), blindTotal = finite(record.projection?.total);
  const postMargin = finite(record.market?.post_model_projection?.margin);
  const postTotal = finite(record.market?.post_model_projection?.total);
  const marketMargin = finite(record.market?.challenger_projection?.margin);
  const marketTotal = finite(record.market?.challenger_projection?.total);
  const lines = marketLines(record, result.closing_market || {});
  const ats = lines.home_spread == null ? 'UNAVAILABLE' : binaryOutcome(actualMargin + lines.home_spread);
  const total = lines.total == null ? 'UNAVAILABLE' : binaryOutcome(actualTotal - lines.total);
  const selected = selectedOutcome(record, actualMargin, actualTotal);
  const post = record.market?.post_model_projection || {};
  const firewall = record.governance?.disagreement_firewall?.status || 'UNKNOWN';
  const marginError = absoluteError(actualMargin, blindMargin);
  const marketMarginError = absoluteError(actualMargin, marketMargin);
  const label = classification({ selected, firewall, marginError, marketMarginError, dataGrade: record.quality?.data_quality_grade, result });
  if (!AUDIT_LABELS.has(label)) throw new Error(`Unsupported postgame classification: ${label}`);

  return {
    graded_at: gradedAt,
    result_source: result.source || 'shadow-result-provider',
    completed_at: result.completed_at || gradedAt,
    final_score: { home, away },
    actual_final_margin: actualMargin,
    actual_total: actualTotal,
    blind_margin_error: marginError,
    blind_total_error: absoluteError(actualTotal, blindTotal),
    post_market_margin_error: absoluteError(actualMargin, postMargin),
    post_market_total_error: absoluteError(actualTotal, postTotal),
    market_margin_error: marketMarginError,
    market_total_error: absoluteError(actualTotal, marketTotal),
    closing_market_margin_error: lines.closing_home_spread == null ? null : absoluteError(actualMargin, -lines.closing_home_spread),
    closing_market_total_error: absoluteError(actualTotal, lines.closing_total),
    home_ats_outcome: ats,
    total_outcome: total,
    selected_expression_outcome: selected,
    cover_brier: brier(post.cover_probability, ats),
    over_brier: brier(post.over_probability, total),
    closing_line: { home_spread: lines.closing_home_spread, total: lines.closing_total },
    clv: {
      home_spread_points: lines.closing_home_spread == null || lines.home_spread == null ? null : lines.home_spread - lines.closing_home_spread,
      total_points: lines.closing_total == null || lines.total == null ? null : lines.total - lines.closing_total,
      available: lines.closing_home_spread != null || lines.closing_total != null
    },
    disagreement_bucket: record.diagnostics?.sport_specific?.market_challenger?.disagreement?.margin_bucket || null,
    firewall_classification: firewall,
    model_beat_market_on_margin_error: marginError != null && marketMarginError != null ? marginError < marketMarginError : null,
    model_beat_market_on_total_error: blindTotal != null && marketTotal != null ? Math.abs(actualTotal - blindTotal) < Math.abs(actualTotal - marketTotal) : null,
    data_quality_state: record.quality?.data_quality_grade || null,
    aegis_postgame_classification: label,
    shadow_only: true,
    official_results_eligible: false,
    official_bankroll_eligible: false
  };
}

function recordTally(rows, key) {
  return rows.reduce((out, row) => {
    const value = row.shadow_grade?.[key];
    if (value) out[value] = (out[value] || 0) + 1;
    return out;
  }, {});
}

function monitoringState(summary) {
  if (summary.graded_games < 100) return 'INSUFFICIENT_SAMPLE';
  const beatsBoth = summary.margin_mae != null && summary.market_margin_mae != null && summary.total_mae != null && summary.market_total_mae != null
    && summary.margin_mae < summary.market_margin_mae && summary.total_mae < summary.market_total_mae;
  if (summary.graded_games >= 500 && beatsBoth && summary.cover_brier != null && summary.cover_brier <= 0.25 && summary.over_brier != null && summary.over_brier <= 0.25) {
    return 'PROMOTION_REVIEW_REQUIRED';
  }
  if (summary.graded_games >= 300 && beatsBoth) return 'CHALLENGER_HIGH_INTEREST';
  return 'SHADOW_MONITORING';
}

function summarize(games = [], errors = []) {
  const graded = games.filter(game => game.shadow_grade);
  const metric = key => mean(graded.map(game => game.shadow_grade[key]));
  const buckets = {};
  for (const game of graded) {
    const key = game.shadow_grade.disagreement_bucket || 'UNKNOWN';
    const row = buckets[key] || (buckets[key] = { games: 0, margin_errors: [], total_errors: [], market_margin_errors: [], market_total_errors: [] });
    row.games += 1;
    row.margin_errors.push(game.shadow_grade.blind_margin_error);
    row.total_errors.push(game.shadow_grade.blind_total_error);
    row.market_margin_errors.push(game.shadow_grade.market_margin_error);
    row.market_total_errors.push(game.shadow_grade.market_total_error);
  }
  for (const row of Object.values(buckets)) {
    row.margin_mae = mean(row.margin_errors); row.total_mae = mean(row.total_errors);
    row.market_margin_mae = mean(row.market_margin_errors); row.market_total_mae = mean(row.market_total_errors);
    delete row.margin_errors; delete row.total_errors; delete row.market_margin_errors; delete row.market_total_errors;
  }
  const firewall_counts = games.reduce((out, game) => {
    const key = game.governance?.disagreement_firewall?.status || 'UNKNOWN';
    out[key] = (out[key] || 0) + 1; return out;
  }, {});
  const summary = {
    shadow_only: true,
    research_only: true,
    current_champion: 'NFL_v1.0_FEATURE_ABLATION',
    historical_predecessor: 'NFL_v0.8_FEATURE_HYGIENE',
    live_shadow_games: games.filter(game => !game.shadow_grade).length,
    graded_games: graded.length,
    margin_mae: metric('blind_margin_error'), total_mae: metric('blind_total_error'),
    post_market_margin_mae: metric('post_market_margin_error'), post_market_total_mae: metric('post_market_total_error'),
    market_margin_mae: metric('market_margin_error'), market_total_mae: metric('market_total_error'),
    cover_brier: metric('cover_brier'), over_brier: metric('over_brier'),
    ats_record: recordTally(graded, 'home_ats_outcome'), total_record: recordTally(graded, 'total_outcome'),
    selected_expression_record: recordTally(graded, 'selected_expression_outcome'),
    mean_spread_clv: mean(graded.map(game => game.shadow_grade.clv?.home_spread_points)),
    mean_total_clv: mean(graded.map(game => game.shadow_grade.clv?.total_points)),
    disagreement_buckets: buckets,
    firewall_counts,
    shadow_errors: errors.length,
    automatic_promotion_allowed: false
  };
  summary.monitoring_state = monitoringState(summary);
  summary.sample_warning = summary.graded_games < 100 ? `Only ${summary.graded_games}/100 minimum monitoring games are graded. No promotion inference is permitted.` : null;
  return summary;
}

module.exports = { NFL, finite, absoluteError, binaryOutcome, gradeNFL, summarize, monitoringState };
