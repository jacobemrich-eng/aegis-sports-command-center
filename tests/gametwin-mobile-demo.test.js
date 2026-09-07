'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
function loadDemo(){
  const source=fs.readFileSync(path.join(root,'public','gametwin-demo-data.js'),'utf8');
  const context={window:{}};vm.createContext(context);vm.runInContext(source,context);return context.window.GameTwinDemo;
}

test('phone demo fixture is explicitly non-production and zero-authority',()=>{
  const d=loadDemo();
  assert.equal(d.status.demo,true);
  assert.equal(d.status.integration.aegis_weight,0);
  assert.equal(d.status.integration.release_eligible,false);
  assert.equal(d.slate.games.length,1);
  assert.equal(d.slate.games[0].integration.aegis_weight,0);
  assert.match(d.calibration.governance.note,/illustrative demo data/i);
});

test('phone demo includes a watchable representative broadcast',()=>{
  const d=loadDemo(),id=String(d.slate.games[0].gamePk),g=d.games[id]||d.games[Number(id)];
  assert.ok(g.broadcast.events.length>=12);
  assert.ok(g.broadcast.events.some(e=>e.kind==='plate_appearance'&&e.outcome==='HR'));
  assert.ok(g.broadcast.events.some(e=>e.kind==='steal_attempt'));
  assert.equal(g.broadcast.presentation_only,true);
});

test('GameTwin lab supports query/hash demo mode without network APIs',()=>{
  const ui=fs.readFileSync(path.join(root,'public','gametwin-ui.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public','gametwin.html'),'utf8');
  assert.match(ui,/qs0\.get\('demo'\)==='1'/);
  assert.match(ui,/window\.GameTwinDemo/);
  assert.match(html,/gametwin-demo-data\.js/);
  assert.match(html,/PHONE DEMO MODE/);
});

test('single-file mobile preview has no external runtime dependencies',()=>{
  const html=fs.readFileSync(path.join(root,'gametwin-mobile-preview.html'),'utf8');
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/GameTwinDemo=/);
  assert.match(html,/window\.GameTwinBroadcastScene=BroadcastScene/);
  assert.doesNotMatch(html,/<script\s+src=/i);
  assert.doesNotMatch(html,/<link\s+rel="stylesheet"/i);
  assert.match(html,/__GAMETWIN_FORCE_DEMO__/);
  assert.match(html,/gt-mobile-dock/);
  assert.match(html,/GameTwinMobileUX/);
});
