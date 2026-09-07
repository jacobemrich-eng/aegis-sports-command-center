'use strict';

const gt = require('./gametwin');
const savant = require('./gametwin-statcast');

const VERSION = '0.4.0-matchup-data';
const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const MLB_FEED_BASE = 'https://statsapi.mlb.com/api/v1.1';
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';
const LEAGUE_BATTER = {K:.225,BB:.085,HBP:.010,'1B':.155,'2B':.048,'3B':.004,HR:.032,OUT:.441};
const LEAGUE_PITCHER = {...LEAGUE_BATTER};

function clamp(x,lo,hi){x=Number(x);return Number.isFinite(x)?Math.max(lo,Math.min(hi,x)):lo;}
function num(x,fb=0){const n=Number(x);return Number.isFinite(n)?n:fb;}
function dateOnly(value){return new Date(value).toISOString().slice(0,10);}
function addDays(value,days){const d=new Date(value);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function uniq(xs){return [...new Set(xs.filter(x=>x!==null&&x!==undefined))];}
function qs(params){const u=new URLSearchParams();for(const [k,v] of Object.entries(params)){if(v===undefined||v===null||v==='')continue;u.set(k,String(v));}return u.toString();}
function statGroup(row){return String(row?.group?.displayName||row?.group?.displayNameShort||row?.group?.code||'').toLowerCase();}
function statType(row){return String(row?.type?.displayName||row?.type?.displayNameShort||row?.type?.code||'').toLowerCase();}
function firstStat(person,group){
  const key=String(group).toLowerCase();for(const row of person?.stats||[]){if(statGroup(row)&&statGroup(row)!==key)continue;if(statType(row).includes('split'))continue;const split=(row?.splits||[])[0];if(split?.stat)return split.stat;}return null;
}
function shrinkProfile(raw,sample,priorWeight,fallback){
  const base=gt.normalizeProfile(fallback,fallback),obs=gt.normalizeProfile(raw,fallback),w=clamp(num(sample)/(num(sample)+priorWeight),0,1),out={};for(const k of gt.OUTCOMES)out[k]=obs[k]*w+base[k]*(1-w);return gt.normalizeProfile(out,fallback);
}
function profileFromHittingStat(stat={}){
  const PA=Math.max(1,num(stat.plateAppearances,num(stat.atBats)+num(stat.baseOnBalls)+num(stat.hitByPitch)+num(stat.sacFlies))),H=Math.max(0,num(stat.hits)),d=Math.max(0,num(stat.doubles)),t=Math.max(0,num(stat.triples)),hr=Math.max(0,num(stat.homeRuns)),one=Math.max(0,H-d-t-hr),bb=Math.max(0,num(stat.baseOnBalls)),hbp=Math.max(0,num(stat.hitByPitch)),k=Math.max(0,num(stat.strikeOuts)),out=Math.max(0,PA-one-d-t-hr-bb-hbp-k);
  return shrinkProfile({K:k/PA,BB:bb/PA,HBP:hbp/PA,'1B':one/PA,'2B':d/PA,'3B':t/PA,HR:hr/PA,OUT:out/PA},PA,120,LEAGUE_BATTER);
}
function profileFromPitchingStat(stat={}){
  const BF=Math.max(1,num(stat.battersFaced)),H=Math.max(0,num(stat.hits)),d=Math.max(0,num(stat.doubles)),t=Math.max(0,num(stat.triples)),hr=Math.max(0,num(stat.homeRuns)),one=Math.max(0,H-d-t-hr),bb=Math.max(0,num(stat.baseOnBalls)),hbp=Math.max(0,num(stat.hitBatsmen,num(stat.hitByPitch))),k=Math.max(0,num(stat.strikeOuts)),out=Math.max(0,BF-one-d-t-hr-bb-hbp-k);
  return shrinkProfile({K:k/BF,BB:bb/BF,HBP:hbp/BF,'1B':one/BF,'2B':d/BF,'3B':t/BF,HR:hr/BF,OUT:out/BF},BF,180,LEAGUE_PITCHER);
}
function splitCode(split={}){
  const raw=String(split.sitCode||split.code||split?.split?.code||split?.split?.description||split.description||'').toLowerCase();if(raw==='vl'||/vs\.?\s*left/.test(raw))return 'vl';if(raw==='vr'||/vs\.?\s*right/.test(raw))return 'vr';return null;
}
function splitProfiles(person,group,profileFn){
  const out={};for(const row of person?.stats||[]){if(statGroup(row)&&statGroup(row)!==String(group).toLowerCase())continue;if(!statType(row).includes('split'))continue;for(const s of row.splits||[]){const code=splitCode(s);if(!code||!s.stat)continue;const sample=group==='hitting'?num(s.stat.plateAppearances):num(s.stat.battersFaced);out[code]={profile:profileFn(s.stat),sample};}}
  return out;
}
function hitterSplits(person){const x=splitProfiles(person,'hitting',profileFromHittingStat);return {vs_left:x.vl||null,vs_right:x.vr||null};}
function pitcherSplits(person){const x=splitProfiles(person,'pitching',profileFromPitchingStat);return {vs_left_batter:x.vl||null,vs_right_batter:x.vr||null};}
function lineupIdsFromBox(box={}){if(Array.isArray(box.battingOrder)&&box.battingOrder.length)return uniq(box.battingOrder.map(Number)).slice(0,9);return Object.values(box.players||{}).filter(p=>num(p?.battingOrder)>0).sort((a,b)=>num(a.battingOrder)-num(b.battingOrder)).map(p=>Number(p.person?.id)).filter(Boolean).slice(0,9);}
function extractLineup(feed,side){
  const box=feed?.liveData?.boxscore?.teams?.[side]||{},ids=lineupIdsFromBox(box),globalPlayers=feed?.gameData?.players||{};return ids.map((id,index)=>{const bp=box.players?.[`ID${id}`]||{},gp=globalPlayers?.[`ID${id}`]||{};return {id,name:bp.person?.fullName||gp.fullName||gp.firstLastName||`Player ${id}`,batting_order:index+1,bat_side:gp.batSide?.code||null,position:bp.position?.abbreviation||gp.primaryPosition?.abbreviation||null};});
}
function extractStarter(feed,side){const p=feed?.gameData?.probablePitchers?.[side];if(p?.id)return {id:Number(p.id),name:p.fullName||`Pitcher ${p.id}`,confirmed:true};const box=feed?.liveData?.boxscore?.teams?.[side]||{},id=Number((box.pitchers||[])[0]);if(id){const row=box.players?.[`ID${id}`]||{};return {id,name:row.person?.fullName||`Pitcher ${id}`,confirmed:false};}return null;}
function teamMeta(feed,side){const t=feed?.gameData?.teams?.[side]||{};return {id:Number(t.id),name:t.name||t.teamName||side,abbreviation:t.abbreviation||null};}
function venueMeta(feed){const v=feed?.gameData?.venue||{};return {id:Number(v.id),name:v.name||'Unknown venue'};}
function pitchingRole(stat={},rank={}){if(rank.closerId&&Number(rank.playerId)===Number(rank.closerId))return 'closer';if(num(stat.holds)>=5||num(stat.gamesFinished)>=15)return 'setup';return 'middle';}
function starterMaxInnings(stat={}){const gs=Math.max(0,num(stat.gamesStarted)),ip=num(stat.inningsPitched);if(gs<=0||ip<=0)return 5.5;return clamp(ip/gs,4.2,7.0);}
function starterMaxPitches(stat={}){const gs=Math.max(1,num(stat.gamesStarted)),p=num(stat.numberOfPitches);if(p>0)return clamp(p/gs,78,105);return 95;}
function workloadState(days={}){const d1=num(days[1]),d2=num(days[2]),d3=num(days[3]),two=d1+d2,three=two+d3;let status='fresh',available=true,penalty=1;if(d1>=30||(d1>=20&&d2>=20)){status='unavailable';available=false;penalty=.70;}else if(d1>=20||two>=38||three>=55){status='limited';penalty=.88;}else if(d1>=12||two>=25){status='used';penalty=.95;}return {status,available,penalty,pitches_1d:d1,pitches_2d:d2,pitches_3d:d3,pitches_last_3d:three};}
function angularDiff(a,b){return Math.abs(((a-b+180)%360+360)%360-180);}
function environmentFromWeather(weather={},venue={}){
  const roof=String(venue?.fieldInfo?.roofType||'').toLowerCase(),dome=/dome|fixed/.test(roof),retractable=/retract/.test(roof),temp=num(weather.temperature_f,70),rh=num(weather.humidity,50),wind=num(weather.wind_mph,0),windFrom=num(weather.wind_direction_deg,0),az=num(venue?.location?.azimuthAngle,NaN);let towardCenter=0;
  if(Number.isFinite(az)&&wind>0){const windToward=(windFrom+180)%360,c=Math.cos(angularDiff(windToward,az)*Math.PI/180);towardCenter=wind*c;}
  const tempAdj=clamp((temp-70)*.0015,-.04,.04),humidityAdj=clamp((rh-50)*.0002,-.01,.01),windAdj=clamp(towardCenter*.005,-.06,.06);let run=clamp(1+tempAdj*.70+humidityAdj+windAdj*.50,.85,1.15),hr=clamp(1+tempAdj+windAdj,.80,1.20),confidence='high';if(dome){run=1;hr=1;confidence='indoor';}else if(retractable&&!weather.roof_status){run=1+(run-1)*.25;hr=1+(hr-1)*.25;confidence='low-roof-uncertainty';}
  return {run_factor:Number(run.toFixed(4)),hr_factor:Number(hr.toFixed(4)),verified:!!weather.verified,temperature_f:temp,humidity:rh,wind_mph:wind,wind_direction_deg:windFrom,wind_toward_center_mph:Number(towardCenter.toFixed(1)),precipitation_probability:num(weather.precipitation_probability,0),weather_code:weather.weather_code??null,roof_type:venue?.fieldInfo?.roofType||null,roof_status:weather.roof_status||null,weather_effect_confidence:confidence,source:weather.source||null,forecast_time:weather.forecast_time||null};
}
function nearestWeatherHour(payload,gameDate){const times=payload?.hourly?.time||[];if(!times.length)return null;const target=new Date(gameDate).getTime()/1000;let best=0,delta=Infinity;for(let i=0;i<times.length;i++){const d=Math.abs(num(times[i])-target);if(d<delta){delta=d;best=i;}}const h=payload.hourly||{};return {temperature_f:num(h.temperature_2m?.[best],70),humidity:num(h.relative_humidity_2m?.[best],50),wind_mph:num(h.wind_speed_10m?.[best],0),wind_direction_deg:num(h.wind_direction_10m?.[best],0),precipitation_probability:num(h.precipitation_probability?.[best],0),weather_code:h.weather_code?.[best]??null,forecast_time:new Date(num(times[best])*1000).toISOString(),verified:true,source:'Open-Meteo'};}
function mergeEnrichment(base={},extra={}){return {...base,...extra,statcast:{...(base.statcast||{}),...(extra.statcast||{})}};}
function createDataClient(options={}){
  const fetchImpl=options.fetchImpl||globalThis.fetch;if(typeof fetchImpl!=='function')throw new Error('GameTwin data client requires fetch');const cache=new Map(),statcastClient=options.statcastClient||savant.createStatcastClient({fetchImpl});
  async function getJson(url,ttlMs=120000){const hit=cache.get(url);if(hit&&Date.now()-hit.at<ttlMs)return hit.data;const r=await fetchImpl(url,{headers:{'User-Agent':'AEGIS-GameTwin/0.4'}});if(!r.ok)throw new Error(`GameTwin data request failed ${r.status}: ${url}`);const data=await r.json();cache.set(url,{at:Date.now(),data});return data;}
  async function schedule(date,teamId=null){return getJson(`${MLB_BASE}/schedule?${qs({sportId:1,date:dateOnly(date),teamId,hydrate:'probablePitcher,team,venue'})}`,60000);}
  async function slate(date){const data=await schedule(date),games=[];for(const d of data?.dates||[])for(const g of d.games||[])games.push({gamePk:Number(g.gamePk),gameDate:g.gameDate,status:g.status?.detailedState||null,away:{id:Number(g.teams?.away?.team?.id),name:g.teams?.away?.team?.name,probable_pitcher:g.teams?.away?.probablePitcher||null},home:{id:Number(g.teams?.home?.team?.id),name:g.teams?.home?.team?.name,probable_pitcher:g.teams?.home?.probablePitcher||null},venue:g.venue||null});return games;}
  async function gameFeed(gamePk){return getJson(`${MLB_FEED_BASE}/game/${Number(gamePk)}/feed/live`,30000);}
  async function venue(venueId){const data=await getJson(`${MLB_BASE}/venues/${Number(venueId)}?hydrate=location,fieldInfo,timezone`,86400000);return (data?.venues||[])[0]||null;}
  async function roster(teamId,date){const data=await getJson(`${MLB_BASE}/teams/${Number(teamId)}/roster?${qs({rosterType:'active',date:dateOnly(date)})}`,300000);return data?.roster||[];}
  async function peopleStats(ids,season){
    ids=uniq(ids.map(Number).filter(Boolean));if(!ids.length)return new Map();const out=new Map();
    for(let i=0;i<ids.length;i+=50){const chunk=ids.slice(i,i+50),hydrate=`stats(group=[hitting,pitching],type=[season,statSplits],sitCodes=[vl,vr],season=${Number(season)})`;const data=await getJson(`${MLB_BASE}/people?${qs({personIds:chunk.join(','),hydrate})}`,300000);for(const p of data?.people||[])out.set(Number(p.id),p);}return out;
  }
  async function recentTeamGames(teamId,gameDate,days=3){const end=addDays(gameDate,-1),start=addDays(gameDate,-days),data=await getJson(`${MLB_BASE}/schedule?${qs({sportId:1,teamId:Number(teamId),startDate:start,endDate:end})}`,120000),games=[];for(const d of data?.dates||[])for(const g of d.games||[])if(String(g.status?.abstractGameState).toLowerCase()==='final'||String(g.status?.detailedState).toLowerCase()==='final')games.push(g);return games;}
  async function bullpenWorkload(teamId,pitcherIds,gameDate){
    const target=new Set(pitcherIds.map(Number)),out=new Map([...target].map(id=>[id,{1:0,2:0,3:0}])),games=await recentTeamGames(teamId,gameDate,3),targetDay=dateOnly(gameDate);
    await Promise.all(games.map(async g=>{const data=await getJson(`${MLB_BASE}/game/${Number(g.gamePk)}/boxscore`,300000),gameDay=dateOnly(g.gameDate),diff=Math.round((new Date(`${targetDay}T12:00:00Z`)-new Date(`${gameDay}T12:00:00Z`))/86400000);if(diff<1||diff>3)return;for(const side of ['away','home']){const t=data?.teams?.[side];if(Number(t?.team?.id)!==Number(teamId))continue;for(const id of t.pitchers||[]){const pid=Number(id);if(!target.has(pid))continue;const row=t.players?.[`ID${pid}`]?.stats?.pitching||{};out.get(pid)[diff]+=num(row.numberOfPitches);}}}));return new Map([...out].map(([id,d])=>[id,workloadState(d)]));
  }
  async function weatherForGame(gameDate,venueInfo){const lat=num(venueInfo?.location?.defaultCoordinates?.latitude,NaN),lon=num(venueInfo?.location?.defaultCoordinates?.longitude,NaN);if(!Number.isFinite(lat)||!Number.isFinite(lon))return {verified:false,source:null};const hourly='temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m',url=`${WEATHER_BASE}?${qs({latitude:lat,longitude:lon,hourly,temperature_unit:'fahrenheit',wind_speed_unit:'mph',timeformat:'unixtime',forecast_days:16})}`;try{return nearestWeatherHour(await getJson(url,900000),gameDate)||{verified:false,source:'Open-Meteo'};}catch(e){return {verified:false,source:'Open-Meteo',error:e.message};}}
  async function statcastBundle(season){try{return await statcastClient.seasonBundle(season);}catch(error){return {version:savant.VERSION,batters:new Map(),pitchers:new Map(),counts:{batters:0,pitchers:0},error:error.message};}}
  async function teamBuild(feed,side,statsMap,gameDate,scBundle){
    const meta=teamMeta(feed,side),rawLineup=extractLineup(feed,side),starterRaw=extractStarter(feed,side),active=await roster(meta.id,gameDate),pitcherRoster=active.filter(r=>String(r?.position?.type||'').toLowerCase()==='pitcher').map(r=>({id:Number(r.person?.id),name:r.person?.fullName||`Pitcher ${r.person?.id}`})).filter(p=>p.id&&(!starterRaw||p.id!==starterRaw.id)),workload=await bullpenWorkload(meta.id,pitcherRoster.map(p=>p.id),gameDate);
    let closerId=null,bestSaves=-1;for(const p of pitcherRoster){const st=firstStat(statsMap.get(p.id),'pitching')||{};if(num(st.saves)>bestSaves){bestSaves=num(st.saves);closerId=p.id;}}
    const lineup=rawLineup.map(p=>{const person=statsMap.get(p.id),st=firstStat(person,'hitting')||{},extra=scBundle?.batters?.get(p.id)||{};return mergeEnrichment({...p,pa:profileFromHittingStat(st),splits:hitterSplits(person),season_stat_sample:{PA:num(st.plateAppearances)},data_source:'MLB Stats API'},extra);});
    const starterStat=starterRaw?firstStat(statsMap.get(starterRaw.id),'pitching')||{}:{},starterPerson=starterRaw?statsMap.get(starterRaw.id):null,starterExtra=starterRaw?(scBundle?.pitchers?.get(starterRaw.id)||{}):{};
    const starter=starterRaw?mergeEnrichment({...starterRaw,allowed:profileFromPitchingStat(starterStat),splits:pitcherSplits(starterPerson),pitch_hand:starterPerson?.pitchHand?.code||feed?.gameData?.players?.[`ID${starterRaw.id}`]?.pitchHand?.code||null,max_innings:starterMaxInnings(starterStat),max_pitches:starterMaxPitches(starterStat),season_stat_sample:{BF:num(starterStat.battersFaced),IP:num(starterStat.inningsPitched)},data_source:'MLB Stats API'},starterExtra):null;
    const bullpen=pitcherRoster.map(p=>{const person=statsMap.get(p.id),st=firstStat(person,'pitching')||{},w=workload.get(p.id)||workloadState({}),extra=scBundle?.pitchers?.get(p.id)||{};return mergeEnrichment({...p,allowed:profileFromPitchingStat(st),splits:pitcherSplits(person),pitch_hand:person?.pitchHand?.code||null,role:pitchingRole(st,{playerId:p.id,closerId}),available:w.available,workload:w,max_pitches:30,season_stat_sample:{BF:num(st.battersFaced),IP:num(st.inningsPitched)},data_source:'MLB Stats API'},extra);});
    return {...meta,lineup,starter,bullpen};
  }
  async function buildGameSpec(gamePk){
    const feed=await gameFeed(gamePk),gameDate=feed?.gameData?.datetime?.dateTime||feed?.gameData?.datetime?.originalDate||new Date().toISOString(),season=Number(feed?.gameData?.game?.season||new Date(gameDate).getUTCFullYear()),awayLine=extractLineup(feed,'away'),homeLine=extractLineup(feed,'home'),awayStarter=extractStarter(feed,'away'),homeStarter=extractStarter(feed,'home'),awayMeta=teamMeta(feed,'away'),homeMeta=teamMeta(feed,'home');
    const [awayRoster,homeRoster,scBundle]=await Promise.all([roster(awayMeta.id,gameDate),roster(homeMeta.id,gameDate),statcastBundle(season)]),ids=uniq([...awayLine,...homeLine].map(p=>p.id).concat([awayStarter?.id,homeStarter?.id],awayRoster.map(r=>r.person?.id),homeRoster.map(r=>r.person?.id))),statsMap=await peopleStats(ids,season);
    const [away,home,v]=await Promise.all([teamBuild(feed,'away',statsMap,gameDate,scBundle),teamBuild(feed,'home',statsMap,gameDate,scBundle),venue(venueMeta(feed).id)]),weather=await weatherForGame(gameDate,v),environment=environmentFromWeather(weather,v||{}),lineupsConfirmed=away.lineup.length===9&&home.lineup.length===9,bullpenVerified=away.bullpen.length>=5&&home.bullpen.length>=5,startersConfirmed=!!away.starter?.id&&!!home.starter?.id;
    const lineupStatcast=[...away.lineup,...home.lineup].filter(p=>p.statcast&&Object.values(p.statcast).some(Number.isFinite)).length,starterArsenal=[away.starter,home.starter].filter(p=>Array.isArray(p?.arsenal)&&p.arsenal.length>=2).length,splitPlayers=[...away.lineup,...home.lineup,away.starter,home.starter].filter(p=>p?.splits&&Object.values(p.splits).some(Boolean)).length,matchupCoverage=Number(((lineupStatcast/18)*.45+(starterArsenal/2)*.35+(Math.min(20,splitPlayers)/20)*.20).toFixed(3));
    return {version:VERSION,gamePk:Number(gamePk),date:gameDate,season,away,home,venue:{...venueMeta(feed),details:v},weather,environment,lineups_confirmed:lineupsConfirmed,bullpen_verified:bullpenVerified,probable_starters_confirmed:startersConfirmed,matchup_intelligence:{enabled:true,coverage:matchupCoverage,statcast_batters:lineupStatcast,starter_arsenals:starterArsenal,split_profiles:splitPlayers,savant_error:scBundle.error||null},data_quality:{lineups:lineupsConfirmed?'confirmed':'provisional',bullpen:bullpenVerified?'verified':'partial',starters:startersConfirmed?'confirmed':'unresolved',weather:environment.verified?'verified':'unverified',matchup_intelligence:matchupCoverage>=.75?'A':matchupCoverage>=.45?'B':'C',shadow_only:true},sources:['MLB Stats API','Open-Meteo',...(scBundle.error?[]:['Baseball Savant / Statcast'])]};
  }
  async function simulateGamePk(gamePk,options={}){const spec=await buildGameSpec(gamePk);if(!spec.lineups_confirmed)throw new Error('GameTwin real simulation blocked: confirmed 9-player lineups are not available yet.');if(!spec.probable_starters_confirmed)throw new Error('GameTwin real simulation blocked: probable starters unresolved.');return {spec,projection:gt.runSimulations(spec,options)};}
  return {VERSION,schedule,slate,gameFeed,venue,roster,peopleStats,recentTeamGames,bullpenWorkload,weatherForGame,statcastBundle,buildGameSpec,simulateGamePk};
}

module.exports={VERSION,MLB_BASE,WEATHER_BASE,LEAGUE_BATTER,profileFromHittingStat,profileFromPitchingStat,splitCode,splitProfiles,hitterSplits,pitcherSplits,extractLineup,extractStarter,workloadState,environmentFromWeather,nearestWeatherHour,createDataClient};
