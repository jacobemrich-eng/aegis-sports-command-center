'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const audit=require('../src/gametwin-audit');
const stores=require('../src/gametwin-audit-store');

function fixture(){
  const spec={gamePk:123,date:'2026-09-04T23:00:00Z',away:{name:'Braves'},home:{name:'Nationals'},venue:{name:'Nationals Park'},data_quality:{lineups:'confirmed'},matchup_intelligence:{coverage:.8}};
  const projection={version:'0.4-test',simulations:25000,teams:{away:'Braves',home:'Nationals'},projected_score:{away:5.1,home:3.8,total:8.9},win_probability:{away:.63,home:.37},fair_moneyline:{away:-170,home:170},markets:{home_minus_1_5:.25,over_8_5:.54,over_9_5:.46},score_distribution:{'5-3':.5,'4-5':.2,'2-1':.3},players:{away:{'Ronald Acuna Jr.':{distributions:{H:{0:.3,1:.5,2:.2},TB:{0:.35,1:.30,2:.20,4:.15},HR:{0:.82,1:.18}}}},home:{}},pitchers:{away:{'Spencer Strider':{distributions:{K:{5:.2,6:.3,7:.3,8:.2},OUTS:{15:.2,18:.6,21:.2},ER:{1:.4,2:.3,3:.2,4:.1}}}},home:{}},data_quality:{projection_only:true},integration:{aegis_weight:0}};
  return {spec,projection};
}

test('audit snapshot records priced forecast probabilities while remaining shadow-only',()=>{
  const {spec,projection}=fixture(),s=audit.createSnapshot({spec,projection,quotes:[{market:'pitcher_strikeouts',player:'Spencer Strider',selection:'over',point:6.5,price:-110}],aegisForecasts:(row)=>row.family==='pitcher_prop'?{probability:.52}:null,book:'Hard Rock'});
  assert.equal(s.integration.aegis_weight,0);assert.equal(s.integration.release_eligible,false);const prop=s.forecasts.find(x=>x.family==='pitcher_prop');assert.equal(prop.fair_probability,.5);assert.equal(prop.aegis_probability,.52);
});

test('final grading calculates Brier, log loss, ROI and score error',()=>{
  const {spec,projection}=fixture(),s=audit.createSnapshot({spec,projection,quotes:[{market:'pitcher_strikeouts',player:'Spencer Strider',selection:'over',point:6.5,price:+100},{market:'player_hits',player:'Ronald Acuna Jr.',selection:'over',point:.5,price:-150}]});
  const result={final:true,status:'Final',gamePk:123,teams:{away:{name:'Braves'},home:{name:'Nationals'}},score:{away:6,home:3},players:{away:{'Ronald Acuna Jr.':{H:1,TB:1,HR:0,R:1,BB:0,K:1}},home:{}},pitchers:{away:{'Spencer Strider':{K:8,OUTS:18,ER:2,H:5,BB:2,HR:1,PITCHES:99}},home:{}}};
  const g=audit.gradeSnapshot(s,result);assert.equal(g.grade.status,'FINAL');const p=g.grade.forecasts.find(x=>x.family==='pitcher_prop');assert.equal(p.outcome,'WIN');assert.equal(p.unit_return,1);assert.ok(Number.isFinite(p.brier));assert.equal(g.grade.score_error.total,.1);
});

test('audit summary reports calibration and never auto-promotes model weight',()=>{
  const {spec,projection}=fixture(),rows=[];for(let i=0;i<3;i++){const s=audit.createSnapshot({spec:{...spec,gamePk:123+i},projection,quotes:[{market:'total',selection:'over',point:8.5,price:-110}]});rows.push(audit.gradeSnapshot(s,{final:true,status:'Final',gamePk:123+i,teams:{away:{name:'Braves'},home:{name:'Nationals'}},score:{away:5+i%2,home:4},players:{away:{},home:{}},pitchers:{away:{},home:{}}}));}
  const report=audit.summarizeAudit(rows);assert.equal(report.final_games,3);assert.equal(report.governance.status,'COLLECTING');assert.equal(report.governance.aegis_weight,0);assert.equal(report.governance.automatic_weight_change,false);
});

test('JSONL audit store persists latest snapshot update',async()=>{
  const file=path.join('/tmp',`gametwin-audit-${process.pid}-${Date.now()}.jsonl`),store=stores.createJsonlAuditStore(file);const row={snapshot_id:'abc',x:1};await store.save(row);await store.update({...row,x:2});const all=await store.list();assert.equal(all.length,1);assert.equal(all[0].x,2);await fs.promises.rm(file,{force:true});
});

test('AEGIS state adapter stores compact GameTwin snapshots through existing store.mutate',async()=>{
  let state={};const aegisStore={async load(){return JSON.parse(JSON.stringify(state));},async mutate(fn){const working=JSON.parse(JSON.stringify(state));const result=await fn(working);state=working;return {state,result};}};const store=stores.createAegisStateAuditStore(aegisStore,{cap:100});await store.save({snapshot_id:'g1',x:1});await store.update({snapshot_id:'g1',x:2});assert.equal((await store.list()).length,1);assert.equal((await store.get('g1')).x,2);assert.equal(state.gametwin.audit_order[0],'g1');
});

test('closing two-way market is de-vigged for calibration comparison',()=>{
  const {spec,projection}=fixture(),quotes=[{market:'total',selection:'over',point:8.5,price:-110},{market:'total',selection:'under',point:8.5,price:-110}],s=audit.createSnapshot({spec,projection,quotes}),result={final:true,status:'Final',gamePk:123,teams:{away:{name:'Braves'},home:{name:'Nationals'}},score:{away:6,home:4},players:{away:{},home:{}},pitchers:{away:{},home:{}}},closing=[{market:'total',selection:'over',point:8.5,price:-125},{market:'total',selection:'under',point:8.5,price:+105}],g=audit.gradeSnapshot(s,result,{closingQuotes:closing}),over=g.grade.forecasts.find(x=>x.quote?.selection==='over');assert.ok(Number.isFinite(over.closing_devig_probability));assert.ok(Number.isFinite(over.closing_market_brier));assert.ok(Number.isFinite(over.devig_clv_probability));
});
