'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const {pathToFileURL}=require('url');
const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('v1.7 motion profiles provide role-aware baseball timing',async()=>{
  const m=await import(pathToFileURL(path.join(root,'public/gametwin-motion.mjs')).href+'?v=profile');
  assert.equal(m.GAMETWIN_MOTION_VERSION,'1.7.0');
  const batter=m.motionProfile('batter','swing'),pitcher=m.motionProfile('pitcher','pitch');
  assert.ok(batter.fade<.15);assert.ok(batter.responsiveness>10);assert.ok(pitcher.responsiveness>10);
  assert.equal(m.actionPlayback('runner','run').loop,true);
});

test('v1.7 damping and foot-plant helpers are bounded and stable',async()=>{
  const m=await import(pathToFileURL(path.join(root,'public/gametwin-motion.mjs')).href+'?v=damp');
  const a=m.expDampAlpha(.016,10);assert.ok(a>0&&a<1);
  const f=m.footPlantCorrection({rootY:1,leftFootY:-.2,rightFootY:.1,groundY:0,maxCorrection:.1,lock:1});
  assert.equal(Number(f.correction.toFixed(3)),.1);assert.equal(Number(f.rootY.toFixed(3)),1.1);
  const y=m.stabilizedRootY(1,0,.016,{responsiveness:20,maxStep:.05});assert.ok(y<1&&y>=.95);
});

test('v1.7 material classifier applies sport-surface finishing without claiming textures that are absent',async()=>{
  const m=await import(pathToFileURL(path.join(root,'public/gametwin-materials.mjs')).href+'?v=finish');
  assert.equal(m.GAMETWIN_MATERIAL_VERSION,'1.7.0');
  assert.equal(m.materialClass('GT_Jersey_Primary'),'fabric');
  assert.equal(m.materialClass('GT_Glove_Leather'),'leather');
  assert.equal(m.materialClass('stadium metal rail'),'metal');
  const fabric=m.materialFinish('jersey','high'),metal=m.materialFinish('mask metal','high');
  assert.ok(fabric.roughness>.5);assert.ok(metal.metalness>.5);
});

test('v1.7 renderer wires microdetail materials, motion damping, crowd depth and camera easing',()=>{
  const s=read('public/gametwin-3d.mjs'),m=read('public/gametwin-materials.mjs'),st=read('public/gametwin-stadium-pack.mjs');
  assert.match(s,/GAMETWIN_MOTION_VERSION/);assert.match(s,/cameraEaseAlpha/);assert.match(s,/stabilizedRootY/);assert.match(s,/material_microdetail:true/);
  assert.match(m,/grassBump/);assert.match(m,/dirtBump/);assert.match(m,/concreteBump/);assert.match(m,/applyMaterialFidelity/);
  assert.match(st,/v1\.7 depth layers/);
});

test('v1.7 broadcast advertises fidelity features while preserving shadow-only honesty',()=>{
  const b=require('../src/gametwin-broadcast');
  const row={broadcast_context:{gamePk:1,date:'2026-09-04T23:00:00Z',venue:{name:'Park',field:{}},weather:{},away:{name:'Away',lineup:[],starter:{name:'A',arsenal:[]},bullpen:[]},home:{name:'Home',lineup:[],starter:{name:'H',arsenal:[]},bullpen:[]}},representative_game:{final:{away:0,home:0},play_by_play:[]}};
  const c=b.buildBroadcast(row).capabilities;
  assert.equal(c.visual_fidelity_version,'1.9.0');assert.equal(c.material_microdetail,true);assert.equal(c.motion_blend_profiles,true);assert.equal(c.root_motion_stabilization,true);assert.equal(c.crowd_depth_layers,true);assert.equal(c.photorealistic_players,false);assert.equal(c.licensed_stadium_asset_models,false);
});
