'use strict';

const ENGINE_VERSION = 'NCAAF_v0.1_INDEPENDENT_MARKET_CHALLENGER';
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function bucket(value) { const n = Math.abs(Number(value)); return n < 3 ? 'SMALL_LT_3' : n < 7 ? 'ELEVATED_3_7' : n < 14 ? 'HIGH_7_14' : 'EXTREME_14_PLUS'; }
function run({ internal_margin, internal_total, market } = {}) {
  const blindMargin = finite(internal_margin), blindTotal = finite(internal_total);
  const source = market?.challenger_projection || {}, marketMargin = finite(source.margin), marketTotal = finite(source.total);
  if (blindMargin == null || blindTotal == null) throw new Error('Completed blind NCAAF margin and total projections are required');
  if (marketMargin == null || marketTotal == null) throw new Error('Independent NCAAF Market Challenger margin and total are required after blind lock');
  const margin = Math.abs(blindMargin - marketMargin), total = Math.abs(blindTotal - marketTotal);
  return {
    engine_version: ENGINE_VERSION,
    challenger_projection: { margin: marketMargin, total: marketTotal },
    post_model_projection: { margin: blindMargin, total: blindTotal, calibration_status: 'UNCALIBRATED_RESEARCH' },
    disagreement: { margin, total, margin_bucket: bucket(margin), total_bucket: bucket(total) },
    market_remains_independent_challenger: true, calibrated_weights_applied: false
  };
}
module.exports = { ENGINE_VERSION, bucket, run };
