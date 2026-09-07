'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('production UI implements locked WATCH and ANALYZE modes',()=>{const s=read('public/gametwin-production-ui.js'),css=read('public/gametwin-production.css');assert.match(s,/WATCH SIM/);assert.match(s,/data-mode="watch"/);assert.match(s,/data-mode="analyze"/);assert.match(s,/setMode/);assert.match(css,/\.gtp-watch/);assert.match(css,/\.gtp-analyze/);assert.match(css,/gt-mode-analyze/);});

test('WATCH mode has contextual scorebug matchup telemetry and broadcast controls',()=>{const s=read('public/gametwin-production-ui.js');for(const token of ['gtp-scorebug','gtp-matchup','gtpTelemetry','EXIT VELO','LAUNCH','DISTANCE','gtpTimeline','gtpPlay','gtpReplay','gtpNext','gtpCamera'])assert.match(s,new RegExp(token));});

test('production controls use existing representative-game controller without rerunning simulation',()=>{const s=read('public/gametwin-production-ui.js');assert.match(s,/GameTwinBroadcastController/);assert.match(s,/\.togglePlay\?/);assert.match(s,/\.replayLast\?/);assert.match(s,/\.nextPA\?/);assert.match(s,/\.seek\?/);assert.doesNotMatch(s,/\/api\/gametwin\/scan/);});

test('WATCH controls auto hide while playing and stage tap restores them',()=>{const s=read('public/gametwin-production-ui.js'),css=read('public/gametwin-production.css');assert.match(s,/3000/);assert.match(s,/showControls/);assert.match(s,/gtp-controls-hidden/);assert.match(css,/body\.gtp-controls-hidden \.gtp-controls/);});

test('ANALYZE shows same-market comparison pitcher hitters environment market board and governance',()=>{const s=read('public/gametwin-production-ui.js');for(const token of ['MODEL COMPARISON','STARTER PROJECTIONS','HR LEADERS','SHADOW MARKET BOARD','ENVIRONMENT','GOVERNANCE','AEGIS weight 0%'])assert.match(s,new RegExp(token));});

test('mobile implementation keeps watch-first layout and fixed WATCH ANALYZE switch',()=>{const css=read('public/gametwin-production.css');assert.match(css,/62dvh/);assert.match(css,/env\(safe-area-inset-bottom\)/);assert.match(css,/\.gtp-mode\{position:fixed/);assert.match(css,/orientation:landscape/);});

test('renderer emits pitch and contact UI events for contextual telemetry',()=>{const three=read('public/gametwin-3d.mjs'),canvas=read('public/gametwin-broadcast.js'),ui=read('public/gametwin-production-ui.js');for(const src of [three,canvas]){assert.match(src,/gametwin:visual-pitch/);assert.match(src,/gametwin:visual-contact/);assert.match(src,/gametwin:visual-pa-start/);assert.match(src,/gametwin:visual-pa-end/);}assert.match(ui,/visualPitch/);assert.match(ui,/visualContact/);});
