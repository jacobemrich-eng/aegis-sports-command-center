'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const read=p=>fs.readFileSync(p,'utf8');

test('v2.1.2 visual fidelity layer is presentation-only and zero-authority',()=>{
  const s=read('public/gametwin-visual-fidelity-v2.1.2.mjs');
  assert.match(s,/version:'2\.1\.2-visual-fidelity'/);
  assert.match(s,/predictive_authority:false/);
  assert.match(s,/aegis_weight:0/);
  assert.match(s,/release_eligible:false/);
});

test('v2.1.2 tunes broadcast batter pitcher and stadium framing',()=>{
  const s=read('public/gametwin-visual-fidelity-v2.1.2.mjs');
  assert.match(s,/mode==='broadcast'/);
  assert.match(s,/mode==='batter'/);
  assert.match(s,/mode==='pitcher'/);
  assert.match(s,/mode==='stadium'/);
  assert.match(s,/broadcast_centerfield_camera:true/);
  assert.match(s,/batter_ots_camera:true/);
});

test('v2.1.2 adds plate spacing human silhouette and field depth without simulation authority',()=>{
  const s=read('public/gametwin-visual-fidelity-v2.1.2.mjs');
  assert.match(s,/normalizePlateCluster/);
  assert.match(s,/GameTwinVisualHand212/);
  assert.match(s,/GameTwinVisualGlove212/);
  assert.match(s,/GameTwinInnerInfieldGrass212/);
  assert.match(s,/home_plate_collision_spacing:true/);
  assert.match(s,/inner_infield_grass:true/);
});

test('loader applies v2.1.2 after the existing v2.1.1 polish layer',()=>{
  const s=read('public/gametwin-3d-loader.js');
  assert.match(s,/VF212_URL='\/gametwin-visual-fidelity-v2\.1\.2\.mjs\?v=2\.1\.2'/);
  assert.match(s,/applyGameTwinPolish/);
  assert.match(s,/applyGameTwinVisualFidelity/);
  assert.match(s,/visual_fidelity:'2\.1\.2-visual-fidelity'/);
  const h=read('public/gametwin.html');
  assert.match(h,/gametwin-3d-loader\.js\?v=2\.1\.2/);
});


test('exact v2.1.2 runtime export matches loader invocation',()=>{
  const moduleSrc=read('public/gametwin-visual-fidelity-v2.1.2.mjs');
  const loader=read('public/gametwin-3d-loader.js');

  assert.match(
    moduleSrc,
    /export function applyGameTwinVisualFidelity\(SceneClass,THREE\)/
  );

  assert.match(
    loader,
    /vf212\.applyGameTwinVisualFidelity\(SceneClass,THREE\)/
  );

  assert.doesNotMatch(
    loader,
    /applyGameTwinVisualFidelity212/
  );
});
