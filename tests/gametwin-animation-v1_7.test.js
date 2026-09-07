'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {pathToFileURL}=require('url');
const {parseGlb}=require('../scripts/verify-generic-assets');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const load=()=>import(pathToFileURL(path.join(root,'public/gametwin-animation.mjs')).href+`?v=${Date.now()}-${Math.random()}`);

test('v1.7 animation planner resolves switch hitter opposite pitcher hand',async()=>{
  const a=await load();
  const vsR=a.animationPlan({outcome:'1B',pitcher_profile:{throws:'R'},batter_profile:{bats:'S'}});
  const vsL=a.animationPlan({outcome:'1B',pitcher_profile:{throws:'L'},batter_profile:{bats:'S'}});
  assert.equal(vsR.batter.hand,'L');
  assert.equal(vsR.batter.clip,'stance_left');
  assert.equal(vsL.batter.hand,'R');
  assert.equal(vsL.batter.clip,'stance_right');
  assert.equal(vsR.presentation_only,true);
});

test('v1.7 pitching and swing mechanics expose deterministic staged phases',async()=>{
  const a=await load();
  const p=a.pitchMechanics('L');
  assert.deepEqual(p.phases.map(x=>x.clip),['pitch_set','pitch_lift','pitch_drive','pitch_follow']);
  assert.equal(a.phaseAt(p.phases,.1).clip,'pitch_set');
  assert.equal(a.phaseAt(p.phases,.3).clip,'pitch_lift');
  assert.equal(a.phaseAt(p.phases,.6).clip,'pitch_drive');
  assert.equal(a.phaseAt(p.phases,.9).clip,'pitch_follow');
  const s=a.swingMechanics('R');
  assert.deepEqual(s.phases.map(x=>x.clip),['swing_load','swing_contact','swing_follow']);
});

test('v1.7 throw director uses baseball position-specific mechanics',async()=>{
  const a=await load();
  assert.equal(a.throwProfile('C').clip,'throw_catcher');
  assert.equal(a.throwProfile('SS').clip,'throw_infield');
  assert.equal(a.throwProfile('CF').clip,'throw_outfield');
  assert.equal(a.throwProfile('P').clip,'throw');
});

test('v1.7 runner finish selects home-run trot and close-play slide',async()=>{
  const a=await load();
  assert.equal(a.runnerFinish({outcome:'HR',to:4}).clip,'trot');
  assert.equal(a.runnerFinish({outcome:'1B',to:2,close:true}).clip,'slide');
  assert.equal(a.runnerFinish({outcome:'1B',to:2,steal:true}).clip,'slide');
  assert.equal(a.runnerFinish({outcome:'1B',to:1}).clip,'run');
});

test('v1.7 two-bone foot-placement solve remains bounded',async()=>{
  const a=await load();
  const reachable=a.solveTwoBoneIK({upper:1.4,lower:1.3,targetDistance:2.4,maxCorrection:.2});
  assert.equal(reachable.reachable,true);
  assert.ok(Math.abs(reachable.hipCorrection)<=.2+1e-9);
  assert.ok(Math.abs(reachable.kneeCorrection)<=.35+1e-9);
  const far=a.solveTwoBoneIK({upper:1.4,lower:1.3,targetDistance:10,maxCorrection:.2});
  assert.equal(far.reachable,false);
  assert.ok(far.distance<2.7);
  const overlay=a.footPlacementOverlay({ankleY:.2,groundY:0,lock:.8});
  assert.ok(Number.isFinite(overlay.hipCorrection));
});

test('v1.7 bundled role GLBs contain advanced baseball clips',()=>{
  const checks={
    batter:['stance_left','stance_right','swing_load','swing_contact','swing_follow','trot','react_strikeout'],
    pitcher:['pitch_set','pitch_lift','pitch_drive','pitch_follow'],
    fielder:['throw_infield','throw_outfield','field','catch'],
    runner:['run','slide','trot'],
    catcher:['receive','throw_catcher','catch'],
  };
  for(const [role,clips] of Object.entries(checks)){
    const {j}=parseGlb(path.join(root,'public/gametwin-assets/characters',`${role}-medium.glb`));
    const names=new Set((j.animations||[]).map(x=>x.name));
    for(const clip of clips)assert.ok(names.has(clip),`${role} missing ${clip}`);
  }
});

test('v1.7 broadcast carries handed player profiles and animation capabilities',()=>{
  const b=require('../src/gametwin-broadcast');
  const row={broadcast_context:{gamePk:77,date:'2026-09-04T23:00:00Z',venue:{name:'Park',field:{}},weather:{},away:{name:'Away',lineup:[{name:'Switch Bat',bats:'S',position:'SS'}],starter:{name:'Away SP',throws:'R',arsenal:[]},bullpen:[]},home:{name:'Home',lineup:[],starter:{name:'Home SP',throws:'L',arsenal:[]},bullpen:[]}},representative_game:{final:{away:1,home:0},play_by_play:[{type:'pa',inning:1,half:'top',pa_number:1,batter:'Switch Bat',pitcher:'Home SP',outcome:'1B',pitch_count:1,outs_before:0,outs_after:0,scored:[],bases:['Switch Bat',null,null]}]}};
  const out=b.buildBroadcast(row),pa=out.events.find(x=>x.kind==='plate_appearance');
  assert.equal(pa.batter_profile.bats,'S');
  assert.equal(pa.pitcher_profile.throws,'L');
  assert.equal(out.capabilities.advanced_baseball_animation_version,'1.7.0');
  assert.equal(out.capabilities.multi_stage_pitching,true);
  assert.equal(out.capabilities.handed_batting_stances,true);
  assert.equal(out.capabilities.analytical_two_bone_foot_ik,true);
  assert.equal(out.presentation_only,true);
});

test('v1.7 renderer consumes contextual animation plans without outcome authority',()=>{
  const s=read('public/gametwin-3d.mjs');
  assert.match(s,/animationPlan\(e\)/);
  assert.match(s,/phaseAt\(pitchPlan\.phases/);
  assert.match(s,/blendPose\('receive'/);
  assert.match(s,/throwProfile\(/);
  assert.match(s,/runnerFinish\(/);
  assert.match(s,/finish\.clip==='slide'/);
  assert.match(s,/gametwin:visual-pa-start/);
  assert.doesNotMatch(s,/release_eligible\s*=\s*true/);
});
