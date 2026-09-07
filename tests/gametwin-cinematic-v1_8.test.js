'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {pathToFileURL}=require('url');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const load=()=>import(pathToFileURL(path.join(root,'public/gametwin-cinematics.mjs')).href+`?v=${Date.now()}-${Math.random()}`);

test('v1.8 pitch presentation holds release before plate arrival and scales flight with velocity',async()=>{
  const c=await load(),slow=c.pitchPresentationTiming({velocity_mph:75,result:'called_strike'}),fast=c.pitchPresentationTiming({velocity_mph:100,result:'called_strike'});
  assert.equal(c.GAMETWIN_CINEMATICS_VERSION,'1.8.0');
  assert.ok(slow.release<slow.plate);assert.ok(fast.release<fast.plate);assert.ok(fast.plate<slow.plate);assert.equal(slow.presentation_only,true);
});

test('v1.8 batter-box alignment mirrors handed hitters without moving home plate',async()=>{
  const c=await load(),r=c.batterBoxAlignment('R'),l=c.batterBoxAlignment('L');
  assert.equal(r.x,-l.x);assert.equal(r.z,l.z);assert.equal(r.y,l.y);assert.ok(r.yaw<0&&l.yaw>0);
});

test('v1.8 camera director prioritizes HR, close-play, leverage and replay context',async()=>{
  const c=await load();
  assert.equal(c.broadcastCameraDecision({outcome:'HR'},'contact'),'ball_track');
  assert.equal(c.broadcastCameraDecision({outcome:'1B',close_play:{active:true,base:3}},'finish'),'base_3');
  assert.equal(c.broadcastCameraDecision({leverage:.92},'pre_pitch'),'pitcher');
  assert.equal(c.broadcastCameraDecision({outcome:'OUT',close_play:{active:true,base:2}},'finish',{replay:true}),'base_2');
});

test('v1.8 throw and close-play choreography are bounded and presentation-only',async()=>{
  const c=await load(),thr=c.throwChoreography({release:.48}),cp=c.closePlayChoreography({base:2,success:false,steal:true});
  assert.ok(thr.release>.3&&thr.release<.8);assert.equal(thr.presentation_only,true);assert.equal(cp.camera,'base_2');assert.equal(cp.result,'OUT');assert.equal(cp.presentation_only,true);
});

test('v1.8 celebration sequence gives home runs a three-shot cinematic plan',async()=>{
  const c=await load(),seq=c.celebrationSequence({outcome:'HR',scored:['A','B'],leverage:.9});
  assert.deepEqual(seq.map(x=>x.camera),['ball_track','batter','stadium']);assert.ok(seq.every(x=>x.duration>0));
});

test('v1.8 renderer wires synchronized release, attachments, retained close-play runner and replay mode',()=>{
  const s=read('public/gametwin-3d.mjs');
  assert.match(s,/pitchPresentationTiming\(p\)/);assert.match(s,/batterBoxAlignment\(stance\.hand\)/);assert.match(s,/rigAnchor\(this\.pitcherRig,'pitch_release'\)/);
  assert.match(s,/throwChoreography\(profile\)/);assert.match(s,/this\.ballMesh\.position\.copy\(this\.rigAnchor\(rig,'glove'\)\)/);assert.match(s,/if\(!context\.close_play\?\.active\)this\.clearMovingRunners\(\)/);assert.match(s,/this\.replayMode=true/);
  assert.doesNotMatch(s,/release_eligible\s*=\s*true/);
});

test('v1.8 broadcast advertises cinematic gameplay without gaining betting authority',()=>{
  const b=require('../src/gametwin-broadcast');
  const row={broadcast_context:{gamePk:1,date:'2026-09-04T23:00:00Z',venue:{name:'Park',field:{}},weather:{},away:{name:'Away',lineup:[],starter:{name:'A',arsenal:[]},bullpen:[]},home:{name:'Home',lineup:[],starter:{name:'H',arsenal:[]},bullpen:[]}},representative_game:{final:{away:0,home:0},play_by_play:[]}};
  const out=b.buildBroadcast(row),c=out.capabilities;
  assert.equal(c.visual_fidelity_version,'1.9.0');assert.equal(c.cinematic_gameplay_version,'1.8.0');assert.equal(c.broadcast_director_version,'1.9.0');assert.equal(c.release_contact_synchronization,true);assert.equal(c.glove_ball_attachment,true);assert.equal(c.contextual_replay_camera,true);assert.equal(c.photorealistic_players,false);assert.equal(out.presentation_only,true);
});
