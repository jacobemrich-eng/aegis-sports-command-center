export const GAMETWIN_DIRECTOR_VERSION='1.9.0';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number(x)||0));
const upper=x=>String(x||'').toUpperCase();

export function transitionFor({from='broadcast',to='broadcast',replay=false,leverage=0}={}){
  if(from===to)return {style:'hold',duration_ms:0};
  if(replay)return {style:'cut',duration_ms:0};
  const lev=clamp(leverage);
  if(/^base_/.test(to)||to==='plate_low'||to==='outfield_wall')return {style:'cut',duration_ms:0};
  if(to==='ball_track')return {style:lev>.72?'cut':'ease',duration_ms:lev>.72?0:180};
  if(to==='stadium'||to==='dugout')return {style:'ease',duration_ms:360};
  return {style:'ease',duration_ms:lev>.82?120:240};
}

export function eventCameraTimeline(event={}){
  const outcome=upper(event.outcome),lev=clamp(event.leverage),close=!!event?.close_play?.active;
  const base=Math.max(1,Math.min(4,Number(event?.close_play?.base)||2));
  if(event.kind==='steal_attempt')return [
    {phase:'pre_pitch',camera:'broadcast',cue:'runner_hold'},
    {phase:'pitch',camera:'plate_low',cue:'runner_break'},
    {phase:'runner',camera:`base_${Math.max(1,Math.min(4,Number(event.to)||2))}`,cue:'throw_race'},
    {phase:'finish',camera:`base_${Math.max(1,Math.min(4,Number(event.to)||2))}`,cue:'tag_hold'}
  ];
  const timeline=[
    {phase:'pre_pitch',camera:lev>=.82?'pitcher':'broadcast',cue:lev>=.82?'leverage_setup':'standard_setup'},
    {phase:'pitch',camera:lev>=.9?'pitcher':'broadcast',cue:'delivery'},
  ];
  if(outcome==='HR')timeline.push(
    {phase:'contact',camera:'batter',cue:'contact'},
    {phase:'flight',camera:'ball_track',cue:'track_ball'},
    {phase:'landing',camera:'outfield_wall',cue:'landing_clearance'},
    {phase:'finish',camera:'batter',cue:'batter_reaction'},
    {phase:'crowd',camera:'stadium',cue:'crowd_wide'}
  );
  else if(event.batted_ball)timeline.push(
    {phase:'contact',camera:'ball_track',cue:'ball_in_play'},
    {phase:'field',camera:close?`base_${base}`:'broadcast',cue:close?'anticipate_close_play':'fielding'},
    {phase:'runner',camera:close?`base_${base}`:'stadium',cue:close?'runner_throw_race':'advance'},
    {phase:'finish',camera:close?`base_${base}`:'broadcast',cue:close?'tag_hold':'result'}
  );
  else timeline.push({phase:'finish',camera:lev>.78?'batter':'broadcast',cue:'plate_result'});
  return timeline.map((shot,i)=>({...shot,index:i,presentation_only:true}));
}

export function cameraForPhase(event={},phase='pre_pitch',{replay=false,override=null}={}){
  if(override)return override;
  const timeline=eventCameraTimeline(event);
  const exact=timeline.find(s=>s.phase===phase);
  if(exact)return exact.camera;
  if(replay&&event?.close_play?.active)return `base_${Math.max(1,Math.min(4,Number(event.close_play.base)||2))}`;
  return 'broadcast';
}

export function runnerThrowRacePlan(event={}){
  const close=event.close_play||{},margin=Math.max(.04,Math.min(.8,Number(close.visual_margin_s)||.24)),lev=clamp(event.leverage);
  // Presentation multipliers only. Both branches converge at the tag window; the simulation still owns SAFE/OUT.
  const urgency=.9+lev*.3;
  const runner=Number((urgency*(1+Math.min(.12,margin*.12))).toFixed(3));
  const thrower=Number((urgency*(1+Math.min(.16,margin*.18))).toFixed(3));
  return {runner_speed_multiplier:runner,throw_speed_multiplier:thrower,tag_window_normalized:.86,visual_margin_s:margin,verdict_source:'simulation_state_only',presentation_only:true};
}

export function replayPasses(event={}){
  const outcome=upper(event.outcome),close=!!event?.close_play?.active,eligible=event?.replay?.eligible!==false;
  if(!eligible)return [];
  if(outcome==='HR')return [
    {id:'contact',segment:'pitch_contact',camera:'plate_low',speed:.48,transition:'cut',label:'Contact'},
    {id:'flight',segment:'flight',camera:'outfield_wall',speed:.42,transition:'cut',label:'Flight / clearance'},
    {id:'reaction',segment:'reaction',camera:'batter',speed:.62,transition:'ease',label:'Batter reaction'}
  ];
  if(close)return [
    {id:'race',segment:'race',camera:`base_${Math.max(1,Math.min(4,Number(event.close_play.base)||2))}`,speed:.46,transition:'cut',label:'Runner vs throw'},
    {id:'tag',segment:'tag',camera:'plate_low',speed:.38,transition:'cut',label:'Tag / bag'}
  ];
  if(['2B','3B'].includes(outcome)||(event.scored||[]).length>=2)return [
    {id:'contact',segment:'flight',camera:'ball_track',speed:.52,transition:'cut',label:'Ball flight'},
    {id:'advance',segment:'runner',camera:'stadium',speed:.58,transition:'ease',label:'Runner advance'}
  ];
  if(clamp(event.leverage)>=.84)return [{id:'leverage',segment:'pitch_contact',camera:'pitcher',speed:.55,transition:'cut',label:'High-leverage pitch'}];
  return [];
}

export function replaySummary(event={}){
  const passes=replayPasses(event);
  return {eligible:passes.length>0,pass_count:passes.length,passes:passes.map(p=>({id:p.id,camera:p.camera,speed:p.speed,label:p.label})),presentation_only:true};
}

export function landingShot(event={}){
  const outcome=upper(event.outcome),ball=event.batted_ball||{};
  if(outcome!=='HR')return null;
  const spray=Number(ball.spray_angle_deg)||0,distance=Number(ball.distance_ft)||390;
  return {camera:'outfield_wall',side:spray< -12?'left':spray>12?'right':'center',distance_ft:distance,hold_ms:distance>430?620:460,presentation_only:true};
}
