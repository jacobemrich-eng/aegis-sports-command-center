'use strict';

const calibration = require('../../public/data/nfl-v09-report.json');

const ENGINE_VERSION = 'NFL_v0.9_MARKET_CHALLENGER_CALIBRATION';
const INTERNAL_CHAMPION = 'NFL_v1.0_FEATURE_ABLATION';
const HISTORICAL_PREDECESSOR = 'NFL_v0.8_FEATURE_HYGIENE';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bucketName(disagreement) {
  const value = Math.abs(Number(disagreement));
  if (value <= 1) return '<=1';
  if (value <= 2) return '1-2';
  if (value <= 3) return '2-3';
  if (value <= 5) return '3-5';
  if (value <= 7) return '5-7';
  return '7+';
}

function blend(internal, market, weight) {
  const a = finite(internal);
  const b = finite(market);
  const w = finite(weight);
  if (a == null || b == null || w == null) return null;
  return w * a + (1 - w) * b;
}

function probabilityBlend(internal, weight) {
  const value = finite(internal);
  const w = finite(weight);
  if (value == null || w == null) return null;
  return Math.max(0.01, Math.min(0.99, 0.5 + w * (value - 0.5)));
}

function learnedWeights(bucket) {
  const row = calibration.learned_weight_summary?.[bucket];
  if (!row) throw new Error(`Missing committed v0.9 calibration bucket: ${bucket}`);
  return {
    margin: finite(row.mean_internal_margin_weight),
    total: finite(row.mean_internal_total_weight),
    cover_probability: finite(row.mean_internal_cover_probability_weight),
    over_probability: finite(row.mean_internal_over_probability_weight)
  };
}

function run({ internal_margin, internal_total, internal_cover_probability, internal_over_probability, market } = {}) {
  const challenger = market?.challenger_projection || {};
  const marketMargin = finite(challenger.margin);
  const marketTotal = finite(challenger.total);
  const internalMargin = finite(internal_margin);
  const internalTotal = finite(internal_total);
  if (internalMargin == null || internalTotal == null) throw new Error('Completed blind NFL margin and total projections are required');
  if (marketMargin == null || marketTotal == null) throw new Error('Independent Market Challenger margin and total are required after the blind projection');

  const marginDisagreement = Math.abs(internalMargin - marketMargin);
  const totalDisagreement = Math.abs(internalTotal - marketTotal);
  const marginBucket = bucketName(marginDisagreement);
  const totalBucket = bucketName(totalDisagreement);
  const marginWeights = learnedWeights(marginBucket);
  const totalWeights = learnedWeights(totalBucket);

  return {
    engine_version: ENGINE_VERSION,
    internal_champion: INTERNAL_CHAMPION,
    historical_predecessor: HISTORICAL_PREDECESSOR,
    challenger_projection: { margin: marketMargin, total: marketTotal },
    post_model_projection: {
      margin: blend(internalMargin, marketMargin, marginWeights.margin),
      total: blend(internalTotal, marketTotal, totalWeights.total),
      cover_probability: probabilityBlend(internal_cover_probability, marginWeights.cover_probability),
      over_probability: probabilityBlend(internal_over_probability, totalWeights.over_probability)
    },
    disagreement: {
      margin: marginDisagreement,
      total: totalDisagreement,
      margin_bucket: marginBucket,
      total_bucket: totalBucket
    },
    learned_internal_weights: {
      margin: marginWeights.margin,
      total: totalWeights.total,
      cover_probability: marginWeights.cover_probability,
      over_probability: totalWeights.over_probability
    },
    market_remains_independent_challenger: true,
    calibration_source: 'public/data/nfl-v09-report.json'
  };
}

module.exports = {
  ENGINE_VERSION,
  INTERNAL_CHAMPION,
  HISTORICAL_PREDECESSOR,
  bucketName,
  learnedWeights,
  run
};
