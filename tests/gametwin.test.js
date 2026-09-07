'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/gametwin');

function lineup(prefix, hr=.032){
  return Array.from({length:9},(_,i)=>({
    name:`${prefix} Batter ${i+1}`,
    pa:{K:.225,BB:.085,HBP:.010,'1B':.155,'2B':.048,'3B':.004,HR:hr,OUT:.441}
  }));
}
function spec(){
  return {
    date:'2026-09-04',
    away:{name:'Atlanta Braves',lineup:lineup('ATL'),starter:{name:'ATL Starter',max_innings:6},bullpen:[{name:'ATL Setup',role:'setup'},{name:'ATL Closer',role:'closer'}]},
    home:{name:'Washington Nationals',lineup:lineup('WSH'),starter:{name:'WSH Starter',max_innings:6},bullpen:[{name:'WSH Setup',role:'setup'},{name:'WSH Closer',role:'closer'}]},
    environment:{run_factor:1,hr_factor:1,verified:true},
    lineups_confirmed:true,bullpen_verified:true
  };
}

test('GameTwin validates complete MLB game specs',()=>{
  assert.equal(g.validateGameSpec(spec()),true);
  const bad=spec();bad.home.lineup=[];
  assert.throws(()=>g.validateGameSpec(bad),/lineup/i);
});

test('seeded single-game simulation is deterministic',()=>{
  const a=g.simulateGame(spec(),{seed:'same-seed'});
  const b=g.simulateGame(spec(),{seed:'same-seed'});
  assert.deepEqual(a.final,b.final);
  assert.deepEqual(a.innings,b.innings);
  assert.ok(a.play_by_play.length>0);
});

test('full simulations produce coherent market probabilities',()=>{
  const r=g.runSimulations(spec(),{simulations:300,seed:'market-test'});
  assert.equal(r.simulations,300);
  assert.ok(Math.abs(r.win_probability.home+r.win_probability.away-1)<1e-9);
  assert.ok(r.projected_score.total>0);
  assert.ok(r.markets.over_8_5>=0&&r.markets.over_8_5<=1);
  assert.equal(r.integration.aegis_weight,0);
  assert.equal(r.integration.release_eligible,false);
});

test('verified weather/park HR boost raises hitter HR probability',()=>{
  const base=spec();
  const hot=spec();hot.environment={run_factor:1.08,hr_factor:1.30,verified:true};
  const a=g.runSimulations(base,{simulations:1000,seed:'weather'});
  const b=g.runSimulations(hot,{simulations:1000,seed:'weather'});
  const name='ATL Batter 1';
  assert.ok(b.players.away[name].HR_probability>=a.players.away[name].HR_probability);
});

test('representative game contains nine or more innings and named batters',()=>{
  const r=g.runSimulations(spec(),{simulations:100,seed:'rep'});
  assert.ok(r.representative_game.final.innings>=9);
  assert.ok(r.representative_game.play_by_play.some(e=>String(e.batter||'').includes('Batter')));
});

test('GameTwin v0.3 produces starting-pitcher K and outs distributions',()=>{
  const s=spec();
  s.away.starter={name:'ATL Starter',max_innings:6,max_pitches:95,allowed:{K:.27,BB:.07,HBP:.01,'1B':.145,'2B':.045,'3B':.003,HR:.025,OUT:.452}};
  s.home.starter={name:'WSH Starter',max_innings:6,max_pitches:95,allowed:{K:.20,BB:.09,HBP:.01,'1B':.17,'2B':.05,'3B':.004,HR:.035,OUT:.441}};
  const r=g.runSimulations(s,{simulations:500,seed:'pitcher-props'});
  const p=r.pitchers.away['ATL Starter'];
  assert.ok(p.K>0);assert.ok(p.outs>0);assert.ok(p.pitches>0);
  assert.ok(p.probabilities.K_over_4_5>=0&&p.probabilities.K_over_4_5<=1);
  assert.ok(p.probabilities.outs_over_17_5>=0&&p.probabilities.outs_over_17_5<=1);
});
