'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AEGIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-nfl-live-'));
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.NFL_SIM_ENABLED = 'true';
process.env.NFL_SIM_SHADOW_ONLY = 'true';
process.env.AEGIS_NEW_ENGINE_AUTO_RELEASE = 'false';

const store = require('../src/store');
const shadow = require('../src/shadow-service');
const grading = require('../src/shadow-grading');
const integrity = require('../src/shadow-integrity');

function output(generatedAt = '2026-09-10T12:00:00Z') {
  return {
    schema_version: 'AEGIS_STANDARD_GAME_OUTPUT_v1', sport: 'NFL',
    engine_version: 'NFL_v1.0_FEATURE_ABLATION', generated_at: generatedAt,
    game: { id: '2026_01_MIA_BUF', home: 'Buffalo Bills', away: 'Miami Dolphins', start_time: '2026-09-13T17:00:00Z' },
    blind_features: ['home_epa_per_play', 'away_epa_per_play', 'home_games_in_sample'],
    projection: {
      mean_home: 25, mean_away: 22, mean_home_margin: 3, mean_total: 47,
      home_ml: 0.6, away_ml: 0.4,
      distribution: { margin_standard_deviation: 12, total_standard_deviation: 13 },
      percentiles: { margin: { p10: -12, p50: 3, p90: 18 } }
    },
    quality: { data_quality_score: 0.9, data_quality_grade: 'A', margin_standard_deviation: 12, total_standard_deviation: 13 },
    diagnostics: { why_it_wins: [], how_it_loses: [], tail_risks: [] }
  };
}

function market(capturedAt = '2026-09-10T12:01:00Z') {
  return {
    captured_at: capturedAt,
    challenger_projection: { margin: 2.5, total: 46.5 },
    current_price: {
      spread: { home: { point: -2.5, price: -110 }, away: { point: 2.5, price: -110 } },
      total: { point: 46.5, over: { price: -110 }, under: { price: -110 } }
    },
    best_market_expression: { name: 'Buffalo Bills', selection: 'Buffalo Bills', market_type: 'spreads', point: -2.5, odds: -110 },
    snapshot_target: 'EARLY_BASELINE', quota: { requests_remaining: 490 },
    decision_status: 'SECONDARY', execution_status: 'WAIT'
  };
}

test('duplicate snapshots are idempotent and the first blind projection is immutable', async () => {
  const first = await shadow.ingest({ sport: grading.NFL, engine_output: output(), market: market() });
  assert.equal(first.saved, true);
  assert.equal(first.record.market_snapshots.length, 1);

  const duplicate = await shadow.ingest({ sport: grading.NFL, engine_output: output(), market: market() });
  assert.equal(duplicate.saved, false);
  assert.equal(duplicate.duplicate, true);

  const update = await shadow.ingest({ sport: grading.NFL, engine_output: output(), market: market('2026-09-10T13:01:00Z') });
  assert.equal(update.record.market_snapshots.length, 2);
  assert.equal(update.record.market_snapshots[0].snapshot_target, 'EARLY_BASELINE');
  assert.equal(update.record.market_snapshots[0].bookmaker_count, null);
  assert.equal(update.record.market_movement.snapshot_count, 2);
  assert.equal(update.record.market_movement.disagreement_direction, 'UNCHANGED');
  const altered = market('2026-09-10T13:01:00Z'); altered.current_price.spread.home.point = -3;
  await assert.rejects(
    shadow.ingest({ sport: grading.NFL, engine_output: output(), market: altered }),
    /timestamp already exists with different content/
  );
  await assert.rejects(
    shadow.ingest({ sport: grading.NFL, engine_output: output('2026-09-10T13:00:00Z'), market: market('2026-09-10T13:02:00Z') }),
    /blind projection is immutable/
  );
});

test('durable blind archive is exact, idempotent, and immutable', async () => {
  const archivedOutput = output(); archivedOutput.game = { ...archivedOutput.game, id: '2026_01_ARCHIVE_TEST' };
  const raw = `${JSON.stringify(archivedOutput, null, 2)}\n`;
  const first = await shadow.archiveBlind({
    sport: grading.NFL, blind_json: raw,
    original_file_sha256: integrity.sha256(raw)
  });
  assert.equal(first.archive.original_file_sha256, integrity.sha256(raw));
  assert.equal(first.archive.canonical_sha256, integrity.sha256(integrity.canonicalJson(archivedOutput)));
  const same = await shadow.archiveBlind({ sport: grading.NFL, blind_json: raw, original_file_sha256: integrity.sha256(raw) });
  assert.equal(same.duplicate, true);
  const changed = JSON.parse(JSON.stringify(archivedOutput)); changed.projection.mean_total = 48;
  await assert.rejects(shadow.archiveBlind({ sport: grading.NFL, engine_output: changed }), /content is immutable/);
});

test('direct API adapter path rejects postgame and future fields even when feature names look safe', async () => {
  await assert.rejects(
    shadow.ingest({ sport: grading.NFL, engine_output: { ...output(), final_score: '27-20' }, market: market() }),
    /post-model market data/
  );
  await assert.rejects(
    shadow.ingest({ sport: grading.NFL, engine_output: { ...output(), future_injury_status: 'active' }, market: market() }),
    /post-model market data/
  );
});

test('NFL shadow grading cannot mutate official Results, cards, locks, or bankroll state', async () => {
  await store.mutate(async state => {
    state.latest_cards = { baseball_mlb: { card_id: 'official-card' } };
    state.audit = [{ event: 'OFFICIAL' }];
    state.locks = [{ key: 'official-lock' }];
    state.bankroll = { units: 100 };
  });
  const before = await store.load();
  const official = JSON.stringify({ latest_cards: before.latest_cards, audit: before.audit, locks: before.locks, bankroll: before.bankroll });

  const result = await shadow.gradeMany({
    sport: grading.NFL,
    results: [{ game_id: '2026_01_MIA_BUF', home_score: 27, away_score: 20, completed_at: '2026-09-14T00:00:00Z', closing_market: { home_spread: -3, total: 47 } }]
  });
  assert.equal(result.graded.length, 1);
  assert.equal(result.graded[0].grade.actual_final_margin, 7);
  assert.equal(result.graded[0].grade.actual_total, 47);
  assert.equal(result.graded[0].grade.official_results_eligible, false);
  assert.equal(result.graded[0].grade.official_bankroll_eligible, false);

  const after = await store.load();
  assert.equal(JSON.stringify({ latest_cards: after.latest_cards, audit: after.audit, locks: after.locks, bankroll: after.bankroll }), official);

  const duplicate = await shadow.gradeMany({
    sport: grading.NFL,
    results: [{ game_id: '2026_01_MIA_BUF', home_score: 27, away_score: 20, completed_at: '2026-09-14T00:00:00Z', closing_market: { home_spread: -3, total: 47 } }]
  });
  assert.equal(duplicate.graded.length, 0);
  assert.deepEqual(duplicate.skipped, [{ game_id: '2026_01_MIA_BUF', reason: 'ALREADY_GRADED' }]);

  const revision = await shadow.gradeMany({
    sport: grading.NFL,
    results: [{ game_id: '2026_01_MIA_BUF', home_score: 27, away_score: 21, completed_at: '2026-09-14T00:00:00Z', closing_market: { home_spread: -3, total: 47 } }]
  });
  assert.equal(revision.graded[0].revised, true);
  assert.equal(revision.graded[0].grade.grade_revision, 2);
  assert.ok(revision.graded[0].grade.supersedes_result_fingerprint);
});

test('scoreboard exposes research metrics and never authorizes automatic promotion', async () => {
  const board = await shadow.scoreboard({ sport: grading.NFL });
  assert.equal(board.shadow_only, true);
  assert.equal(board.current_champion, 'NFL_v1.0_FEATURE_ABLATION');
  assert.equal(board.graded_games, 1);
  assert.equal(board.margin_mae, 3);
  assert.equal(board.total_mae, 1);
  assert.ok(Number.isFinite(board.cover_brier));
  assert.ok(Number.isFinite(board.over_brier));
  assert.equal(board.monitoring_state, 'INSUFFICIENT_SAMPLE');
  assert.equal(board.automatic_promotion_allowed, false);
  assert.equal(board.market_challenger, 'NFL_v0.9_MARKET_CHALLENGER_CALIBRATION');
  assert.equal(board.blind_margin_mae, board.margin_mae);
  assert.equal(board.calibrated_total_mae, board.post_market_total_mae);
  assert.ok(board.firewall_bucket_performance);
  assert.ok(board.model_vs_market_error_wins);
  assert.ok(board.data_quality_grades);
  assert.match(board.sample_warning, /No promotion inference/);
});

test('shadow automation errors are isolated from production state', async () => {
  const before = await store.load();
  const official = JSON.stringify({ latest_cards: before.latest_cards, audit: before.audit, locks: before.locks, bankroll: before.bankroll });
  const saved = await shadow.recordError({ sport: grading.NFL, stage: 'market_capture', game_id: 'missing-market', error: 'provider unavailable' });
  assert.equal(saved.error.production_affected, false);
  const after = await store.load();
  assert.equal(after.shadow_engines.errors.length, 1);
  assert.equal(JSON.stringify({ latest_cards: after.latest_cards, audit: after.audit, locks: after.locks, bankroll: after.bankroll }), official);
});

test('server exposes protected shadow grade/error routes and read-only scoreboard', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /POST'&&u\.pathname==='\/api\/shadow\/grade'[\s\S]+validShadowIngest/);
  assert.match(source, /POST'&&u\.pathname==='\/api\/shadow\/errors'[\s\S]+validShadowIngest/);
  assert.match(source, /GET'&&u\.pathname==='\/api\/shadow\/scoreboard'/);
  assert.match(source, /GET'&&u\.pathname==='\/api\/shadow\/blinds'/);
  assert.match(source, /POST'&&u\.pathname==='\/api\/shadow\/blinds\/backfill'/);
  assert.match(source, /GET'&&u\.pathname==='\/api\/shadow\/scheduler-state'/);
});
