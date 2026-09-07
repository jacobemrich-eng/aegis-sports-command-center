'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {createGameTwinApi,parseGamePk,parseFamily}=require('../src/gametwin-api');
test('API path parsers recognize game and calibration routes',()=>{assert.equal(parseGamePk('/api/gametwin/game/123'),123);assert.equal(parseFamily('/api/gametwin/calibration/pitcher_prop'),'pitcher_prop');});
test('read-only API routes return dashboard data and manual scan reuses saved MLB card',async()=>{
  let scanned=false;
  const runtime={gradeNow:async()=>({ok:true}),processCard:async card=>{scanned=!!card;return {ok:true};}};
  const dashboard={status:async()=>({ok:true}),slate:async()=>({games:[]}),game:async id=>({id}),calibration:async family=>({family:family||'all'})};
  const aegisStore={load:async()=>({latest_cards:{baseball_mlb:{analyses:[]}}})};
  const api=createGameTwinApi({runtime,dashboard,aegisStore});
  let r=await api.route({method:'GET'},new URL('http://x/api/gametwin/status'));assert.equal(r.status,200);
  r=await api.route({method:'POST'},new URL('http://x/api/gametwin/scan'));assert.equal(r.status,200);assert.equal(scanned,true);
});
test('v1.0 API exposes operations and production-pilot controls',async()=>{let enabled=true,resets=0;const runtime={gradeNow:async()=>({}),processCard:async()=>({}),pilot:{setEnabled:async v=>({enabled:v,circuit:'CLOSED'}),resetCircuit:async()=>{resets++;return {enabled,circuit:'CLOSED'};}}};const dashboard={status:async()=>({}),overview:async()=>({status:{}}),operations:async()=>({health:'GREEN'}),slate:async()=>({}),game:async()=>({}),calibration:async()=>({})};const aegisStore={load:async()=>({latest_cards:{}})};const api=createGameTwinApi({runtime,dashboard,aegisStore});let r=await api.route({method:'GET'},new URL('http://x/api/gametwin/operations'));assert.equal(r.body.health,'GREEN');r=await api.route({method:'POST'},new URL('http://x/api/gametwin/pilot/pause'));assert.equal(r.body.pilot.enabled,false);r=await api.route({method:'POST'},new URL('http://x/api/gametwin/pilot/reset'));assert.equal(resets,1);});
