'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('../src/gametwin-matchup');
const g=require('../src/gametwin');

const base={K:.22,BB:.09,HBP:.01,'1B':.16,'2B':.05,'3B':.004,HR:.032,OUT:.434};

test('handedness split gets meaningful but shrink-limited weight',()=>{
  const b={bat_side:'R',pa:base,splits:{vs_left:{sample:160,profile:{...base,HR:.075,OUT:.391}}}};
  const p={pitch_hand:'L',allowed:base};
  const d=g.matchupDetail(b,p,{run_factor:1,hr_factor:1},{});
  assert.ok(d.profile.HR>base.HR);
  assert.ok(d.profile.HR<.075);
  assert.equal(d.diagnostics.batter_split_used,true);
});

test('pitch arsenal interaction recognizes batter strength against heavily used pitch',()=>{
  const batter={pitch_type_stats:[{pitch_type:'FF',xwoba:.430,whiff_pct:18},{pitch_type:'SL',xwoba:.250,whiff_pct:35}]};
  const pitcher={arsenal:[{pitch_type:'FF',usage:70,xwoba:.350,whiff_pct:20},{pitch_type:'SL',usage:30,xwoba:.280,whiff_pct:36}]};
  const r=m.pitchTypeMatchupFactor(batter,pitcher);
  assert.ok(r.coverage>.95);
  assert.ok(r.factor>1);
});

test('times-through-order adjustment degrades a starter on third trip',()=>{
  const first=m.timesThroughOrderAdjustment({is_starter:true,pitcher_batters_faced:3});
  const third=m.timesThroughOrderAdjustment({is_starter:true,pitcher_batters_faced:21});
  assert.equal(first.tto,1);assert.equal(third.tto,3);
  assert.ok(third.run_factor>first.run_factor);assert.ok(third.k_factor<first.k_factor);
});

test('bullpen selector favors fresh closer in late leverage',()=>{
  const team={bullpen:[
    {name:'Tired Setup',role:'setup',pitch_hand:'R',available:true,workload:{penalty:.88}},
    {name:'Fresh Closer',role:'closer',pitch_hand:'R',available:true,workload:{penalty:1}}
  ]};
  assert.equal(m.chooseReliever(team,{bat_side:'R'},9,1,new Set()).name,'Fresh Closer');
});
