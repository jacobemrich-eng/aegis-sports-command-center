export const GAMETWIN_CINEMATICS_VERSION='1.8.0';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number(x)||0));
const deg=x=>x*Math.PI/180;

// Presentation-only timing. The simulation outcome is already frozen before these values are used.
export function pitchPresentationTiming(pitch={}){
  const velo=Math.max(55,Math.min(105,Number(pitch.velocity_mph)||90));
  const ballFlight=.235-(velo-55)*.00175;
  const release=.58;
  const plate=Math.min(.965,release+ballFlight);
  const result=String(pitch.result||'').toLowerCase();
  const contact=['in_play','foul'].includes(result)?Math.max(release+.08,plate-.018):null;
  const receive=contact==null?plate:null;
  return {release,plate,contact,receive,flight_duration_normalized:plate-release,presentation_only:true};
}

export function batterBoxAlignment(bats='R'){
  const h=String(bats||'R').toUpperCase()==='L'?'L':'R';
  // x is across the plate, z is catcher-to-mound axis in the GameTwin world.
  return h==='L'
    ? {hand:'L',x:4.65,y:.15,z:1.25,yaw:deg(5.5),plate_offset_ft:4.65}
    : {hand:'R',x:-4.65,y:.15,z:1.25,yaw:deg(-5.5),plate_offset_ft:4.65};
}

export function attachmentOffset(kind='glove',role='fielder',hand='R'){
  const mirror=String(hand||'R').toUpperCase()==='L'?-1:1;
  const r=String(role||'fielder').toLowerCase();
  if(kind==='pitch_release')return {x:.35*mirror,y:5.55,z:-.25};
  if(kind==='bat_contact')return {x:.55*mirror,y:3.25,z:-.35};
  if(r==='catcher')return {x:.5*mirror,y:2.65,z:-.8};
  if(r==='pitcher')return {x:.5*mirror,y:4.25,z:-.25};
  return {x:.72*mirror,y:3.15,z:-.15};
}

export function throwChoreography(profile={}){
  const release=clamp(profile.release==null ? .54 : profile.release,.3,.78);
  return {release,carry:release*.72,flight_start:release,follow_end:1,presentation_only:true};
}

export function closePlayChoreography({base=2,success=null,steal=false}={}){
  const b=Math.max(1,Math.min(4,Number(base)||2));
  return {
    base:b,
    runner_slide_start:steal?.56:.62,
    tag_start:.58,
    tag_peak:.78,
    hold_end:.94,
    camera:`base_${b}`,
    result:typeof success==='boolean'?(success?'SAFE':'OUT'):'SIMULATION_STATE_ONLY',
    presentation_only:true
  };
}

export function runnerBodyPlan({from=0,to=1,t=0,slide=false}={}){
  const q=clamp(t),sl=!!slide;
  return {lean:sl?deg(54)*clamp((q-.55)/.45):deg(8)*Math.sin(Math.PI*q),yaw_bias:0,body_drop:sl?1.25*clamp((q-.58)/.42):0,presentation_only:true};
}

export function celebrationSequence(event={}){
  const outcome=String(event.outcome||'').toUpperCase(),scored=(event.scored||[]).length,lev=clamp(event.leverage||0);
  if(outcome==='HR')return [
    {camera:'ball_track',duration:1.0,cue:'track_clearance'},
    {camera:'batter',duration:.55+.25*lev,cue:'batter_reaction'},
    {camera:'stadium',duration:.65+.35*Math.min(1,scored/3),cue:'crowd_wide'}
  ];
  if(scored>0&&lev>.65)return [{camera:'base_4',duration:.45,cue:'plate_crossing'},{camera:'stadium',duration:.5,cue:'crowd_wide'}];
  return [];
}

export function broadcastCameraDecision(event={},phase='pre_pitch',{replay=false}={}){
  const explicit=event?.camera_plan?.phases?.[phase];
  const outcome=String(event.outcome||'').toUpperCase();
  const leverage=clamp(event.leverage||0);
  const close=event?.close_play?.active;
  const base=Math.max(1,Math.min(4,Number(event?.close_play?.base)||2));
  if(replay){
    if(outcome==='HR')return phase==='contact'?'ball_track':'batter';
    if(close)return `base_${base}`;
    if(phase==='pitch')return 'pitcher';
  }
  if(close&&['finish','runner','tag'].includes(phase))return `base_${base}`;
  if(outcome==='HR'&&phase==='contact')return 'ball_track';
  if(outcome==='HR'&&phase==='finish')return 'batter';
  if(event.kind==='steal_attempt'&&phase==='finish')return `base_${Math.max(1,Math.min(4,Number(event.to)||2))}`;
  if(phase==='pre_pitch'&&leverage>=.82)return 'pitcher';
  if(phase==='pitch'&&leverage>=.9)return 'pitcher';
  return explicit||({pre_pitch:'broadcast',pitch:'broadcast',contact:'ball_track',finish:'broadcast'}[phase]||'broadcast');
}
