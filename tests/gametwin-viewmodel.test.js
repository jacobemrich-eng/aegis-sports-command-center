'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const vm=require('../src/gametwin-viewmodel');

function card(){return {gamePk:1,away:'Atlanta Braves',home:'Washington Nationals',status:'READY',simulations:25000,projected_score:{away:5.2,home:4.1,total:9.3},win_probability:{away:.578,home:.422},fair_moneyline:{away:-137,home:137},markets:{away_minus_1_5:.36,home_minus_1_5:.24,over_8_5:.56,under_8_5:.44},model_comparison:{available:true,book:'Hard Rock',away:{selection:'Atlanta Braves',gametwin:.578,aegis:.546,market:.521,price:-108,book:'Hard Rock'},home:{selection:'Washington Nationals',gametwin:.422,aegis:.454,market:.479,price:-102,book:'Hard Rock'}},pitcher_projections:{away:{name:'ATL SP',K:6.4,outs:17.8,ER:2.6,pitch_count:96},home:{name:'WSH SP',K:5.2,outs:16.2,ER:3.3,pitch_count:93}},top_hr:{away:[{name:'ATL 4',HR_probability:.22}],home:[{name:'WSH 4',HR_probability:.17}]},weather:{temperature_f:79,wind_mph:7,precipitation_probability:10,verified:true},venue:'Nationals Park',broadcast_context:{away:{lineup:[]},home:{lineup:[]}}};}

test('view model keeps GameTwin shadow governance immutable',()=>{const out=vm.buildGameViewModel(card(),{teams:{away:'Atlanta Braves',home:'Washington Nationals'},rosters:{}},[]);assert.equal(out.governance.aegis_weight,0);assert.equal(out.governance.release_eligible,false);assert.equal(out.governance.automatic_weight_changes,false);assert.equal(out.game.simulations,25000);});

test('view model compares exact same moneyline side',()=>{const out=vm.buildGameViewModel(card(),null,[]);assert.equal(out.analyze.model_comparison.away.selection,'Atlanta Braves');assert.equal(out.analyze.model_comparison.away.gametwin,.578);assert.equal(out.analyze.model_comparison.away.aegis,.546);assert.equal(out.analyze.model_comparison.away.market,.521);assert.equal(out.analyze.model_comparison.available,true);});

test('mismatched market side is rejected rather than silently compared',()=>{const c=card();c.model_comparison.away.selection='Washington Nationals';const out=vm.buildGameViewModel(c,null,[]);assert.equal(out.analyze.model_comparison.away,null);assert.equal(out.analyze.model_comparison.home.selection,'Washington Nationals');});

test('disagreement status identifies GT and AEGIS agreement against market',()=>{const c=card();c.model_comparison.away.market=.48;c.model_comparison.home.market=.52;const out=vm.buildGameViewModel(c,null,[]);assert.equal(out.analyze.disagreement.status,'GT_AEGIS_VS_MARKET');assert.match(out.analyze.disagreement.label,/GameTwin \+ AEGIS/);});

test('shadow market rows never become release eligible',()=>{const out=vm.buildGameViewModel(card(),null,[]);assert.ok(out.analyze.market_rows.length>=4);assert.ok(out.analyze.market_rows.every(r=>r.status==='SHADOW'));});
