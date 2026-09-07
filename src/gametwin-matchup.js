'use strict';

const VERSION='0.4.0-player-matchup';
const PITCH_GROUP={
  FF:'fastball',SI:'fastball',FC:'fastball',FA:'fastball',
  SL:'breaking',ST:'breaking',SV:'breaking',CU:'breaking',KC:'breaking',CS:'breaking',
  CH:'offspeed',FS:'offspeed',FO:'offspeed',SC:'offspeed',KN:'offspeed',EP:'offspeed'
};

function clamp(x,lo=0,hi=1){x=Number(x);return Number.isFinite(x)?Math.max(lo,Math.min(hi,x)):lo;}
function num(x,fb=0){const n=Number(x);return Number.isFinite(n)?n:fb;}
function rate(x,fb=null){const n=Number(x);if(!Number.isFinite(n))return fb;return n>1.5?n/100:n;}
function mean(xs,fb=1){const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:fb;}
function normalizeProfile(profile,keys){
  const out={};let total=0;
  for(const k of keys){out[k]=Math.max(0,num(profile?.[k]));total+=out[k];}
  if(total<=0)return null;
  for(const k of keys)out[k]/=total;
  return out;
}
function handednessKey(pitcher){return String(pitcher?.pitch_hand||pitcher?.throws||'').toUpperCase()==='L'?'vs_left':'vs_right';}
function batterSideKey(batter){return String(batter?.bat_side||batter?.bats||'').toUpperCase()==='L'?'vs_left_batter':'vs_right_batter';}
function chooseSplit(entity,key,base){
  const s=entity?.splits?.[key];
  if(!s)return {profile:base,used:false,sample:0};
  const profile=s.profile||s.pa||s.allowed||s;
  return {profile,sample:num(s.sample||s.PA||s.BF||s.plateAppearances||s.battersFaced),used:true};
}
function blendProfiles(base,split,weight,keys){
  if(!split)return base;
  const a=normalizeProfile(base,keys),b=normalizeProfile(split,keys);if(!a||!b)return base;
  const w=clamp(weight,0,.80),out={};
  for(const k of keys)out[k]=a[k]*(1-w)+b[k]*w;
  return out;
}
function splitWeight(sample,prior=80,max=.72){return Math.min(max,Math.max(0,num(sample)/(num(sample)+prior)));}

function contactQualityFactor(batter={},pitcher={}){
  const b=batter.statcast||{},p=pitcher.statcast||{};
  const bx=rate(b.xwoba,b.woba),px=rate(p.xwoba_allowed,p.xwoba),bh=rate(b.hard_hit_pct),ph=rate(p.hard_hit_pct_allowed,p.hard_hit_pct),bb=rate(b.barrel_pct,b.barrels_per_bbe_pct),pb=rate(p.barrel_pct_allowed,p.barrels_per_bbe_pct);
  const factors=[];
  if(Number.isFinite(bx)&&Number.isFinite(px))factors.push(clamp(1+((bx-.320)+(px-.320))*.75,.88,1.14));
  if(Number.isFinite(bh)&&Number.isFinite(ph))factors.push(clamp(1+((bh-.40)+(ph-.40))*.18,.92,1.09));
  if(Number.isFinite(bb)&&Number.isFinite(pb))factors.push(clamp(1+((bb-.08)+(pb-.08))*.55,.91,1.11));
  return {factor:clamp(mean(factors,1),.88,1.14),signals:factors.length};
}

function arsenalRows(entity){return Array.isArray(entity?.arsenal)?entity.arsenal.filter(r=>r&&r.pitch_type):[];}
function pitchTypeMatchupFactor(batter={},pitcher={}){
  const arsenal=arsenalRows(pitcher),bRows=Array.isArray(batter.pitch_type_stats)?batter.pitch_type_stats:[];
  if(!arsenal.length||!bRows.length)return {factor:1,k_factor:1,hr_factor:1,coverage:0,matched:[]};
  const bMap=new Map(bRows.map(r=>[String(r.pitch_type).toUpperCase(),r]));
  let totalUsage=0,run=0,k=0,hr=0,covered=0;const matched=[];
  for(const p of arsenal){
    const type=String(p.pitch_type).toUpperCase(),usage=clamp(rate(p.usage,p.pitch_usage)||0,0,1);if(usage<=0)continue;totalUsage+=usage;
    let b=bMap.get(type);
    if(!b){const group=PITCH_GROUP[type];b=bRows.find(r=>PITCH_GROUP[String(r.pitch_type).toUpperCase()]===group);}
    if(!b){run+=usage;k+=usage;hr+=usage;continue;}
    covered+=usage;
    const bX=rate(b.xwoba,b.woba),pX=rate(p.xwoba_allowed,p.xwoba),bWhiff=rate(b.whiff_pct),pWhiff=rate(p.whiff_pct),bHr=rate(b.hr_per_pa,b.hr_pct),pHr=rate(p.hr_per_pa,p.hr_pct);
    const rf=Number.isFinite(bX)&&Number.isFinite(pX)?clamp(1+((bX-.320)+(pX-.320))*.65,.87,1.14):1;
    const kf=Number.isFinite(bWhiff)&&Number.isFinite(pWhiff)?clamp(1+((bWhiff-.25)+(pWhiff-.25))*.55,.88,1.15):1;
    const hf=Number.isFinite(bHr)&&Number.isFinite(pHr)?clamp(1+((bHr-.03)+(pHr-.03))*1.7,.86,1.17):rf;
    run+=usage*rf;k+=usage*kf;hr+=usage*hf;matched.push({pitch_type:type,usage,run_factor:rf,k_factor:kf,hr_factor:hf});
  }
  if(totalUsage<=0)return {factor:1,k_factor:1,hr_factor:1,coverage:0,matched:[]};
  const fallback=1-Math.min(1,totalUsage);run+=fallback;k+=fallback;hr+=fallback;totalUsage+=fallback;
  return {factor:clamp(run/totalUsage,.87,1.14),k_factor:clamp(k/totalUsage,.88,1.15),hr_factor:clamp(hr/totalUsage,.86,1.17),coverage:clamp(covered/Math.max(.001,totalUsage)),matched};
}

function timesThroughOrderAdjustment(context={}){
  const bf=Math.max(0,num(context.pitcher_batters_faced));
  const starter=!!context.is_starter;
  if(!starter)return {run_factor:1,k_factor:1,hr_factor:1,tto:1};
  const tto=bf>=18?3:bf>=9?2:1;
  if(tto===1)return {run_factor:1,k_factor:1,hr_factor:1,tto};
  if(tto===2)return {run_factor:1.035,k_factor:.975,hr_factor:1.035,tto};
  return {run_factor:1.075,k_factor:.94,hr_factor:1.08,tto};
}
function fatigueAdjustment(pitcher={},context={}){
  const workloadPenalty=clamp(pitcher?.workload?.penalty??1,.70,1);
  const pitches=Math.max(0,num(context.pitcher_pitches));
  const threshold=Math.max(65,num(pitcher.max_pitches,95));
  const overload=Math.max(0,pitches-threshold*.70)/Math.max(1,threshold*.30);
  const run=clamp(1+(1-workloadPenalty)*.45+overload*.055,1,1.16);
  const k=clamp(1-(1-workloadPenalty)*.30-overload*.04,.86,1);
  return {run_factor:run,k_factor:k,workload_penalty:workloadPenalty,pitch_load:clamp(overload,0,1.5)};
}

function buildMatchupProfile({batter,pitcher,environment={},context={},normalize,keys}){
  const bBase=batter?.pa||batter?.profile||{},pBase=pitcher?.allowed||pitcher?.pa_allowed||{};
  const bSplit=chooseSplit(batter,handednessKey(pitcher),bBase),pSplit=chooseSplit(pitcher,batterSideKey(batter),pBase);
  const b=blendProfiles(bBase,bSplit.profile,splitWeight(bSplit.sample,85),keys);
  const p=blendProfiles(pBase,pSplit.profile,splitWeight(pSplit.sample,110),keys);
  const blend={};for(const k of keys)blend[k]=Math.sqrt(Math.max(1e-9,num(b?.[k]))*Math.max(1e-9,num(p?.[k])));
  let out=normalize(blend,bBase);
  const contact=contactQualityFactor(batter,pitcher),arsenal=pitchTypeMatchupFactor(batter,pitcher),tto=timesThroughOrderAdjustment(context),fatigue=fatigueAdjustment(pitcher,context);
  const runFactor=clamp(contact.factor*arsenal.factor*tto.run_factor*fatigue.run_factor,.78,1.28);
  const kFactor=clamp(arsenal.k_factor*tto.k_factor*fatigue.k_factor,.80,1.20);
  const hrFactor=clamp(contact.factor*arsenal.hr_factor*tto.hr_factor*fatigue.run_factor,.76,1.34);
  out={...out};out.K*=kFactor;out.HR*=hrFactor;out['2B']*=Math.sqrt(runFactor);out['3B']*=Math.sqrt(runFactor);out['1B']*=Math.sqrt(runFactor);
  const envRun=clamp(environment.run_factor??1,.70,1.35),envHr=clamp(environment.hr_factor??envRun,.65,1.50);
  out.HR*=envHr;out['2B']*=Math.sqrt(envRun);out['3B']*=Math.sqrt(envRun);out['1B']*=Math.sqrt(envRun);
  out=normalize(out,bBase);
  const coverage=[bSplit.used,pSplit.used,contact.signals>0,arsenal.coverage>=.35].filter(Boolean).length/4;
  return {profile:out,diagnostics:{batter_split_used:bSplit.used,pitcher_split_used:pSplit.used,contact_factor:Number(contact.factor.toFixed(4)),contact_signals:contact.signals,arsenal_factor:Number(arsenal.factor.toFixed(4)),arsenal_k_factor:Number(arsenal.k_factor.toFixed(4)),arsenal_hr_factor:Number(arsenal.hr_factor.toFixed(4)),arsenal_coverage:Number(arsenal.coverage.toFixed(3)),tto:tto.tto,tto_run_factor:tto.run_factor,fatigue_run_factor:Number(fatigue.run_factor.toFixed(4)),matchup_coverage:Number(coverage.toFixed(3)),matched_pitches:arsenal.matched.slice(0,6)}};
}

function relieverMatchScore(pitcher={},nextBatter={},inning=7,scoreDiff=0){
  if(pitcher.available===false)return -999;
  const leverage=Math.abs(num(scoreDiff))<=3;
  let s=0;const role=String(pitcher.role||'').toLowerCase();
  if(inning>=9&&leverage&&role==='closer')s+=24;else if(inning===8&&leverage&&role==='setup')s+=18;else if(role==='middle')s+=5;
  const fresh=clamp(pitcher?.workload?.penalty??1,.70,1);s+=(fresh-.70)*28;
  const ph=String(pitcher.pitch_hand||'').toUpperCase(),bh=String(nextBatter.bat_side||'').toUpperCase();
  if(ph&&bh&&ph===bh)s+=4;
  const sample=num(pitcher?.season_stat_sample?.BF);s+=Math.min(5,sample/120);
  return s;
}
function chooseReliever(team={},nextBatter={},inning=7,scoreDiff=0,used=new Set()){
  const pen=(team.bullpen||[]).filter(p=>p&&p.name&&!used.has(p.name)&&p.available!==false);
  if(!pen.length)return null;
  return pen.slice().sort((a,b)=>relieverMatchScore(b,nextBatter,inning,scoreDiff)-relieverMatchScore(a,nextBatter,inning,scoreDiff))[0]||null;
}

module.exports={VERSION,PITCH_GROUP,rate,handednessKey,batterSideKey,splitWeight,contactQualityFactor,pitchTypeMatchupFactor,timesThroughOrderAdjustment,fatigueAdjustment,buildMatchupProfile,relieverMatchScore,chooseReliever};
