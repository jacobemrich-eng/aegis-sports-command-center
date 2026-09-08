'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');

function read(rel){return fs.readFileSync(path.join(ROOT,rel),'utf8');}

test('v2.1.1 polish loader wires visual-only module',()=>{
  const loader=read('public/gametwin-3d-loader.js');
  assert.match(loader,/gametwin-polish-v2\.1\.1\.mjs\?v=2\.1\.1/);
  assert.match(loader,/applyGameTwinPolish/);
  assert.match(loader,/visual_fidelity:'2\.1\.2-visual-fidelity'/);
});

test('v2.1.1 polish keeps GameTwin shadow-only',()=>{
  const src=read('public/gametwin-polish-v2.1.1.mjs');
  assert.match(src,/aegis_weight:0/);
  assert.match(src,/release_eligible:false/);
  assert.match(src,/predictive_authority:false/);
});

test('v2.1.1 polish covers camera framing, players, lighting and field',()=>{
  const src=read('public/gametwin-polish-v2.1.1.mjs');
  for(const token of ["mode==='batter'","mode==='pitcher'","mode==='stadium'",'player_proportion_polish:true','lighting_rebalance:true','field_mow_pattern:true'])assert.match(src,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
