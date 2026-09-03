const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const operations=require('../src/operations');

const NOW=Date.parse('2026-09-03T00:30:00Z'); // 20:30 ET
const isoAgo=m=>new Date(NOW-m*60000).toISOString();

const good={
  storage:{ok:true,persistent:true},
  config:{
    autopilotEnabled:true,
    dailyBudget:18,
    monthlyBudget:450,
    scheduleMinutes:15,
    releaseSports:['baseball_mlb','americanfootball_ncaaf']
  },
  production:true,
  nowMs:NOW,
  uptimeSeconds:3600
};

test('fresh production scheduler is autonomous GREEN',()=>{
  const x=operations.evaluate({...good,auto:{enabled:true,last_success_at:isoAgo(8),last_error:null,usage:{today:8,month:30}}});
  assert.equal(x.status,'GREEN');
  assert.equal(x.mode,'AUTONOMOUS');
  assert.equal(x.intervention_required,false);
  assert.equal(x.recovery_armed,false);
});

test('moderately stale scheduler arms automatic recovery without asking for intervention',()=>{
  const x=operations.evaluate({...good,auto:{enabled:true,last_success_at:isoAgo(48),last_error:null}});
  assert.equal(x.status,'DEGRADED');
  assert.equal(x.mode,'RECOVERY_ARMED');
  assert.equal(x.recovery_armed,true);
  assert.equal(x.intervention_required,false);
});

test('severely stale scheduler requires intervention',()=>{
  const x=operations.evaluate({...good,auto:{enabled:true,last_success_at:isoAgo(90),last_error:null}});
  assert.equal(x.status,'RED');
  assert.equal(x.mode,'ACTION_REQUIRED');
  assert.equal(x.intervention_required,true);
});

test('production persistence loss is RED',()=>{
  const x=operations.evaluate({...good,storage:{ok:true,persistent:false},auto:{enabled:true,last_success_at:isoAgo(5)}});
  assert.equal(x.status,'RED');
  assert.equal(x.intervention_required,true);
});

test('quota exhaustion protects budget without pretending system outage',()=>{
  const x=operations.evaluate({...good,auto:{enabled:true,last_success_at:isoAgo(5),usage:{today:18,month:40}}});
  assert.equal(x.status,'DEGRADED');
  assert.equal(x.mode,'QUOTA_PROTECTED');
  assert.equal(x.quota_protected,true);
  assert.equal(x.intervention_required,false);
});

test('sleep window does not mark old scheduler activity as a failure',()=>{
  const now=Date.parse('2026-09-03T08:00:00Z'); // 04:00 ET
  const x=operations.evaluate({...good,nowMs:now,auto:{enabled:true,last_success_at:new Date(now-180*60000).toISOString(),last_error:null}});
  assert.equal(x.inside_operating_window,false);
  assert.equal(x.status,'GREEN');
  assert.equal(x.mode,'SLEEP_WINDOW');
});

test('server health contract exposes Operations Guardian and direct status route',()=>{
  const server=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
  assert.match(server,/require\('\.\/src\/operations'\)/);
  assert.match(server,/operations:ops/);
  assert.match(server,/\/api\/operations\/status/);
  assert.match(server,/operations\.evaluate/);
});

test('existing scheduled Autopilot workflow remains intact during v8.9 app upgrade',()=>{
  const wf=fs.readFileSync(path.join(ROOT,'.github/workflows/aegis-autopilot.yml'),'utf8');
  assert.match(wf,/2,17,32,47 \* \* \* \*/);
  assert.match(wf,/AEGIS_AUTOPILOT_SECRET/);
  assert.match(wf,/contents: read/);
});

test('v8.9 UI is additive, calm, cache-busted, and free of common mojibake',()=>{
  const js=fs.readFileSync(path.join(ROOT,'public/app-v8_9.js'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'public/index.html'),'utf8');
  assert.match(js,/REFRESH_MS=60000/);
  assert.doesNotMatch(js,/MutationObserver/);
  assert.doesNotMatch(js,/[ÃÂ�â]|[\u0080-\u009f]/u);
  assert.match(js,/AEGIS IS OPERATING HANDS-OFF/);
  assert.match(html,/v8\.9 • AUTONOMOUS OPS/);
  assert.match(html,/\/app-v8_9\.js\?v=8\.9\.0/);
  assert.match(html,/\/visual-v8_9\.css\?v=8\.9\.0/);
});

test('v8.9 platform release does not rewrite the v8.8 Decision Intelligence engine',()=>{
  const pkg=require('../package.json');
  const engine=require('../src/engine');
  assert.equal(pkg.version,'8.9.0');
  assert.equal(engine.VERSION,'8.8.0-decision-intelligence');
});
