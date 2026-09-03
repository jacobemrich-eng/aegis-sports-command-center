const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('../src/heartbeat');

test.beforeEach(()=>h._resetForTests());

test('fresh primary suppresses backup recovery',()=>{
  const x=h.decide({operations:{inside_operating_window:true,last_success_age_minutes:12},storage:{ok:true,persistent:true},secretReady:true,autopilotSecretReady:true,staleMinutes:35,uptimeSeconds:3600});
  assert.equal(x.trigger,false); assert.equal(x.reason,'fresh');
});

test('stale primary triggers backup recovery',()=>{
  const x=h.decide({operations:{inside_operating_window:true,last_success_age_minutes:41},storage:{ok:true,persistent:true},secretReady:true,autopilotSecretReady:true,staleMinutes:35,uptimeSeconds:3600});
  assert.equal(x.trigger,true); assert.equal(x.reason,'scheduler_stale');
});

test('sleep window never spends a recovery tick',()=>{
  const x=h.decide({operations:{inside_operating_window:false,last_success_age_minutes:400},storage:{ok:true,persistent:true},secretReady:true,autopilotSecretReady:true});
  assert.equal(x.trigger,false); assert.equal(x.reason,'sleep_window');
});

test('separate heartbeat secret is mandatory',()=>{
  const x=h.decide({operations:{inside_operating_window:true,last_success_age_minutes:50},storage:{ok:true,persistent:true},secretReady:false,autopilotSecretReady:true});
  assert.equal(x.trigger,false); assert.equal(x.reason,'heartbeat_secret_missing');
});

test('production persistence failure blocks recovery trigger',()=>{
  const x=h.decide({operations:{inside_operating_window:true,last_success_age_minutes:50},storage:{ok:false,persistent:false},secretReady:true,autopilotSecretReady:true});
  assert.equal(x.trigger,false); assert.equal(x.reason,'persistence_unhealthy');
});

test('bearer secret comparison accepts exact secret only',()=>{
  assert.equal(h.authorized('Bearer abc123','abc123'),true);
  assert.equal(h.authorized('Bearer abc124','abc123'),false);
  assert.equal(h.authorized('abc123','abc123'),false);
});

test('queue deduplicates and executes one recovery',async()=>{
  let runs=0;
  const a=h.queueRecovery({delayMs:0,recheck:async()=>({trigger:true,reason:'scheduler_stale'}),run:async()=>{runs++;return {ok:true};}});
  const b=h.queueRecovery({delayMs:0,recheck:async()=>({trigger:true}),run:async()=>{runs++;return {ok:true};}});
  assert.equal(a,true); assert.equal(b,false);
  await h._waitForIdleForTest();
  assert.equal(runs,1);
  assert.equal(h.publicState({secretReady:true,autopilotSecretReady:true,uptimeSeconds:3600}).last_result,'success');
});

test('debounced recheck suppresses recovery if primary recovered',async()=>{
  let runs=0;
  assert.equal(h.queueRecovery({delayMs:0,recheck:async()=>({trigger:false,reason:'fresh'}),run:async()=>{runs++;}}),true);
  await h._waitForIdleForTest();
  assert.equal(runs,0);
  assert.equal(h.publicState({secretReady:true,autopilotSecretReady:true,uptimeSeconds:3600}).last_result,'suppressed:fresh');
});

test('queued failover recheck may ignore its own in-flight lock and execute recovery',async()=>{
  let runs=0;
  assert.equal(h.queueRecovery({
    delayMs:0,
    recheck:async()=>h.decide({
      operations:{inside_operating_window:true,last_success_age_minutes:56},
      storage:{ok:true,persistent:true},
      secretReady:true,
      autopilotSecretReady:true,
      staleMinutes:35,
      uptimeSeconds:3600,
      ignoreInFlight:true
    }),
    run:async()=>{runs++;return {ok:true};}
  }),true);
  await h._waitForIdleForTest();
  assert.equal(runs,1);
  const state=h.publicState({secretReady:true,autopilotSecretReady:true,uptimeSeconds:3600});
  assert.equal(state.last_result,'success');
  assert.ok(state.last_recovery_success_at);
});

test('external decisions still block duplicate recovery while one is in flight',async()=>{
  assert.equal(h.queueRecovery({delayMs:20,recheck:async()=>({trigger:false,reason:'fresh'}),run:async()=>({ok:true})}),true);
  const gate=h.decide({
    operations:{inside_operating_window:true,last_success_age_minutes:56},
    storage:{ok:true,persistent:true},
    secretReady:true,
    autopilotSecretReady:true,
    staleMinutes:35,
    uptimeSeconds:3600
  });
  assert.equal(gate.trigger,false);
  assert.equal(gate.reason,'recovery_in_flight');
  await h._waitForIdleForTest();
});

test('authenticated probes make redundancy state healthy',()=>{
  h.recordProbe({reason:'fresh'},Date.parse('2026-09-03T16:00:00Z'));
  const s=h.publicState({secretReady:true,autopilotSecretReady:true,nowMs:Date.parse('2026-09-03T16:08:00Z'),uptimeSeconds:3600});
  assert.equal(s.ready,true); assert.equal(s.status,'HEALTHY'); assert.equal(s.last_probe_age_minutes,8);
});

test('repository wiring exposes protected heartbeat recovery without changing primary cadence',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const ROOT=path.join(__dirname,'..');
  const server=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
  const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/aegis-autopilot.yml'),'utf8');
  assert.match(server,/\/api\/autopilot\/heartbeat/);
  assert.match(server,/AEGIS_HEARTBEAT_SECRET/);
  assert.match(server,/heartbeat\.queueRecovery/);
  assert.match(server,/ignoreInFlight:true/);
  assert.match(server,/127\.0\.0\.1:\$\{PORT\}\/api\/autopilot\/tick/);
  assert.match(workflow,/2,17,32,47 \* \* \* \*/);
});

test('Render contract declares a separate unsynced heartbeat secret',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const ROOT=path.join(__dirname,'..');
  const render=fs.readFileSync(path.join(ROOT,'render.yaml'),'utf8');
  assert.match(render,/AEGIS_HEARTBEAT_SECRET/);
  assert.match(render,/AEGIS_HEARTBEAT_STALE_MINUTES/);
  assert.match(render,/value:\s*["']?35["']?/);
});

test('Operations Guardian and UI surface scheduler redundancy',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const ROOT=path.join(__dirname,'..');
  const operations=fs.readFileSync(path.join(ROOT,'src/operations.js'),'utf8');
  const ui=fs.readFileSync(path.join(ROOT,'public/app-v8_9.js'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'public/index.html'),'utf8');
  assert.match(operations,/scheduler_redundancy/);
  assert.match(operations,/primary-only/);
  assert.match(ui,/REDUNDANT/);
  assert.match(html,/v8\.9\.3 • STATUS SYNC/);
});
