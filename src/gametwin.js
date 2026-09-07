'use strict';

const matchup = require('./gametwin-matchup');

const VERSION = '0.4.0-calibration-distributions';
const OUTCOMES = ['K','BB','HBP','1B','2B','3B','HR','OUT'];
const DEFAULT_BATTER = {K:.225,BB:.085,HBP:.010,'1B':.155,'2B':.048,'3B':.004,HR:.032,OUT:.441};
const DEFAULT_PITCHER = {...DEFAULT_BATTER};

function clamp(x,lo=0,hi=1){x=Number(x);return Number.isFinite(x)?Math.max(lo,Math.min(hi,x)):lo;}
function sum(xs){return xs.reduce((a,b)=>a+(Number(b)||0),0);}
function round(x,n=3){const p=10**n;return Math.round((Number(x)||0)*p)/p;}
function fnv1a(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h||1;}
function rng(seed='aegis-gametwin'){
  let x=typeof seed==='number'?(seed>>>0):fnv1a(seed);
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};
}
function normalizeProfile(input={},fallback=DEFAULT_BATTER){
  const raw={};
  for(const k of OUTCOMES)raw[k]=Math.max(0,Number(input[k]??fallback[k]??0));
  const total=sum(Object.values(raw));
  if(total<=0)return {...fallback};
  for(const k of OUTCOMES)raw[k]/=total;
  return raw;
}
function geometricBlend(a,b,weight=.5){
  a=normalizeProfile(a,DEFAULT_BATTER);b=normalizeProfile(b,DEFAULT_PITCHER);weight=clamp(weight);
  const out={};
  for(const k of OUTCOMES)out[k]=Math.pow(Math.max(1e-9,a[k]),1-weight)*Math.pow(Math.max(1e-9,b[k]),weight);
  return normalizeProfile(out,DEFAULT_BATTER);
}
function parkWeatherAdjust(profile,environment={}){
  const out={...profile},runFactor=clamp(environment.run_factor??1,.70,1.35),hrFactor=clamp(environment.hr_factor??runFactor,.65,1.50);
  out.HR*=hrFactor;out['2B']*=Math.sqrt(runFactor);out['3B']*=Math.sqrt(runFactor);out['1B']*=Math.sqrt(runFactor);
  return normalizeProfile(out,profile);
}
function matchupDetail(batter,pitcher,environment={},context={}){
  const hasAdvanced=!!(batter?.splits||pitcher?.splits||batter?.statcast||pitcher?.statcast||batter?.pitch_type_stats||pitcher?.arsenal||context?.pitcher_batters_faced||context?.pitcher_pitches);
  if(!hasAdvanced){
    const b=normalizeProfile(batter?.pa||batter?.profile||{},DEFAULT_BATTER),p=normalizeProfile(pitcher?.allowed||pitcher?.pa_allowed||{},DEFAULT_PITCHER),blend=geometricBlend(b,p,.5);
    const platoon=Number(batter?.platoon_factor??1);if(Number.isFinite(platoon)&&platoon!==1){blend['1B']*=platoon;blend['2B']*=platoon;blend.HR*=platoon;}
    return {profile:parkWeatherAdjust(normalizeProfile(blend,DEFAULT_BATTER),environment),diagnostics:{matchup_coverage:0,legacy_fallback:true}};
  }
  return matchup.buildMatchupProfile({batter,pitcher,environment,context,normalize:normalizeProfile,keys:OUTCOMES});
}
function matchupProfile(batter,pitcher,environment={},context={}){return matchupDetail(batter,pitcher,environment,context).profile;}
function weightedPick(profile,random){let r=random(),c=0;for(const k of OUTCOMES){c+=profile[k]||0;if(r<=c)return k;}return 'OUT';}
function makeBases(){return [null,null,null];}
function runnerRecord(batter,pitcher){return {...batter,responsible_pitcher:pitcher?.name||null,earned:true};}
function scoreRunner(state,runner,event){if(!runner)return;state.runs++;event.scored.push(runner.name);event.scored_detail.push({name:runner.name,responsible_pitcher:runner.responsible_pitcher||null,earned:runner.earned!==false});}
function advanceForcedWalk(state,batter,pitcher,event){
  const b=state.bases;if(b[0]&&b[1]&&b[2])scoreRunner(state,b[2],event);if(b[0]&&b[1])b[2]=b[1];if(b[0])b[1]=b[0];b[0]=runnerRecord(batter,pitcher);
}
function advanceHit(state,batter,pitcher,bases,event,random){
  const b=state.bases;
  if(bases===4){for(let i=2;i>=0;i--)scoreRunner(state,b[i],event);scoreRunner(state,runnerRecord(batter,pitcher),event);state.bases=makeBases();return;}
  const next=makeBases();
  for(let i=2;i>=0;i--){const runner=b[i];if(!runner)continue;let dest=i+bases;if(bases===1&&i===1&&random()<.58)dest=3;if(bases===1&&i===0&&random()<.30)dest=2;if(bases===2&&i===0&&random()<.62)dest=3;if(dest>=3)scoreRunner(state,runner,event);else next[dest]=runner;}
  next[bases-1]=runnerRecord(batter,pitcher);state.bases=next;
}
function simulatedPitchCount(outcome,random){
  const span={K:[3,7],BB:[4,8],HBP:[1,4],'1B':[1,6],'2B':[1,6],'3B':[1,6],HR:[1,6],OUT:[1,6]}[outcome]||[1,6];
  return span[0]+Math.floor(random()*(span[1]-span[0]+1));
}
function simulatePlateAppearance({batter,pitcher,environment,random,state,profile=null,diagnostics=null}){
  profile=profile||matchupProfile(batter,pitcher,environment);const outcome=weightedPick(profile,random),pitchCount=simulatedPitchCount(outcome,random);
  const event={batter:batter.name,pitcher:pitcher.name,outcome,pitch_count:pitchCount,scored:[],scored_detail:[],outs_before:state.outs,runs_before:state.runs};
  if(diagnostics)event.matchup=diagnostics;
  if(outcome==='K'||outcome==='OUT')state.outs++;
  else if(outcome==='BB'||outcome==='HBP')advanceForcedWalk(state,batter,pitcher,event);
  else if(outcome==='1B')advanceHit(state,batter,pitcher,1,event,random);
  else if(outcome==='2B')advanceHit(state,batter,pitcher,2,event,random);
  else if(outcome==='3B')advanceHit(state,batter,pitcher,3,event,random);
  else if(outcome==='HR')advanceHit(state,batter,pitcher,4,event,random);
  event.outs_after=state.outs;event.runs_after=state.runs;event.bases=state.bases.map(r=>r?r.name:null);return event;
}
function validateLineup(team,label){
  if(!team||typeof team!=='object')throw new Error(`${label} team is required`);if(!Array.isArray(team.lineup)||team.lineup.length<9)throw new Error(`${label} lineup must contain at least 9 batters`);
  for(const [i,p] of team.lineup.entries())if(!p||!p.name)throw new Error(`${label} lineup batter ${i+1} needs a name`);if(!team.starter||!team.starter.name)throw new Error(`${label} starting pitcher is required`);
}
function validateGameSpec(spec){if(!spec||typeof spec!=='object')throw new Error('GameTwin game spec is required');validateLineup(spec.away,'away');validateLineup(spec.home,'home');return true;}

function pitcherList(team){return [team.starter,...(team.bullpen||[])].filter(p=>p&&p.name);}
function emptyPitcherBox(team){const o={};for(const p of pitcherList(team))o[p.name]={BF:0,OUTS:0,K:0,BB:0,HBP:0,H:0,HR:0,R:0,ER:0,PITCHES:0};return o;}
function createPitchingState(team){return {team,active:team.starter,used:new Set(),usage:new Map([[team.starter.name,{BF:0,OUTS:0,PITCHES:0}]])};}
function pitcherUsage(state,pitcher){let u=state.usage.get(pitcher.name);if(!u){u={BF:0,OUTS:0,PITCHES:0};state.usage.set(pitcher.name,u);}return u;}
function isStarter(team,pitcher){return pitcher===team.starter||Number(pitcher?.id)===Number(team.starter?.id);}
function pitcherLimit(pitcher,starter){return Math.max(starter?70:18,Number(pitcher?.max_pitches??(starter?95:30)));}
function shouldReplacePitcher(state,pitcher,inning){
  if(!pitcher)return true;const starter=isStarter(state.team,pitcher),u=pitcherUsage(state,pitcher),limit=pitcherLimit(pitcher,starter);
  if(starter){const expectedInnings=Math.max(3,Math.min(8,Number(pitcher.max_innings??6))),hardOuts=Math.min(24,Math.round((expectedInnings+1.25)*3));return u.PITCHES>=limit||u.OUTS>=hardOuts||(u.BF>=30&&inning>=6);}
  return u.PITCHES>=limit||u.BF>=8;
}
function choosePitcher(state,inning,scoreDiff,nextBatter){
  let p=state.active;if(!shouldReplacePitcher(state,p,inning))return p;if(p)state.used.add(p.name);
  const next=matchup.chooseReliever(state.team,nextBatter,inning,scoreDiff,state.used);if(next){state.active=next;pitcherUsage(state,next);return next;}
  return p||state.team.starter;
}
function makeMatchupResolver(environment={}){
  const hitters=new WeakMap();
  return (batter,pitcher,context={},includeDiagnostics=false)=>{
    let pitchers=hitters.get(batter);if(!pitchers){pitchers=new WeakMap();hitters.set(batter,pitchers);}let bucket=pitchers.get(pitcher);if(!bucket){bucket=new Map();pitchers.set(pitcher,bucket);}
    const tto=context.is_starter?(context.pitcher_batters_faced>=18?3:context.pitcher_batters_faced>=9?2:1):0,pitchBucket=context.pitcher_pitches>=85?3:context.pitcher_pitches>=65?2:context.pitcher_pitches>=35?1:0,key=`${tto}|${pitchBucket}`;
    let detail=bucket.get(key);if(!detail){detail=matchupDetail(batter,pitcher,environment,context);bucket.set(key,detail);}return includeDiagnostics?detail:{profile:detail.profile,diagnostics:null};
  };
}
function emptyPlayerBox(team){const o={};for(const p of team.lineup)o[p.name]={PA:0,H:0,TB:0,HR:0,BB:0,HBP:0,K:0,R:0};return o;}
function applyEventToPlayerBox(box,e){
  if(!e?.batter||!box[e.batter])return;const r=box[e.batter];r.PA++;if(e.outcome==='K')r.K++;if(e.outcome==='BB')r.BB++;if(e.outcome==='HBP')r.HBP++;
  if(['1B','2B','3B','HR'].includes(e.outcome)){r.H++;r.TB+=({['1B']:1,['2B']:2,['3B']:3,HR:4})[e.outcome];if(e.outcome==='HR')r.HR++;}for(const name of e.scored||[])if(box[name])box[name].R++;
}
function applyEventToPitcherBox(box,e){
  const p=box[e.pitcher];if(p){p.BF++;p.PITCHES+=e.pitch_count||0;p.OUTS+=Math.max(0,(e.outs_after||0)-(e.outs_before||0));if(e.outcome==='K')p.K++;if(e.outcome==='BB')p.BB++;if(e.outcome==='HBP')p.HBP++;if(['1B','2B','3B','HR'].includes(e.outcome))p.H++;if(e.outcome==='HR')p.HR++;}
  for(const s of e.scored_detail||[]){const r=s.responsible_pitcher&&box[s.responsible_pitcher];if(r){r.R++;if(s.earned!==false)r.ER++;}}
}
function updatePitcherUsage(state,pitcher,e){const u=pitcherUsage(state,pitcher);u.BF++;u.PITCHES+=e.pitch_count||0;u.OUTS+=Math.max(0,(e.outs_after||0)-(e.outs_before||0));}
function simulateHalf({offense,defense,inning,half,batIndex,random,environment,ghostRunner=false,scoreDiff=0,walkoff=false,collectEvents=true,playerBox=null,pitcherBox=null,pitchingState=null,matchupResolver=null}){
  const state={outs:0,runs:0,bases:makeBases()},events=collectEvents?[]:null;pitchingState=pitchingState||createPitchingState(defense);
  if(ghostRunner){const ghost=offense.lineup[(batIndex+8)%9];state.bases[1]={...ghost,automatic_runner:true,responsible_pitcher:null,earned:false};if(collectEvents)events.push({type:'automatic_runner',runner:ghost.name,base:2,inning,half});}
  let guard=0,lastPitcher=null;
  while(state.outs<3&&guard++<60){
    const batter=offense.lineup[batIndex%9],pitcher=choosePitcher(pitchingState,inning,scoreDiff,batter),u=pitcherUsage(pitchingState,pitcher),context={pitcher_batters_faced:u.BF,pitcher_pitches:u.PITCHES,is_starter:isStarter(defense,pitcher)};
    const detail=matchupResolver?matchupResolver(batter,pitcher,context,collectEvents):{profile:matchupProfile(batter,pitcher,environment,context),diagnostics:null};
    const e=simulatePlateAppearance({batter,pitcher,environment,random,state,profile:detail.profile,diagnostics:detail.diagnostics});e.inning=inning;e.half=half;e.pa_number=guard;
    if(playerBox)applyEventToPlayerBox(playerBox,e);if(pitcherBox)applyEventToPitcherBox(pitcherBox,e);updatePitcherUsage(pitchingState,pitcher,e);if(collectEvents)events.push(e);batIndex=(batIndex+1)%9;lastPitcher=pitcher;
    if(walkoff&&state.runs>Math.max(0,-scoreDiff))break;
  }
  return {runs:state.runs,batIndex,events,pitcher:lastPitcher?.name||pitchingState.active?.name||null};
}
function simulateGame(spec,options={}){
  validateGameSpec(spec);const random=rng(options.seed??spec.seed??`${spec.date||''}|${spec.away.name}|${spec.home.name}`),environment=spec.environment||{};
  const maxInnings=Math.max(9,Math.min(30,Number(options.max_innings||18))),collectPlay=options.collect_play_by_play!==false,collectInnings=options.collect_innings!==false,matchupResolver=options.matchup_resolver||makeMatchupResolver(environment);
  let inning=1,away=0,home=0,awayIndex=0,homeIndex=0;const innings=collectInnings?[]:null,playByPlay=collectPlay?[]:null,awayBox=emptyPlayerBox(spec.away),homeBox=emptyPlayerBox(spec.home),awayPitch=emptyPitcherBox(spec.away),homePitch=emptyPitcherBox(spec.home),awayPitchState=createPitchingState(spec.away),homePitchState=createPitchingState(spec.home);
  while(inning<=maxInnings){
    const ghost=inning>=10,top=simulateHalf({offense:spec.away,defense:spec.home,inning,half:'top',batIndex:awayIndex,random,environment,ghostRunner:ghost,scoreDiff:away-home,collectEvents:collectPlay,playerBox:awayBox,pitcherBox:homePitch,pitchingState:homePitchState,matchupResolver});
    awayIndex=top.batIndex;away+=top.runs;if(collectPlay)playByPlay.push(...top.events);if(inning>=9&&home>away){if(collectInnings)innings.push({inning,away:top.runs,home:null});break;}
    const bottom=simulateHalf({offense:spec.home,defense:spec.away,inning,half:'bottom',batIndex:homeIndex,random,environment,ghostRunner:ghost,scoreDiff:home-away,walkoff:inning>=9,collectEvents:collectPlay,playerBox:homeBox,pitcherBox:awayPitch,pitchingState:awayPitchState,matchupResolver});
    homeIndex=bottom.batIndex;home+=bottom.runs;if(collectPlay)playByPlay.push(...bottom.events);if(collectInnings)innings.push({inning,away:top.runs,home:bottom.runs});if(inning>=9&&home!==away)break;inning++;
  }
  if(home===away){if(random()<.5)away++;else home++;}
  return {version:VERSION,final:{away,home,winner:away>home?spec.away.name:spec.home.name,innings:inning},innings:innings||[],play_by_play:playByPlay||[],player_box:{away:awayBox,home:homeBox},pitcher_box:{away:awayPitch,home:homePitch},environment};
}
function incHist(hist,value){const k=String(Math.max(0,Math.round(Number(value)||0)));hist[k]=(hist[k]||0)+1;}
function probabilityHistogram(hist,n){const out={};for(const [k,v] of Object.entries(hist||{}))out[k]=round((Number(v)||0)/Math.max(1,n),6);return out;}
function initAgg(team){const out={};for(const p of team.lineup)out[p.name]={games:0,gamesWithHit:0,games2Hits:0,gamesWithHR:0,gamesTB2:0,gamesWithRun:0,PA:0,H:0,TB:0,HR:0,BB:0,HBP:0,K:0,R:0,dist:{H:{},TB:{},HR:{},R:{},K:{},BB:{}}};return out;}
function addBox(agg,box){for(const [name,row] of Object.entries(box)){const a=agg[name];if(!a)continue;a.games++;if((row.H||0)>0)a.gamesWithHit++;if((row.H||0)>1)a.games2Hits++;if((row.HR||0)>0)a.gamesWithHR++;if((row.TB||0)>1.5)a.gamesTB2++;if((row.R||0)>0)a.gamesWithRun++;for(const k of ['PA','H','TB','HR','BB','HBP','K','R'])a[k]+=row[k]||0;for(const k of ['H','TB','HR','R','K','BB'])incHist(a.dist[k],row[k]||0);}}
function playerProjection(agg,n){const out={};for(const [name,r] of Object.entries(agg))out[name]={PA:round(r.PA/n,2),H:round(r.H/n,3),TB:round(r.TB/n,3),HR:round(r.HR/n,3),BB:round(r.BB/n,3),K:round(r.K/n,3),R:round(r.R/n,3),probabilities:{hit_1_plus:round(r.games?r.gamesWithHit/r.games:0,4),hits_2_plus:round(r.games?r.games2Hits/r.games:0,4),HR_1_plus:round(r.games?r.gamesWithHR/r.games:0,4),TB_over_1_5:round(r.games?r.gamesTB2/r.games:0,4),run_1_plus:round(r.games?r.gamesWithRun/r.games:0,4)},distributions:Object.fromEntries(Object.entries(r.dist).map(([k,h])=>[k,probabilityHistogram(h,n)])),HR_probability:round(r.games?r.gamesWithHR/r.games:0,4)};return out;}
function initPitchAgg(team){const out={};for(const p of pitcherList(team))out[p.name]={games:0,OUTS:0,K:0,BB:0,H:0,HR:0,ER:0,PITCHES:0,k45:0,k55:0,k65:0,k75:0,o155:0,o175:0,o185:0,dist:{K:{},OUTS:{},ER:{},H:{},BB:{},HR:{},PITCHES:{}}};return out;}
function addPitchBox(agg,box){for(const [name,a] of Object.entries(agg)){const r=box[name]||{};a.games++;for(const k of ['OUTS','K','BB','H','HR','ER','PITCHES'])a[k]+=r[k]||0;for(const k of ['K','OUTS','ER','H','BB','HR','PITCHES'])incHist(a.dist[k],r[k]||0);if((r.K||0)>4.5)a.k45++;if((r.K||0)>5.5)a.k55++;if((r.K||0)>6.5)a.k65++;if((r.K||0)>7.5)a.k75++;if((r.OUTS||0)>15.5)a.o155++;if((r.OUTS||0)>17.5)a.o175++;if((r.OUTS||0)>18.5)a.o185++;}}
function pitcherProjection(agg,n){const out={};for(const [name,r] of Object.entries(agg)){out[name]={IP:round(r.OUTS/n/3,2),outs:round(r.OUTS/n,2),K:round(r.K/n,3),BB:round(r.BB/n,3),H:round(r.H/n,3),HR:round(r.HR/n,3),ER:round(r.ER/n,3),pitches:round(r.PITCHES/n,1),probabilities:{K_over_4_5:round(r.k45/n,4),K_over_5_5:round(r.k55/n,4),K_over_6_5:round(r.k65/n,4),K_over_7_5:round(r.k75/n,4),outs_over_15_5:round(r.o155/n,4),outs_over_17_5:round(r.o175/n,4),outs_over_18_5:round(r.o185/n,4)},distributions:Object.fromEntries(Object.entries(r.dist).map(([k,h])=>[k,probabilityHistogram(h,n)]))};}return out;}
function runSimulations(spec,options={}){
  validateGameSpec(spec);const simulations=Math.max(1,Math.min(100000,Number(options.simulations||25000))),baseSeed=String(options.seed??spec.seed??`${spec.date||''}|${spec.away.name}|${spec.home.name}`),baseHash=fnv1a(baseSeed),matchupResolver=makeMatchupResolver(spec.environment||{});
  let homeWins=0,awayWins=0,homeRuns=0,awayRuns=0,homeMinus15=0,awayMinus15=0,over85=0,over95=0;const scoreCounts=new Map(),awayAgg=initAgg(spec.away),homeAgg=initAgg(spec.home),awayPitchAgg=initPitchAgg(spec.away),homePitchAgg=initPitchAgg(spec.home),awayScores=new Uint16Array(simulations),homeScores=new Uint16Array(simulations);
  for(let i=0;i<simulations;i++){
    const seed=(baseHash^Math.imul(i+1,0x9e3779b1))>>>0,g=simulateGame(spec,{seed,max_innings:options.max_innings,collect_play_by_play:false,collect_innings:false,matchup_resolver:matchupResolver}),h=g.final.home,a=g.final.away;
    awayScores[i]=a;homeScores[i]=h;homeRuns+=h;awayRuns+=a;if(h>a)homeWins++;else awayWins++;if(h-a>1.5)homeMinus15++;if(a-h>1.5)awayMinus15++;if(h+a>8.5)over85++;if(h+a>9.5)over95++;scoreCounts.set(`${a}-${h}`,(scoreCounts.get(`${a}-${h}`)||0)+1);addBox(awayAgg,g.player_box.away);addBox(homeAgg,g.player_box.home);addPitchBox(awayPitchAgg,g.pitcher_box.away);addPitchBox(homePitchAgg,g.pitcher_box.home);
  }
  const avgAway=awayRuns/simulations,avgHome=homeRuns/simulations;let bestIndex=0,bestDistance=Infinity;for(let i=0;i<simulations;i++){const d=Math.abs(awayScores[i]-avgAway)+Math.abs(homeScores[i]-avgHome);if(d<bestDistance){bestDistance=d;bestIndex=i;}}
  const representativeSeed=(baseHash^Math.imul(bestIndex+1,0x9e3779b1))>>>0,representative=simulateGame(spec,{seed:representativeSeed,max_innings:options.max_innings,matchup_resolver:matchupResolver});
  const commonScores=[...scoreCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([score,count])=>({score,probability:round(count/simulations,4)}));
  return {version:VERSION,simulations,teams:{away:spec.away.name,home:spec.home.name},win_probability:{away:round(awayWins/simulations,4),home:round(homeWins/simulations,4)},fair_moneyline:{away:probToAmerican(awayWins/simulations),home:probToAmerican(homeWins/simulations)},projected_score:{away:round(avgAway,2),home:round(avgHome,2),total:round(avgAway+avgHome,2)},markets:{home_minus_1_5:round(homeMinus15/simulations,4),away_minus_1_5:round(awayMinus15/simulations,4),over_8_5:round(over85/simulations,4),under_8_5:round(1-over85/simulations,4),over_9_5:round(over95/simulations,4),under_9_5:round(1-over95/simulations,4)},score_distribution:Object.fromEntries([...scoreCounts.entries()].map(([score,count])=>[score,round(count/simulations,6)])),common_scores:commonScores,players:{away:playerProjection(awayAgg,simulations),home:playerProjection(homeAgg,simulations)},pitchers:{away:pitcherProjection(awayPitchAgg,simulations),home:pitcherProjection(homePitchAgg,simulations)},representative_game:representative,data_quality:{lineups_confirmed:!!spec.lineups_confirmed,weather_verified:!!spec.environment?.verified,bullpen_verified:!!spec.bullpen_verified,matchup_intelligence:!!spec.matchup_intelligence,projection_only:true},integration:{aegis_weight:0,release_eligible:false,reason:'GameTwin remains shadow-only until calibration and validation gates are passed.'}};
}
function probToAmerican(p){p=Number(p);if(!Number.isFinite(p)||p<=0||p>=1)return null;return p>=.5?Math.round(-100*p/(1-p)):Math.round(100*(1-p)/p);}

module.exports={VERSION,OUTCOMES,validateGameSpec,normalizeProfile,matchupProfile,matchupDetail,simulatePlateAppearance,simulateGame,runSimulations,probToAmerican,rng,createPitchingState,shouldReplacePitcher,choosePitcher,pitcherProjection};
