'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCalibrationRunner}=require('../src/gametwin-calibration');
const {createMemoryAuditStore}=require('../src/gametwin-audit-store');

test('calibration runner records and grades a forecast lifecycle',async()=>{
  const store=createMemoryAuditStore(),result={final:true,status:'Final',gamePk:1,teams:{away:{name:'Away'},home:{name:'Home'}},score:{away:4,home:5},players:{away:{},home:{}},pitchers:{away:{},home:{}}},runner=createCalibrationRunner({store,resultsClient:{finalResult:async()=>result}}),spec={gamePk:1,date:'2026-09-04',away:{name:'Away'},home:{name:'Home'},data_quality:{}},projection={version:'x',simulations:1000,teams:{away:'Away',home:'Home'},projected_score:{away:4,home:5,total:9},win_probability:{away:.4,home:.6},fair_moneyline:{away:150,home:-150},markets:{home_minus_1_5:.45,over_8_5:.55,over_9_5:.45},score_distribution:{'4-5':1},players:{away:{},home:{}},pitchers:{away:{},home:{}},data_quality:{},integration:{aegis_weight:0}};
  const snap=await runner.record({spec,projection,quotes:[{market:'h2h',selection:'Home',price:-130}]});const graded=await runner.grade(snap);assert.equal(graded.grade.status,'FINAL');const report=await runner.report();assert.equal(report.final_games,1);
});
