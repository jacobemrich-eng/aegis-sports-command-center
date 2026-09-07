'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('../src/gametwin-market');

const projection={teams:{away:'Braves',home:'Nationals'},score_distribution:{'3-2':.25,'2-4':.35,'5-3':.20,'1-1':.20},players:{away:{'Ronald Acuna Jr.':{distributions:{H:{0:.30,1:.45,2:.20,3:.05},TB:{0:.40,1:.25,2:.20,4:.15},HR:{0:.82,1:.17,2:.01}}}},home:{}},pitchers:{away:{'Spencer Strider':{distributions:{K:{5:.20,6:.30,7:.30,8:.20},OUTS:{15:.10,18:.60,21:.30},ER:{1:.35,2:.35,3:.20,4:.10}}}},home:{}}};

test('arbitrary game lines evaluate from score distribution',()=>{
  const total=m.evaluateQuote(projection,{market:'total',selection:'over',point:6.5,price:-110});
  assert.equal(total.supported,true);assert.ok(total.win_probability>0&&total.win_probability<1);
  const rl=m.evaluateQuote(projection,{market:'run_line',selection:'Braves',point:1.5,price:-120});
  assert.equal(rl.supported,true);assert.ok(rl.fair_probability>.5);
});

test('exact player and pitcher prop lines evaluate with push handling',()=>{
  const hits=m.evaluateQuote(projection,{market:'player_hits',player:'Ronald Acuna Jr.',selection:'over',point:1,price:+105});
  assert.equal(hits.push_probability,.45);assert.equal(hits.win_probability,.25);assert.equal(hits.lose_probability,.30);
  const ks=m.evaluateQuote(projection,{market:'pitcher_strikeouts',player:'Spencer Strider',selection:'over',point:6.5,price:-115});
  assert.equal(ks.win_probability,.5);assert.equal(ks.push_probability,0);
});

test('two-sided boards calculate de-vig probabilities without release authority',()=>{
  const rows=m.evaluateBoard(projection,[{market:'total',selection:'over',point:6.5,price:-115},{market:'total',selection:'under',point:6.5,price:-105}]);
  assert.equal(rows.length,2);assert.ok(rows[0].market_devig_probability>0);assert.ok(rows[1].market_devig_probability>0);assert.equal(rows[0].release_eligible,false);
});
