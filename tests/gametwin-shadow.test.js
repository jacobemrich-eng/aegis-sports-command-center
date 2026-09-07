'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createShadowScanner}=require('../src/gametwin-shadow');

function lineup(prefix){return Array.from({length:9},(_,i)=>({id:i+1,name:`${prefix} ${i+1}`,pa:{K:.22,BB:.09,HBP:.01,'1B':.16,'2B':.05,'3B':.004,HR:.032,OUT:.434}}));}
function spec(gamePk,ready=true){return {gamePk,date:'2026-09-04T23:00:00Z',away:{name:`Away ${gamePk}`,lineup:lineup('A'),starter:{name:'AS',max_innings:6},bullpen:[{name:'ARP'}]},home:{name:`Home ${gamePk}`,lineup:lineup('H'),starter:{name:'HS',max_innings:6},bullpen:[{name:'HRP'}]},venue:{name:'Park'},environment:{run_factor:1,hr_factor:1,verified:true},lineups_confirmed:ready,probable_starters_confirmed:true,bullpen_verified:true,data_quality:{lineups:ready?'confirmed':'provisional',shadow_only:true}};}

test('daily shadow scan separates ready from provisional without release authority',async()=>{
  const client={slate:async()=>[{gamePk:1},{gamePk:2}],buildGameSpec:async id=>spec(id,id===1)};
  const scanner=createShadowScanner({client});const r=await scanner.scanDate('2026-09-04',{simulations:100,concurrency:2});
  assert.equal(r.summary.total,2);assert.equal(r.summary.ready,1);assert.equal(r.summary.provisional,1);assert.equal(r.integration.aegis_weight,0);assert.equal(r.games[0].status,'READY');assert.equal(r.games[1].status,'PROVISIONAL');
});

test('ready shadow scan can persist an audit snapshot without affecting release authority',async()=>{
  const client={slate:async()=>[{gamePk:3}],buildGameSpec:async id=>spec(id,true)};
  const seen=[];const calibrationRunner={record:async payload=>{seen.push(payload);return {snapshot_id:'snap-3'};}};
  const scanner=createShadowScanner({client,calibrationRunner});const r=await scanner.scanDate('2026-09-04',{simulations:50});
  assert.equal(r.summary.audit_recorded,1);assert.equal(r.games[0].audit_snapshot_id,'snap-3');assert.equal(seen.length,1);assert.equal(r.integration.aegis_weight,0);
});
