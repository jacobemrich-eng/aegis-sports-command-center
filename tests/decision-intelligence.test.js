const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const decision = require('../src/decision');
const engine = require('../src/engine');

const ROOT = path.join(__dirname, '..');

function base(overrides={}){
  return {
    event_id:'e1',
    tier:'CORE',
    hard_rock:true,
    data_quality_grade:'A',
    price:-110,
    play_to:-120,
    downgrade_at:-130,
    pass_at:-145,
    adjusted_edge:.05,
    cushion:.035,
    estimated_ev:.04,
    market_support_strength:78,
    market_coverage:84,
    market_effective_agreement:76,
    decision_quality:88,
    market_consensus_books:4,
    independent_disagreement:.03,
    market_inside_fair_range:false,
    market:'h2h',
    selection:'Alpha',
    units:1,
    timing:'BET NOW if target-book line still matches',
    sanity_flags:[],
    ...overrides
  };
}

const projection = {
  lineups_confirmed:true,
  bullpen_verified:true,
  probable_starters_confirmed:true
};

const event = {
  sport_key:'baseball_mlb'
};

test('v8.8 engine identity is explicit', () => {
  assert.equal(
    engine.VERSION,
    '8.8.0-decision-intelligence'
  );
});

test('robust Core survives the adverse-scenario stress gate', () => {
  const x = decision.enrichCandidate(
    base(),
    projection,
    event
  );

  assert.equal(x.tier, 'CORE');
  assert.equal(x.stress_test.core_robust, true);
  assert.ok(x.stress_test.secondary_survivals >= 3);
  assert.ok(x.stress_test.core_survivals >= 1);
});

test('marginal Core is downgraded instead of being forced', () => {
  const x = decision.enrichCandidate(
    base({
      adjusted_edge:.035,
      estimated_ev:.021
    }),
    projection,
    event
  );

  assert.equal(x.tier, 'SECONDARY');
  assert.equal(x.stress_test.core_robust, false);
  assert.ok(
    x.sanity_flags.some(
      v => /Stress-Test Gate v2/.test(v)
    )
  );
});

test('adverse Hard Rock movement beyond pass line is an automatic CUT', () => {
  const x = decision.enrichCandidate(
    base({price:-160}),
    projection,
    event
  );

  assert.equal(x.execution_state, 'PASS_PRICE');
  assert.equal(x.tier, 'PASS');
});

test('Hard Rock Secondary execution band downgrades a Core candidate', () => {
  const x = decision.enrichCandidate(
    base({price:-125}),
    projection,
    event
  );

  assert.equal(
    x.execution_state,
    'SECONDARY_BAND'
  );

  assert.equal(x.tier, 'SECONDARY');
});

test('unverified target book cannot remain actionable', () => {
  const x = decision.enrichCandidate(
    base({
      hard_rock:false,
      book:'FanDuel'
    }),
    projection,
    event
  );

  assert.equal(x.tier, 'WATCH');
  assert.equal(
    x.execution_state,
    'WAIT_TARGET_BOOK'
  );
});

test('market selection prefers the simpler primary expression when derivative advantage is marginal', () => {
  const primary = decision.enrichCandidate(
    base({
      tier:'SECONDARY',
      market:'h2h',
      adjusted_edge:.038,
      cushion:.035,
      decision_quality:78
    }),
    projection,
    event
  );

  const derivative = decision.enrichCandidate(
    base({
      tier:'SECONDARY',
      market:'spreads_1st_5_innings',
      adjusted_edge:.039,
      cushion:.035,
      decision_quality:79
    }),
    projection,
    event
  );

  assert.equal(
    decision.chooseBestExpression(
      [primary, derivative],
      event,
      projection
    ).market,
    'h2h'
  );
});

test('materially stronger derivative may win market selection', () => {
  const primary = decision.enrichCandidate(
    base({
      tier:'SECONDARY',
      market:'h2h',
      adjusted_edge:.038,
      cushion:.035,
      decision_quality:78
    }),
    projection,
    event
  );

  const derivative = decision.enrichCandidate(
    base({
      tier:'SECONDARY',
      market:'spreads_1st_5_innings',
      adjusted_edge:.07,
      cushion:.035,
      estimated_ev:.08,
      market_support_strength:90,
      decision_quality:88
    }),
    projection,
    event
  );

  assert.equal(
    decision.chooseBestExpression(
      [primary, derivative],
      event,
      projection
    ).market,
    'spreads_1st_5_innings'
  );
});

test('cross-slate discipline preserves Core cap two and Top-3 actionable scarcity', () => {
  const rows = [
    base({event_id:'e1'}),
    base({event_id:'e2'}),
    base({event_id:'e3'}),
    base({
      event_id:'e4',
      tier:'SECONDARY',
      units:.5,
      decision_quality:78
    }),
    base({
      event_id:'e5',
      tier:'SECONDARY',
      units:.5,
      decision_quality:76
    })
  ].map(
    x => decision.enrichCandidate(
      x,
      projection,
      event
    )
  );

  decision.applySlateDiscipline(rows);

  assert.ok(
    rows.filter(x => x.tier === 'CORE').length <= 2
  );

  assert.ok(
    rows.filter(
      x => ['CORE','SECONDARY'].includes(x.tier)
    ).length <= 3
  );

  assert.ok(rows.some(x => x.slate_cut));
});

test('parlay firewall requires independently executable distinct-game legs', () => {
  const a = decision.enrichCandidate(
    base({event_id:'e1'}),
    projection,
    event
  );

  const b = decision.enrichCandidate(
    base({
      event_id:'e2',
      selection:'Beta'
    }),
    projection,
    event
  );

  a.timing = 'BET NOW if target-book line still matches';
  b.timing = 'BET NOW if target-book line still matches';

  const rows = decision.applySlateDiscipline([a,b]);
  const parlay = decision.buildParlay(rows);

  assert.ok(parlay);
  assert.equal(parlay.firewall, 'CLEARED');
  assert.equal(parlay.legs.length, 2);
  assert.notEqual(
    parlay.legs[0].event_id,
    parlay.legs[1].event_id
  );
});

test('parlay firewall refuses WATCH or non-executable legs', () => {
  const a = decision.enrichCandidate(
    base({event_id:'e1'}),
    projection,
    event
  );

  const b = decision.enrichCandidate(
    base({
      event_id:'e2',
      selection:'Beta',
      price:-140
    }),
    projection,
    event
  );

  a.timing = 'BET NOW if target-book line still matches';
  b.timing = 'WAIT — current price is outside Secondary band';

  const rows = decision.applySlateDiscipline([a,b]);

  assert.equal(
    decision.buildParlay(rows),
    null
  );
});

test('engine, audit and Final Card are wired to Decision Intelligence', () => {
  const engineSource = fs.readFileSync(
    path.join(ROOT, 'src/engine.js'),
    'utf8'
  );

  const autopilotSource = fs.readFileSync(
    path.join(ROOT, 'src/autopilot.js'),
    'utf8'
  );

  const finalCardSource = fs.readFileSync(
    path.join(ROOT, 'public/app-v8_6.js'),
    'utf8'
  );

  assert.match(
    engineSource,
    /decision\.enrichCandidate/
  );

  assert.match(
    engineSource,
    /decision\.applySlateDiscipline/
  );

  assert.match(
    engineSource,
    /decision\.buildParlay/
  );

  assert.match(
    autopilotSource,
    /stress_score:/
  );

  assert.match(
    finalCardSource,
    /Stress survival/
  );

  assert.match(
    finalCardSource,
    /supportSecondary=\(mlb\|\|ncaaf\)\?60:42/
  );
});
