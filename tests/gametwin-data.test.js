'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const d=require('../src/gametwin-data');

function feedFixture(){
  const awayPlayers={},homePlayers={},global={};
  const awayOrder=[],homeOrder=[];
  for(let i=1;i<=9;i++){
    const a=100+i,h=200+i;awayOrder.push(a);homeOrder.push(h);
    awayPlayers[`ID${a}`]={person:{id:a,fullName:`Away ${i}`},battingOrder:String(i*100),position:{abbreviation:'OF'}};
    homePlayers[`ID${h}`]={person:{id:h,fullName:`Home ${i}`},battingOrder:String(i*100),position:{abbreviation:'IF'}};
    global[`ID${a}`]={id:a,fullName:`Away ${i}`,batSide:{code:i%2?'R':'L'}};
    global[`ID${h}`]={id:h,fullName:`Home ${i}`,batSide:{code:i%2?'L':'R'}};
  }
  global.ID301={id:301,fullName:'Away Starter',pitchHand:{code:'R'}};
  global.ID302={id:302,fullName:'Home Starter',pitchHand:{code:'L'}};
  return {gameData:{datetime:{dateTime:'2026-09-04T23:05:00Z'},game:{season:'2026'},teams:{away:{id:1,name:'Away Club'},home:{id:2,name:'Home Club'}},venue:{id:77,name:'Test Park'},players:global,probablePitchers:{away:{id:301,fullName:'Away Starter'},home:{id:302,fullName:'Home Starter'}}},liveData:{boxscore:{teams:{away:{battingOrder:awayOrder,players:awayPlayers,pitchers:[301]},home:{battingOrder:homeOrder,players:homePlayers,pitchers:[302]}}}}};
}

test('extractLineup returns confirmed order with actual names',()=>{
  const f=feedFixture(),line=d.extractLineup(f,'away');
  assert.equal(line.length,9);assert.equal(line[0].name,'Away 1');assert.equal(line[8].batting_order,9);
});

test('hitter and pitcher profiles normalize and shrink small samples',()=>{
  const h=d.profileFromHittingStat({plateAppearances:20,hits:10,doubles:2,triples:0,homeRuns:5,baseOnBalls:2,hitByPitch:0,strikeOuts:3});
  const p=d.profileFromPitchingStat({battersFaced:20,hits:10,doubles:2,triples:0,homeRuns:5,baseOnBalls:2,hitBatsmen:0,strikeOuts:3});
  const sh=Object.values(h).reduce((a,b)=>a+b,0),sp=Object.values(p).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(sh-1)<1e-9);assert.ok(Math.abs(sp-1)<1e-9);
  assert.ok(h.HR<.20);assert.ok(p.HR<.20);assert.ok(h.K>.18&&h.K<.30);assert.ok(p.K>.18&&p.K<.30);
});

test('bullpen workload marks heavy back-to-back usage unavailable',()=>{
  assert.equal(d.workloadState({1:31,2:0,3:0}).available,false);
  assert.equal(d.workloadState({1:21,2:21,3:0}).status,'unavailable');
  assert.equal(d.workloadState({1:0,2:0,3:0}).status,'fresh');
});

test('weather environment is conservative for retractable roof uncertainty',()=>{
  const weather={verified:true,temperature_f:95,humidity:70,wind_mph:15,wind_direction_deg:180,precipitation_probability:10,source:'Open-Meteo'};
  const open={fieldInfo:{roofType:'Open'},location:{azimuthAngle:0}};
  const retract={fieldInfo:{roofType:'Retractable'},location:{azimuthAngle:0}};
  const a=d.environmentFromWeather(weather,open),b=d.environmentFromWeather(weather,retract);
  assert.ok(Math.abs(b.hr_factor-1)<Math.abs(a.hr_factor-1));
  assert.equal(b.weather_effect_confidence,'low-roof-uncertainty');
});

test('nearest weather hour uses epoch nearest game time',()=>{
  const target='2026-09-04T23:05:00Z',base=Math.floor(new Date(target).getTime()/1000/3600)*3600;
  const r=d.nearestWeatherHour({hourly:{time:[base-3600,base,base+3600],temperature_2m:[60,72,80],relative_humidity_2m:[50,55,60],wind_speed_10m:[3,7,10],wind_direction_10m:[90,100,110],precipitation_probability:[0,10,20],weather_code:[0,1,2]}},target);
  assert.equal(r.temperature_f,72);assert.equal(r.wind_mph,7);assert.equal(r.verified,true);
});

test('data client can assemble a real-game-shaped spec from mocked MLB/Open-Meteo responses',async()=>{
  const feed=feedFixture();
  const roster=(team)=>Array.from({length:8},(_,i)=>({person:{id:team*1000+i+1,fullName:`T${team} RP${i+1}`},position:{type:'Pitcher'}}));
  const people=[];
  for(const id of [...Array.from({length:9},(_,i)=>101+i),...Array.from({length:9},(_,i)=>201+i),301,302,...roster(1).map(x=>x.person.id),...roster(2).map(x=>x.person.id)]){
    const isStarter=id===301||id===302,isBatter=(id>=101&&id<=109)||(id>=201&&id<=209);
    const stats=[];
    if(isBatter)stats.push({group:{displayName:'hitting'},splits:[{stat:{plateAppearances:500,hits:135,doubles:28,triples:3,homeRuns:22,baseOnBalls:50,hitByPitch:5,strikeOuts:110}}]});
    if(isStarter||id>=1000)stats.push({group:{displayName:'pitching'},splits:[{stat:{battersFaced:500,hits:115,doubles:22,triples:3,homeRuns:18,baseOnBalls:40,hitBatsmen:4,strikeOuts:125,inningsPitched:120,gamesStarted:isStarter?20:0,saves:id%10===1?18:0,holds:id%10===2?14:0}}]});
    people.push({id,fullName:`P${id}`,stats,pitchHand:{code:'R'}});
  }
  const gameTime=Math.floor(new Date('2026-09-04T23:00:00Z').getTime()/1000);
  async function fetchImpl(url){
    const s=String(url);let body;
    if(s.includes('/feed/live'))body=feed;
    else if(s.includes('/roster'))body={roster:s.includes('/teams/1/')?roster(1):roster(2)};
    else if(s.includes('/people?'))body={people};
    else if(s.includes('/venues/77'))body={venues:[{id:77,name:'Test Park',location:{defaultCoordinates:{latitude:38.9,longitude:-77.0},azimuthAngle:0},fieldInfo:{roofType:'Open'}}]};
    else if(s.includes('open-meteo'))body={hourly:{time:[gameTime],temperature_2m:[82],relative_humidity_2m:[60],wind_speed_10m:[8],wind_direction_10m:[180],precipitation_probability:[5],weather_code:[1]}};
    else if(s.includes('/schedule?'))body={dates:[]};
    else if(s.includes('/boxscore'))body={teams:{away:{team:{id:1},pitchers:[],players:{}},home:{team:{id:2},pitchers:[],players:{}}}};
    else throw new Error(`unmocked ${s}`);
    return {ok:true,status:200,json:async()=>body};
  }
  const c=d.createDataClient({fetchImpl});const spec=await c.buildGameSpec(999);
  assert.equal(spec.gamePk,999);assert.equal(spec.away.lineup.length,9);assert.equal(spec.home.lineup.length,9);
  assert.equal(spec.lineups_confirmed,true);assert.equal(spec.probable_starters_confirmed,true);assert.equal(spec.bullpen_verified,true);
  assert.equal(spec.environment.verified,true);assert.equal(spec.data_quality.shadow_only,true);
});

test('platoon statSplits map vs-left and vs-right into GameTwin profiles',()=>{
  const person={stats:[{group:{displayName:'hitting'},type:{displayName:'statSplits'},splits:[
    {sitCode:'vl',stat:{plateAppearances:120,hits:38,doubles:8,triples:1,homeRuns:9,baseOnBalls:12,hitByPitch:1,strikeOuts:24}},
    {sitCode:'vr',stat:{plateAppearances:300,hits:70,doubles:14,triples:2,homeRuns:12,baseOnBalls:25,hitByPitch:3,strikeOuts:75}}
  ]}]};
  const s=d.hitterSplits(person);
  assert.ok(s.vs_left);assert.ok(s.vs_right);assert.equal(s.vs_left.sample,120);assert.equal(s.vs_right.sample,300);
  assert.ok(s.vs_left.profile.HR>s.vs_right.profile.HR);
});
