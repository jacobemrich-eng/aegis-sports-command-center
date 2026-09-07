const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-shadow-'));
process.env.AEGIS_DATA_DIR = tmp;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.NFL_SIM_ENABLED = 'true';
process.env.NFL_SIM_SHADOW_ONLY = 'true';
process.env.AEGIS_NEW_ENGINE_AUTO_RELEASE = 'false';

const contract = require('../src/sport-engines/contract');
const flags = require('../src/sport-engines/feature-flags');
const registry = require('../src/sport-engines/registry');
const nfl = require('../src/sport-engines/adapters/nfl-adapter');
const nflMarket = require('../src/sport-engines/nfl-market-challenger');
const shadow = require('../src/shadow-service');
const store = require('../src/store');

function nflOutput(overrides = {}) {
  return {
    schema_version: 'AEGIS_STANDARD_GAME_OUTPUT_v1',
    sport: 'NFL',
    engine_version: 'NFL_v1.0_FEATURE_ABLATION',
    generated_at: '2026-09-13T12:00:00Z',
    game: { id: 'nfl-game-1', home: 'Buffalo Bills', away: 'Miami Dolphins', start_time: '2026-09-13T17:00:00Z' },
    blind_features: ['home_epa_prior', 'away_pressure_rate_prior', 'qb_availability'],
    projection: {
      mean_home: 27,
      mean_away: 23,
      mean_home_margin: 4,
      mean_total: 50,
      home_ml: 0.62,
      away_ml: 0.38,
      spread_probabilities: { home: 0.57, away: 0.43 },
      total_probabilities: { over: 0.54, under: 0.46 },
      percentiles: { margin: { p10: -12, p50: 4, p90: 19 } }
    },
    quality: {
      data_quality_score: 0.91,
      data_quality_grade: 'B',
      ensemble_dispersion: 2.2,
      ensemble_agreement: 'MODERATE',
      simulation_uncertainty_multiplier: 1.08
    },
    diagnostics: {
      why_it_wins: ['Pressure advantage creates short fields.'],
      how_it_loses: ['Explosive plays overwhelm the coverage shell.'],
      tail_risks: ['Wide score distribution.']
    },
    ...overrides
  };
}

const market = {
  captured_at: '2026-09-13T12:05:00Z',
  challenger_projection: { margin: 2, total: 48 },
  best_market_expression: { name: 'Buffalo -3', market_type: 'spreads', point: -3, odds: -110 },
  decision_status: 'CORE_CANDIDATE',
  execution_status: 'BET_NOW',
  implied_probability: 0.524,
  fair_probability: 0.55,
  ev: 0.05,
  play_to: -3
};

test('NFL adapter emits the shared schema with permanent shadow release guards', () => {
  const row = nfl.adapt(nflOutput(), { market });
  const checked = contract.validateStandardOutput(row, 'americanfootball_nfl');
  assert.equal(checked.ok, true, checked.errors.join(','));
  assert.equal(row.schema_version, contract.SCHEMA_VERSION);
  assert.equal(row.decision.status, 'CORE_CANDIDATE');
  assert.equal(row.engine_version, 'NFL_v1.0_FEATURE_ABLATION');
  assert.equal(row.governance.internal_champion, 'NFL_v1.0_FEATURE_ABLATION');
  assert.equal(row.governance.historical_predecessor, 'NFL_v0.8_FEATURE_HYGIENE');
  assert.equal(row.governance.internal_promotion_gate, 'PROMOTE_V10_INTERNAL_CHALLENGER');
  assert.equal(row.market.challenger_engine_version, 'NFL_v0.9_MARKET_CHALLENGER_CALIBRATION');
  assert.equal(row.governance.official_final_card_eligible, false);
  assert.equal(row.governance.official_bankroll_eligible, false);
  assert.equal(row.governance.auto_release_allowed, false);
  assert.deepEqual(row.governance.pipeline_order, [
    'blind_internal_projection',
    'market_challenger',
    'post_model_calibration',
    'disagreement_firewall',
    'aegis_governance'
  ]);
});

test('committed v0.9 calibration runs only after v1.0 blind output', () => {
  const row = nfl.adapt(nflOutput(), { market });
  const marginWeight = nflMarket.learnedWeights('1-2').margin;
  const totalWeight = nflMarket.learnedWeights('1-2').total;
  assert.ok(Math.abs(row.market.post_model_projection.margin - (marginWeight * 4 + (1 - marginWeight) * 2)) < 1e-12);
  assert.ok(Math.abs(row.market.post_model_projection.total - (totalWeight * 50 + (1 - totalWeight) * 48)) < 1e-12);
  assert.equal(row.diagnostics.sport_specific.market_challenger.market_remains_independent_challenger, true);
  assert.deepEqual(row.governance.pipeline_timestamps, {
    blind_generated_at: '2026-09-13T12:00:00.000Z',
    market_captured_at: '2026-09-13T12:05:00.000Z'
  });
});

test('adapter rejects predecessor, mixed payloads, and market-before-model ordering', () => {
  assert.throws(
    () => nfl.adapt(nflOutput({ engine_version: 'NFL_v0.8_FEATURE_HYGIENE' }), { market }),
    /current internal Champion/
  );
  assert.throws(
    () => nfl.adapt(nflOutput({ market: { challenger_projection: { margin: 2, total: 48 } } }), { market }),
    /contains post-model market data/
  );
  assert.throws(
    () => nfl.adapt(nflOutput(), { market: { ...market, captured_at: '2026-09-13T11:59:00Z' } }),
    /must run after the blind/
  );
  assert.throws(
    () => nfl.adapt(nflOutput(), { market: { ...market, challenger_projection: null } }),
    /Market Challenger margin and total are required/
  );
});

test('NFL disagreement firewall preserves PASS and Core caps', () => {
  assert.equal(nfl.disagreementFirewall(8, 48, { margin: 1, total: 48 }).status, 'PASS');
  assert.equal(nfl.disagreementFirewall(6, 48, { margin: 0, total: 48 }).status, 'SECONDARY_MAX');
  assert.equal(nfl.disagreementFirewall(4, 48, { margin: 0, total: 48 }).status, 'CORE_BLOCK');
  assert.equal(nfl.disagreementFirewall(2, 48, { margin: 0, total: 48 }).status, 'NORMAL');

  const pass = nfl.adapt(nflOutput(), { market: { ...market, challenger_projection: { margin: -4, total: 50 } } });
  assert.equal(pass.decision.status, 'PASS');
  assert.equal(pass.decision.execution_status, 'PASS');
  const capped = nfl.adapt(nflOutput(), { market: { ...market, challenger_projection: { margin: -2, total: 50 } } });
  assert.equal(capped.decision.status, 'SECONDARY');
});

test('blind NFL features reject sportsbook, identifier, and postgame leakage', () => {
  for (const feature of ['sportsbook_spread', 'closing_line', 'final_score', 'postgame_overtime', 'provider_id', 'future_injury_status']) {
    assert.throws(() => nfl.adapt(nflOutput({ blind_features: [feature] }), { market }), /feature hygiene failed/);
  }
  assert.doesNotThrow(() => nfl.adapt(nflOutput({ blind_features: ['offensive_line_strength', 'total_offensive_epa_prior'] }), { market }));
});

test('sport registry cannot route NCAAF or MLB through the NFL engine', () => {
  assert.equal(registry.adapterFor('americanfootball_nfl').SPORT_KEY, 'americanfootball_nfl');
  assert.equal(registry.adapterFor('americanfootball_ncaaf').SPORT_KEY, 'americanfootball_ncaaf');
  assert.equal(registry.adapterFor('baseball_mlb').SPORT_KEY, 'baseball_mlb');
  assert.throws(() => registry.adapt('americanfootball_ncaaf', nflOutput(), {}), /NCAAF simulator adapter is reserved/);
  assert.throws(() => registry.adapt('baseball_mlb', nflOutput(), {}), /MLB simulator adapter is reserved/);
  assert.throws(() => nfl.adapt({ ...nflOutput(), sport: 'NCAAF' }, { market }), /cannot accept sport/);
});

test('feature flags default to NFL shadow and disable all new-engine auto-release', () => {
  const current = flags.flags();
  assert.equal(current.NFL_SIM_ENABLED, true);
  assert.equal(current.NFL_SIM_SHADOW_ONLY, true);
  assert.equal(current.NCAAF_SIM_SHADOW_ONLY, true);
  assert.equal(current.MLB_SIM_SHADOW_ONLY, true);
  assert.equal(current.AEGIS_NEW_ENGINE_AUTO_RELEASE, false);
});

test('shadow persistence is separate from official card, audit, locks, and bankroll', async () => {
  const before = await store.load();
  assert.equal((before.audit || []).length, 0);
  assert.equal((before.locks || []).length, 0);
  assert.deepEqual(before.latest_cards, {});

  const saved = await shadow.ingest({ sport: 'americanfootball_nfl', engine_output: nflOutput(), market });
  assert.equal(saved.record.release_status, 'SHADOW_ONLY');
  assert.equal(saved.record.official_bankroll_eligible, false);

  store.resetMemory();
  const after = await store.load();
  assert.equal(after.shadow_engines.games.americanfootball_nfl['nfl-game-1'].game_id, 'nfl-game-1');
  assert.equal(after.shadow_engines.audit.length, 1);
  assert.equal(after.audit.length, 0);
  assert.equal(after.locks.length, 0);
  assert.deepEqual(after.latest_cards, {});
});

test('simulator failure and missing shadow data leave a clean empty fallback', async () => {
  await assert.rejects(() => shadow.ingest({ sport: 'americanfootball_nfl', engine_output: null, market }), /engine output is required/);
  const result = await shadow.list({ sport: 'americanfootball_nfl', game_id: 'missing-game' });
  assert.deepEqual(result.games, []);
  assert.equal(result.shadow_only, true);
});

test('shadow service refuses the global auto-release flag even when set', () => {
  process.env.AEGIS_NEW_ENGINE_AUTO_RELEASE = 'true';
  try {
    assert.throws(() => shadow.assertShadowEnabled('americanfootball_nfl'), /not permitted/);
  } finally {
    process.env.AEGIS_NEW_ENGINE_AUTO_RELEASE = 'false';
  }
});

test('postgame audit taxonomy remains available to the separate shadow ledger', () => {
  assert.deepEqual(contract.POSTGAME_AUDIT_LABELS, [
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
});

test('server, Render, and mobile UI retain explicit shadow isolation', () => {
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const render = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'public/nfl-shadow-integration.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/nfl-shadow-integration.css'), 'utf8');
  const publisher = fs.readFileSync(path.join(root, 'modeling/nfl/aegis_nfl_shadow_publisher.py'), 'utf8');
  assert.match(server, /\/api\/shadow\/games/);
  assert.match(server, /shadow_saved:false,production_fallback:true/);
  assert.match(render, /NFL_SIM_SHADOW_ONLY[\s\S]+value: "true"/);
  assert.match(render, /AEGIS_NEW_ENGINE_AUTO_RELEASE[\s\S]+value: "false"/);
  assert.match(html, /nfl-shadow-integration\.js/);
  assert.match(ui, /CURRENT AEGIS/);
  assert.match(ui, /NFL SIMULATOR/);
  assert.match(ui, /MARKET PROJECTION/);
  assert.match(ui, /cannot enter the official Final Card or bankroll ledger/);
  assert.match(ui, /Missing or failed shadow data falls back cleanly/);
  assert.match(ui, /NFL v1\.0 internal shadow Champion/);
  assert.match(ui, /v0\.8 HISTORICAL PREDECESSOR/);
  assert.match(publisher, /NFL_v1\.0_FEATURE_ABLATION/);
  assert.match(publisher, /Market Challenger capture must occur after the blind internal projection/);
  assert.match(publisher, /NFL shadow publish failed safely/);
  assert.doesNotMatch(publisher, /print\s*\([^\n]*token/);
  assert.match(css, /@media\(max-width:720px\)/);
});
