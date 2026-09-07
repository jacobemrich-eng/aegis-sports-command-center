'use strict';

const VERSION='0.9.0-broadcast-intelligence-physics';
function num(v,fb=0){const n=Number(v);return Number.isFinite(n)?n:fb;}
function clamp(v,lo=0,hi=1){return Math.max(lo,Math.min(hi,num(v,lo)));}
function lerp(a,b,t){return a+(b-a)*t;}
function fnv1a(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h||1;}
function rng(seed){let x=typeof seed==='number'?(seed>>>0):fnv1a(seed);return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}

const WALL_ANCHORS=[
  [-45,'left_line',330],[-31,'left',340],[-18,'left_center',375],[0,'center',400],
  [18,'right_center',375],[31,'right',340],[45,'right_line',330]
];
function wallDistanceAtAngle(angle,field={}){
  const a=clamp(num(angle),-45,45);
  let lo=WALL_ANCHORS[0],hi=WALL_ANCHORS[WALL_ANCHORS.length-1];
  for(let i=1;i<WALL_ANCHORS.length;i++){if(a<=WALL_ANCHORS[i][0]){lo=WALL_ANCHORS[i-1];hi=WALL_ANCHORS[i];break;}}
  const lv=num(field?.[lo[1]],lo[2]),hv=num(field?.[hi[1]],hi[2]),t=(a-lo[0])/(hi[0]-lo[0]||1);
  return lerp(lv,hv,clamp(t));
}
function windComponents(weather={},sprayAngle=0){
  const mph=Math.max(0,num(weather.wind_mph,0)),dir=num(weather.wind_direction_deg,0)*Math.PI/180,flight=num(sprayAngle,0)*Math.PI/180;
  // Presentation-only approximation. Positive carry is out toward the batted-ball heading.
  const wx=Math.sin(dir)*mph,wz=-Math.cos(dir)*mph,fx=Math.sin(flight),fz=-Math.cos(flight);
  const carry=wx*fx+wz*fz,cross=wx*fz-wz*fx;
  return {mph,direction_deg:num(weather.wind_direction_deg,0),carry_mph:carry,cross_mph:cross};
}
function interpolatePath(points,t){
  if(!points?.length)return {x:0,y:0,z:0};if(points.length===1)return {...points[0]};const q=clamp(t)*(points.length-1),i=Math.min(points.length-2,Math.floor(q)),f=q-i,a=points[i],b=points[i+1];return {x:lerp(a.x,b.x,f),y:lerp(a.y,b.y,f),z:lerp(a.z,b.z,f)};
}
function buildBallFlight(ball={},weather={},field={},outcome='OUT',opts={}){
  const ev=clamp(num(ball.exit_velocity_mph,88),45,125),launch=clamp(num(ball.launch_angle_deg,12),-35,60),spray=clamp(num(ball.spray_angle_deg,0),-44.5,44.5),reported=Math.max(20,num(ball.distance_ft,180)),wall=wallDistanceAtAngle(spray,field),wind=windComponents(weather,spray);
  const carryAdj=clamp(wind.carry_mph*.55,-14,14),crossAdj=clamp(wind.cross_mph*.12,-5.5,5.5);
  let desired=Math.max(25,reported+carryAdj),wallCollision=false,clearsWall=false;
  if(outcome==='HR'){desired=Math.max(desired,wall+10);clearsWall=true;}
  else if(desired>=wall-1&&launch>7){wallCollision=true;desired=wall;}
  else desired=Math.min(desired,Math.max(24,wall-4));
  const rad=(spray+crossAdj)*Math.PI/180,tx=Math.sin(rad)*desired,tz=-Math.cos(rad)*desired;
  const launchRad=Math.max(-8,launch)*Math.PI/180;
  const speedFps=ev*1.46667,baseTime=clamp((desired/Math.max(45,speedFps*.62))*1.45,.65,5.8);
  const apex=Math.max(2.2,Math.min(175,Math.sin(Math.max(0,launchRad))*desired*.58 + Math.max(0,launch)*.6));
  const count=Math.max(24,Math.min(72,Math.round(baseTime*12))),points=[];
  for(let i=0;i<=count;i++){
    const t=i/count,u=t;
    const lateral=Math.sin(Math.PI*u)*crossAdj*.42;
    const x=tx*u+Math.cos(rad)*lateral;
    const z=tz*u-Math.sin(rad)*lateral;
    const y=Math.max(.18,2.7+Math.sin(Math.PI*u)*apex-(Math.max(0,-launch)*.08*u*desired/10));
    points.push({x:Number(x.toFixed(2)),y:Number(y.toFixed(2)),z:Number(z.toFixed(2)),t:Number(u.toFixed(4))});
  }
  let rebound=null;
  if(wallCollision){
    const impact={...points[points.length-1]},reboundDistance=clamp(8+(ev-70)*.32,8,28),rx=impact.x-Math.sin(rad)*reboundDistance,rz=impact.z+Math.cos(rad)*reboundDistance;
    rebound=[];for(let i=1;i<=10;i++){const t=i/10;rebound.push({x:Number(lerp(impact.x,rx,t).toFixed(2)),y:Number((.2+Math.sin(Math.PI*t)*Math.min(10,apex*.1)).toFixed(2)),z:Number(lerp(impact.z,rz,t).toFixed(2)),t:Number((1+t*.18).toFixed(4))});}
    points.push(...rebound);desired=Math.max(20,wall-reboundDistance);
  }
  return {version:VERSION,presentation_only:true,outcome_constrained:true,source:{exit_velocity_mph:ev,launch_angle_deg:launch,spray_angle_deg:spray,distance_ft:reported},wind,wall_distance_ft:Number(wall.toFixed(1)),wall_collision:wallCollision,clears_wall:clearsWall,time_of_flight_s:Number(baseTime.toFixed(2)),apex_ft:Number(apex.toFixed(1)),visual_distance_ft:Number(desired.toFixed(1)),points};
}
function buildFoulFlight(pitch={},seed='foul'){
  const random=rng(`${seed}|${pitch.number||0}|${pitch.type||''}`),side=random()<.5?-1:1,spray=side*(52+random()*24),distance=55+random()*145,ev=68+random()*24,launch=28+random()*28,rad=spray*Math.PI/180,tx=Math.sin(rad)*distance,tz=-Math.cos(rad)*distance,apex=Math.max(18,Math.sin(launch*Math.PI/180)*distance*.55),points=[];
  for(let i=0;i<=18;i++){const t=i/18;points.push({x:Number((tx*t).toFixed(2)),y:Number((2.6+Math.sin(Math.PI*t)*apex).toFixed(2)),z:Number((tz*t).toFixed(2)),t:Number(t.toFixed(4))});}
  return {presentation_only:true,foul:true,exit_velocity_mph:Number(ev.toFixed(1)),launch_angle_deg:Number(launch.toFixed(1)),spray_angle_deg:Number(spray.toFixed(1)),distance_ft:Number(distance.toFixed(0)),points};
}
function buildRelayPlan(fieldingAction={},ball={},outcome='OUT'){
  const f=String(fieldingAction?.fielder_slot||''),to=Number(fieldingAction?.throw_to)||null;if(!f||!to)return [];
  const outfield=['LF','CF','RF'].includes(f),deep=num(ball?.distance_ft,0)>=210;
  if(outfield&&deep&&[2,3,4].includes(to)){
    const cutoff=(f==='LF'?'SS':f==='RF'?'2B':(to===3?'SS':'2B'));
    return [{from:f,to_slot:cutoff,kind:'relay',presentation_only:true},{from:cutoff,to_base:to,kind:'relay',presentation_only:true}];
  }
  return [{from:f,to_base:to,kind:'direct',presentation_only:true}];
}
function closePlayDescriptor(fieldingAction={},runnerMoves=[],seed='close'){
  const base=Number(fieldingAction?.throw_to)||null;if(!base)return {active:false,presentation_only:true};
  const move=(runnerMoves||[]).find(m=>Number(m.to)===base);if(!move)return {active:false,presentation_only:true};
  const random=rng(`${seed}|${move.name}|${move.from}|${move.to}`),margin=.08+random()*.7;
  return {active:true,presentation_only:true,runner:move.name,base,tag_required:base>1,visual_margin_s:Number(margin.toFixed(2)),verdict_source:'simulation_state_only'};
}
function leverageScore(e={}){
  const inning=Math.max(1,num(e.inning,1)),score=e.score||{},diff=Math.abs(num(score.home)-num(score.away)),runners=(e.bases_before||[]).filter(Boolean).length,outs=num(e.outs_before,0),late=clamp((inning-5)/4),close=clamp(1-diff/5),traffic=clamp(runners/3),twoOut=outs===2?.12:0,scoring=Math.min(.2,(e.scored||[]).length*.08),xbh=['2B','3B','HR'].includes(e.outcome)?.1:0;
  return Number(clamp(.12+.26*late+.3*close+.17*traffic+twoOut+scoring+xbh).toFixed(3));
}
function crowdReaction(e={},leverage=leverageScore(e)){
  const runs=(e.scored||[]).length,homeBat=e.half==='bottom',isHR=e.outcome==='HR',isK=e.outcome==='K',intensity=clamp(.12+leverage*.58+runs*.12+(isHR?.18:0));
  let tone='murmur';if(isHR||runs>=2)tone=homeBat?'roar':'groan';else if(runs)tone=homeBat?'cheer':'groan';else if(isK)tone=homeBat?'groan':'cheer';else if(leverage>.72)tone='anticipation';
  return {presentation_only:true,intensity:Number(intensity.toFixed(3)),tone,home_perspective:true};
}
function cameraPlan(e={},closePlay={active:false},leverage=leverageScore(e)){
  const phases={pre_pitch:leverage>.7?'pitcher':'broadcast',pitch:leverage>.76?'batter':'pitcher',contact:'broadcast',finish:'broadcast'};
  if(e.outcome==='HR')phases.contact='ball_track';
  if(closePlay?.active)phases.finish=`base_${closePlay.base}`;
  else if(['2B','3B'].includes(e.outcome)&&leverage>.55)phases.finish='stadium';
  return {presentation_only:true,auto:true,leverage,phases};
}
function replayCue(e={},closePlay={active:false},leverage=leverageScore(e)){
  const eligible=e.outcome==='HR'||['2B','3B'].includes(e.outcome)||(e.scored||[]).length>=2||closePlay?.active||leverage>=.84;
  return {presentation_only:true,eligible,reason:e.outcome==='HR'?'home_run':closePlay?.active?'close_play':(e.scored||[]).length>=2?'multi_run':leverage>=.84?'high_leverage':eligible?'extra_base_hit':null,speed:eligible?.55:1};
}
module.exports={VERSION,wallDistanceAtAngle,windComponents,buildBallFlight,buildFoulFlight,buildRelayPlan,closePlayDescriptor,leverageScore,crowdReaction,cameraPlan,replayCue,interpolatePath};
