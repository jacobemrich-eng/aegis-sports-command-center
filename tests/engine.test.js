const test = require('node:test');
const assert = require('node:assert/strict');
const e = require('../src/engine');

test('engine metadata loads', () => {
  assert.equal(e.VERSION, '8.0.0-autopilot-integrity');
  assert.equal(e.MODELS.length, 59);
  assert.equal(e.SPORTS.length, 7);
});

test('strict team identity blocks shared-city collisions', () => {
  assert.equal(e.sameTeam('Los Angeles Dodgers', 'Los Angeles Angels'), false);
  assert.equal(e.sameTeam('West Georgia Wolves', 'Georgia Bulldogs'), false);
  assert.equal(e.sameTeam('New York Yankees', 'New York Yankees'), true);
});

test('MLB period market parser recognizes inning scopes', () => {
  assert.equal(e.mlbPeriodInnings('spreads_1st_5_innings'), 5);
  assert.equal(e.mlbPeriodInnings('totals_1st_3_innings'), 3);
  assert.equal(e.mlbPeriodInnings('totals_1st_1_innings'), 1);
  assert.equal(e.mlbPeriodInnings('totals'), null);
});

test('F5 spread grades from first-five score, not final score', () => {
  const r = {market:'spreads_1st_5_innings',selection:'New York Yankees',point:-0.5,home_team:'New York Yankees',away_team:'Boston Red Sox'};
  const score = {final:true,home_score:4,away_score:7,period_scores:{5:{home:3,away:2}}};
  assert.equal(e.settledBetOutcome(r,score), 'WIN');
});

test('F3 total and first-inning total grade correctly', () => {
  const f3 = {market:'totals_1st_3_innings',selection:'Over',point:2.5,home_team:'A',away_team:'B'};
  const f1 = {market:'totals_1st_1_innings',selection:'Under',point:0.5,home_team:'A',away_team:'B'};
  const score = {final:true,home_score:4,away_score:2,period_scores:{1:{home:0,away:0},3:{home:2,away:1}}};
  assert.equal(e.settledBetOutcome(f3,score), 'WIN');
  assert.equal(e.settledBetOutcome(f1,score), 'WIN');
});


test('CFBD matcher rejects generic North Carolina for North Carolina A&T', () => {
  const rows=[{team:'North Carolina',rating:10},{team:'Georgia State',rating:-20}];
  const m=e.findRatingMatch(rows,'North Carolina A&T Aggies');
  assert.equal(m.row,null);
});

test('CFBD matcher accepts exact school after mascot stripping', () => {
  const rows=[{team:'West Georgia',rating:-5},{team:'Georgia',rating:20}];
  const m=e.findRatingMatch(rows,'West Georgia Wolves');
  assert.equal(m.row.team,'West Georgia');
});

test('CFBD matcher accepts North Carolina Tar Heels without confusing A&T', () => {
  const rows=[{team:'North Carolina',rating:10},{team:'North Carolina A&T',rating:-15}];
  const m=e.findRatingMatch(rows,'North Carolina Tar Heels');
  assert.equal(m.row.team,'North Carolina');
});

test('NCAAF cross-class baseline points toward FBS team without comparing raw rating scales', () => {
  assert.equal(e.ncaafCrossClassBaseline('fbs','non-fbs'), 21);
  assert.equal(e.ncaafCrossClassBaseline('non-fbs','fbs'), -21);
  assert.equal(e.ncaafCrossClassBaseline('fbs','fbs'), 0);
});


test('CFBD records classification identifies FBS/FCS explicitly', () => {
  const rows=[
    {team:'Georgia State',classification:'fbs',conference:'Sun Belt'},
    {team:'North Carolina A&T',classification:'fcs',conference:'CAA'},
    {team:'Purdue',classification:'fbs',conference:'Big Ten'},
    {team:'Indiana State',classification:'fcs',conference:'MVFC'}
  ];
  assert.equal(e.classificationMatch(rows,'North Carolina A&T Aggies').class,'fcs');
  assert.equal(e.classificationMatch(rows,'Georgia State Panthers').class,'fbs');
  assert.equal(e.classificationMatch(rows,'Indiana State Sycamores').class,'fcs');
  assert.equal(e.classificationMatch(rows,'Purdue Boilermakers').class,'fbs');
});

test('explicit classification overrides misleading or missing conference inference', () => {
  const fcs={class:'fcs'};
  const fbs={class:'fbs'};
  assert.equal(e.resolvedNcaafClass(fcs,{conference:'Independent'}),'fcs');
  assert.equal(e.resolvedNcaafClass(fbs,{conference:'Unknown'}),'fbs');
});


test('CFBD scheduled-game classification matcher keeps FBS/FCS identity exact', () => {
  const rows=[
    {homeTeam:'Georgia State',awayTeam:'North Carolina A&T',homeClassification:'fbs',awayClassification:'fcs',startDate:'2026-09-05T19:00:00Z'},
    {homeTeam:'North Carolina',awayTeam:'TCU',homeClassification:'fbs',awayClassification:'fbs',startDate:'2026-09-05T19:00:00Z'}
  ];
  const event={home_team:'Georgia State Panthers',away_team:'North Carolina A&T Aggies',commence_time:'2026-09-05T19:00:00Z'};
  const m=e.cfbdGameMatch(rows,event);
  assert.equal(m.homeClassification,'fbs');
  assert.equal(m.awayClassification,'fcs');
  assert.equal(m.homeTeam,'Georgia State');
});

test('cross-class baseline is symmetric and favors the FBS classification', () => {
  assert.equal(e.ncaafCrossClassBaseline('fbs','fcs'),21);
  assert.equal(e.ncaafCrossClassBaseline('fcs','fbs'),-21);
});

test('execution bands get stricter from play-to to downgrade to pass', () => {
  const b=e.executionBands(.58,.035);
  assert.equal(b.play_to,-120);
  assert.equal(b.downgrade_at,-125);
  assert.equal(b.pass_at,-138);
  assert.ok(b.core_required_probability < b.secondary_required_probability);
  assert.ok(b.secondary_required_probability < b.break_even_probability);
});

test('freshness gate is A only when critical MLB inputs are current and verified', () => {
  const event={sport_key:'baseball_mlb',commence_time:new Date(Date.now()+6*3600e3).toISOString()};
  const proj={data_quality:92,probable_starters_confirmed:true,lineups_confirmed:true,bullpen_verified:true};
  const c={last_update:new Date().toISOString(),market_coverage:90,market_consensus_books:4};
  assert.equal(e.dataFreshnessGrade(event,proj,c).grade,'A');
});

test('freshness gate becomes C when an MLB probable starter is unresolved', () => {
  const event={sport_key:'baseball_mlb',commence_time:new Date(Date.now()+2*3600e3).toISOString()};
  const proj={data_quality:92,probable_starters_confirmed:false,lineups_confirmed:true,bullpen_verified:true};
  const c={last_update:new Date().toISOString(),market_coverage:90,market_consensus_books:4};
  const q=e.dataFreshnessGrade(event,proj,c);
  assert.equal(q.grade,'C');
  assert.match(q.critical.join(' '),/probable starters/i);
});


test('small-sample MLB starter regression shrinks extreme rate stats', () => {
  const r=e.starterRegression({
    era:'18.00',
    inningsPitched:'3.0',
    strikeOuts:4,
    baseOnBalls:3,
    hitBatsmen:0,
    homeRuns:2,
    battersFaced:17,
    whip:'2.33',
    strikeoutsPer9Inn:'12.00',
    walksPer9Inn:'9.00',
    homeRunsPer9:'6.00'
  },4.35);

  assert.equal(r.active,true);
  assert.equal(r.severe,true);
  assert.ok(r.rawEra>10);
  assert.ok(r.rawFip>10);
  assert.ok(r.era>4.35&&r.era<6);
  assert.ok(r.fip>4.35&&r.fip<6);
  assert.ok(r.sampleWeight<.10);
});

test('established MLB starter sample keeps most observed ERA signal', () => {
  const r=e.starterRegression({
    era:'3.00',
    inningsPitched:'180.0',
    strikeOuts:190,
    baseOnBalls:50,
    hitBatsmen:4,
    homeRuns:20,
    battersFaced:730,
    whip:'1.10',
    strikeoutsPer9Inn:'9.50',
    walksPer9Inn:'2.50',
    homeRunsPer9:'1.00'
  },4.35);

  assert.equal(r.active,false);
  assert.ok(r.sampleWeight>.75);
  assert.ok(Math.abs(r.era-3.00)<.40);
});
