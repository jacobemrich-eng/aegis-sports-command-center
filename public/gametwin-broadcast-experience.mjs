export const GAMETWIN_BROADCAST_EXPERIENCE_VERSION='2.0.0';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number(x)||0));
const upper=x=>String(x||'').toUpperCase();
const ordinal=n=>{n=Number(n)||1;const m=n%100;if(m>=11&&m<=13)return `${n}TH`;return `${n}${n%10===1?'ST':n%10===2?'ND':n%10===3?'RD':'TH'}`;};
const logistic=x=>1/(1+Math.exp(-x));
const logit=p=>Math.log(clamp(p,.001,.999)/(1-clamp(p,.001,.999)));
const scoreOf=e=>({away:Number(e?.score?.away)||0,home:Number(e?.score?.home)||0});
const baseCount=e=>(e?.bases_after||e?.bases_before||[]).filter(Boolean).length;

export function pitchLocationOverlay(pitch={}){
  const plateX=Number(pitch.plate_x)||0,plateZ=Number(pitch.plate_z)||2.5;
  // MLB plate is 17 in wide; use a padded visual box so misses remain visible.
  const nx=clamp(.5+plateX/3.2,.03,.97),nz=clamp(1-(plateZ-1.0)/3.8,.03,.97);
  const inZone=Math.abs(plateX)<=.83&&plateZ>=1.5&&plateZ<=3.5;
  const col=Math.max(0,Math.min(2,Math.floor(clamp((plateX+.83)/1.66)*3)));
  const row=Math.max(0,Math.min(2,Math.floor(clamp((3.5-plateZ)/2)*3)));
  return {
    x:nx,y:nz,plate_x:plateX,plate_z:plateZ,in_visual_strike_zone:inZone,
    zone_cell:inZone?(row*3+col+1):null,
    label:inZone?'ZONE':'EDGE / MISS',
    pitch_name:pitch.name||pitch.type||'Pitch',velocity_mph:Number(pitch.velocity_mph)||null,
    result:pitch.result||null,presentation_only:true,predictive_authority:false
  };
}

export function contactTelemetry(event={}){
  const b=event.batted_ball||{};
  if(!event.batted_ball)return null;
  const ev=Number(b.exit_velocity_mph),la=Number(b.launch_angle_deg),dist=Number(b.distance_ft),spray=Number(b.spray_angle_deg);
  return {
    exit_velocity_mph:Number.isFinite(ev)?ev:null,
    launch_angle_deg:Number.isFinite(la)?la:null,
    distance_ft:Number.isFinite(dist)?dist:null,
    spray_angle_deg:Number.isFinite(spray)?spray:null,
    outcome:event.outcome||b.result||null,
    label:'SIM CONTACT',
    source:'representative_event_choreography',
    presentation_only:true,predictive_authority:false
  };
}

export function representativeStateEstimate(event={},pregameAway=.5){
  const p0=clamp(pregameAway,.02,.98),score=scoreOf(event),inning=Math.max(1,Number(event.inning)||1),half=String(event.half||'top').toLowerCase();
  const scoreDiff=score.away-score.home,lateWeight=.36+Math.min(1.15,inning/9)*.62;
  // Tiny visual-only game-state adjustments: score leads dominate; base/out context is deliberately bounded.
  const offenseAway=half==='top',runners=baseCount(event),outs=Math.max(0,Math.min(3,Number(event.outs_after??event.outs_before)||0));
  const baseAdj=(runners*.055)*(offenseAway?1:-1),outAdj=(outs*.022)*(offenseAway?-1:1);
  const x=logit(p0)+scoreDiff*lateWeight+baseAdj+outAdj;
  const away=clamp(logistic(x),.01,.99);
  return {
    away,home:1-away,
    label:'SIM STATE EST.',
    calibrated_live_wp:false,
    betting_model_input:false,
    source:'representative_game_state_visual_estimate',
    presentation_only:true,predictive_authority:false
  };
}

export function stateSwing(event={},pregameAway=.5,priorAway=null){
  const current=representativeStateEstimate(event,pregameAway),before=Number.isFinite(Number(priorAway))?clamp(priorAway,.01,.99):clamp(pregameAway,.01,.99),delta=current.away-before;
  return {...current,before_away:before,after_away:current.away,delta_away:delta,direction:Math.abs(delta)<.002?'flat':delta>0?'up':'down'};
}

export function lowerThirdForEvent(event={},phase='pre'){
  const inning=`${upper(event.half||'top')} ${ordinal(event.inning||1)}`;
  if(event.kind==='pitching_change')return {eyebrow:'TO THE BULLPEN',primary:event.pitcher||'Reliever',secondary:`Pitching change • ${inning}`,accent:'amber',hold_ms:1700,presentation_only:true};
  if(event.kind==='half_inning')return {eyebrow:'GAME STATE',primary:inning,secondary:'Representative simulation',accent:'blue',hold_ms:1200,presentation_only:true};
  if(event.kind==='automatic_runner')return {eyebrow:'EXTRA INNINGS',primary:event.runner||'Automatic runner',secondary:`Starts at ${event.base||2}B • ${inning}`,accent:'amber',hold_ms:1300,presentation_only:true};
  if(event.kind==='steal_attempt')return {eyebrow:'BASERUNNING',primary:event.runner||'Runner',secondary:`${phase==='post'?(event.success?'SAFE':'OUT'):'Breaks for '+(event.to===4?'HOME':`${event.to}B`)} • ${inning}`,accent:event.success?'green':'blue',hold_ms:1000,presentation_only:true};
  if(event.kind==='plate_appearance'){
    if(phase==='post')return {eyebrow:'RESULT',primary:`${event.batter||'Batter'} • ${event.outcome||'PA'}`,secondary:`${inning}${event.scored?.length?` • ${event.scored.length} run${event.scored.length===1?'':'s'} scored`:''}`,accent:upper(event.outcome)==='HR'?'green':'blue',hold_ms:900,presentation_only:true};
    return {eyebrow:'AT BAT',primary:event.batter||'Batter',secondary:`vs ${event.pitcher||'Pitcher'} • ${inning}`,accent:'blue',hold_ms:1100,presentation_only:true};
  }
  return null;
}

export function transitionPackage(event={},teams={}){
  const score=scoreOf(event),away=teams.away||'AWAY',home=teams.home||'HOME';
  if(event.kind==='half_inning')return {kind:'inning',kicker:'INNING',title:`${upper(event.half||'top')} ${ordinal(event.inning||1)}`,subtitle:`${away} ${score.away}  •  ${home} ${score.home}`,camera:'stadium',hold_ms:1150,presentation_only:true};
  if(event.kind==='pitching_change')return {kind:'bullpen',kicker:'PITCHING CHANGE',title:'TO THE BULLPEN',subtitle:event.pitcher||'Reliever',camera:'dugout',exit_camera:'pitcher',hold_ms:1450,presentation_only:true};
  if(event.kind==='automatic_runner')return {kind:'runner',kicker:'EXTRA INNINGS',title:'AUTOMATIC RUNNER',subtitle:`${event.runner||'Runner'} starts at ${event.base||2}B`,camera:'stadium',hold_ms:1050,presentation_only:true};
  return null;
}

export function replayGraphic(pass={},event={}){
  const outcome=upper(event.outcome),angle=String(pass.label||pass.id||'Replay');
  return {bug:'INSTANT REPLAY',angle,speed:Number(pass.speed)||1,result:outcome||null,accent:outcome==='HR'?'green':'blue',presentation_only:true,predictive_authority:false};
}

export function betweenPACut(event={}){
  if(event.kind!=='plate_appearance')return null;
  const outcome=upper(event.outcome),lev=clamp(event.leverage);
  if(outcome==='HR')return {camera:'dugout',cue:'home_run_reset',hold_ms:520};
  if((event.scored||[]).length)return {camera:'stadium',cue:'score_reset',hold_ms:420};
  if(lev>=.82)return {camera:'pitcher',cue:'leverage_reset',hold_ms:360};
  if(['K','OUT'].includes(outcome))return {camera:'batter',cue:'result_reset',hold_ms:300};
  return {camera:'broadcast',cue:'standard_reset',hold_ms:260};
}

export function broadcastExperienceSummary(){
  return {
    version:GAMETWIN_BROADCAST_EXPERIENCE_VERSION,
    pitch_location_overlay:true,
    contact_telemetry_cards:true,
    broadcast_lower_thirds:true,
    representative_state_probability_estimate:true,
    calibrated_live_win_probability:false,
    replay_graphics:true,
    inning_transition_cards:true,
    bullpen_transition_cards:true,
    between_pa_cuts:true,
    presentation_only:true,predictive_authority:false
  };
}
