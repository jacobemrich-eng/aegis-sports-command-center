'use strict';

const VERSION='2.1.0-deployment-readiness';
const physics=require('./gametwin-physics');
const BASE_INDEX={home:0,first:1,second:2,third:3};
const PITCH_PRESETS={
  FF:{name:'4-Seam Fastball',velo:95.2,breakX:0,breakY:2},FA:{name:'Fastball',velo:94.5,breakX:0,breakY:2},SI:{name:'Sinker',velo:94.0,breakX:-5,breakY:5},FC:{name:'Cutter',velo:90.8,breakX:4,breakY:4},
  SL:{name:'Slider',velo:86.4,breakX:8,breakY:9},ST:{name:'Sweeper',velo:83.6,breakX:14,breakY:8},CU:{name:'Curveball',velo:79.9,breakX:5,breakY:16},KC:{name:'Knuckle Curve',velo:81.2,breakX:4,breakY:15},
  CH:{name:'Changeup',velo:86.1,breakX:-6,breakY:8},FS:{name:'Splitter',velo:87.2,breakX:-2,breakY:12},FO:{name:'Forkball',velo:84.5,breakX:-2,breakY:13},KN:{name:'Knuckleball',velo:76.0,breakX:4,breakY:6}
};
function num(x,fb=null){const n=Number(x);return Number.isFinite(n)?n:fb;}
function clamp(x,lo=0,hi=1){x=Number(x);return Number.isFinite(x)?Math.max(lo,Math.min(hi,x)):lo;}
function fnv1a(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h||1;}
function rng(seed){let x=typeof seed==='number'?(seed>>>0):fnv1a(seed);return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}
function weighted(items,weightKey,random){const rows=(items||[]).filter(Boolean);if(!rows.length)return null;let total=rows.reduce((s,r)=>s+Math.max(0,num(r[weightKey],0)),0);if(total<=0)return rows[Math.floor(random()*rows.length)];let x=random()*total;for(const row of rows){x-=Math.max(0,num(row[weightKey],0));if(x<=0)return row;}return rows[rows.length-1];}
function fieldDimensions(details={}){
  const f=details?.fieldInfo||{};
  const pick=(...vals)=>vals.map(v=>num(v)).find(Number.isFinite);
  return {
    left_line:pick(f.leftLine,f.leftFieldLine,330),left:pick(f.left,340),left_center:pick(f.leftCenter,375),center:pick(f.center,400),right_center:pick(f.rightCenter,375),right:pick(f.right,340),right_line:pick(f.rightLine,f.rightFieldLine,330),
    surface:f.turfType||f.surface||'Grass',roof:f.roofType||'Open',capacity:pick(details?.capacity,f.capacity,null)
  };
}
function compactPlayer(p={}){return {id:num(p.id),name:p.name||'Player',position:typeof p.position==='string'?p.position:(p.position?.abbreviation||p.pos||null),bats:p.bat_side||p.batSide||p.bat||null,throws:p.pitch_hand||p.pitchHand||null,avg_exit_velocity:num(p.statcast?.avg_exit_velocity),avg_launch_angle:num(p.statcast?.avg_launch_angle)};}
function compactPitcher(p={}){return {...compactPlayer(p),role:p.role||null,arsenal:(p.arsenal||[]).slice(0,8).map(a=>({pitch_type:String(a.pitch_type||'FF').toUpperCase(),pitch_name:a.pitch_name||null,usage:num(a.usage,0),whiff_pct:num(a.whiff_pct),xwoba:num(a.xwoba)}))};}
function compactTeam(team={}){return {name:team.name||'',lineup:(team.lineup||[]).map(compactPlayer),starter:compactPitcher(team.starter||{}),bullpen:(team.bullpen||[]).map(compactPitcher)};}
function compactContext(spec={}){
  const details=spec.venue?.details||{},coords=details?.location?.defaultCoordinates||{},tz=details?.timeZone?.id||details?.timezone?.id||details?.timeZone||details?.timezone||null;
  return {version:VERSION,gamePk:num(spec.gamePk),date:spec.date||null,venue:{id:num(spec.venue?.id),name:spec.venue?.name||'MLB Ballpark',field:fieldDimensions(details),timezone:typeof tz==='string'?tz:null,coordinates:{latitude:num(coords.latitude),longitude:num(coords.longitude)}},weather:{...(spec.environment||{})},away:compactTeam(spec.away||{}),home:compactTeam(spec.home||{}),presentation_only:true};
}
function pitcherMap(ctx){const m=new Map();for(const team of [ctx.away,ctx.home])for(const p of [team?.starter,...(team?.bullpen||[])])if(p?.name)m.set(p.name,p);return m;}
function playerMap(ctx){const m=new Map();for(const team of [ctx.away,ctx.home])for(const p of team?.lineup||[])if(p?.name)m.set(p.name,p);return m;}
function pitchPreset(type){return PITCH_PRESETS[String(type||'FF').toUpperCase()]||PITCH_PRESETS.FF;}
function pitchResultSequence(outcome,count,random){
  count=Math.max(1,Math.min(10,Number(count)||1));const out=[];let balls=0,strikes=0;
  for(let i=0;i<count;i++){
    const last=i===count-1;let result;
    if(last){if(outcome==='K')result=random()<.72?'swinging_strike':'called_strike';else if(outcome==='BB')result='ball';else if(outcome==='HBP')result='hit_by_pitch';else if(['1B','2B','3B','HR','OUT'].includes(outcome))result='in_play';else result='in_play';}
    else{
      const needBalls=outcome==='BB'&&balls<3,needStrikes=outcome==='K'&&strikes<2;
      if(needBalls&&random()<.62)result='ball';else if(needStrikes&&random()<.68)result=random()<.45?'called_strike':'swinging_strike';else result=random()<.48?'ball':(random()<.56?'called_strike':'foul');
    }
    if(result==='ball'||result==='hit_by_pitch')balls++;else if(['called_strike','swinging_strike'].includes(result))strikes++;else if(result==='foul'&&strikes<2)strikes++;
    out.push({result,balls_before:Math.min(3,balls-(result==='ball'||result==='hit_by_pitch'?1:0)),strikes_before:Math.min(2,strikes-(['called_strike','swinging_strike'].includes(result)?1:(result==='foul'&&strikes<=2?1:0))),balls_after:Math.min(4,balls),strikes_after:Math.min(3,strikes)});
  }
  return out;
}
function buildPitch(pitcher,outcome,count,index,random){
  const a=weighted(pitcher?.arsenal,'usage',random),type=String(a?.pitch_type||(['K','OUT'].includes(outcome)?(random()<.55?'FF':'SL'):(outcome==='BB'?'CH':'FF'))).toUpperCase(),preset=pitchPreset(type),velo=Math.max(65,Math.min(103,preset.velo+(random()-.5)*5)),side=random()<.5?-1:1;
  return {number:index+1,type,name:a?.pitch_name||preset.name,velocity_mph:Number(velo.toFixed(1)),spin_hint:a?.whiff_pct??null,break_x:Number((preset.breakX*side+(random()-.5)*2).toFixed(1)),break_y:Number((preset.breakY+(random()-.5)*2).toFixed(1)),plate_x:Number(((random()-.5)*1.7).toFixed(2)),plate_z:Number((1.6+random()*2.2).toFixed(2))};
}
function battedBall(outcome,batter,random){
  if(!['1B','2B','3B','HR','OUT'].includes(outcome))return null;
  const evBase=num(batter?.avg_exit_velocity,89),ev=Math.max(62,Math.min(118,evBase+(outcome==='HR'?15:outcome==='2B'||outcome==='3B'?8:outcome==='1B'?3:0)+(random()-.5)*12));
  let launch;if(outcome==='HR')launch=23+random()*14;else if(outcome==='3B')launch=14+random()*17;else if(outcome==='2B')launch=10+random()*20;else if(outcome==='1B')launch=-5+random()*22;else launch=random()<.48?-18+random()*20:22+random()*32;
  const direction=(random()-.5)*70,distance=outcome==='HR'?365+random()*95:outcome==='3B'?280+random()*95:outcome==='2B'?220+random()*120:outcome==='1B'?80+random()*170:80+random()*330;
  return {exit_velocity_mph:Number(ev.toFixed(1)),launch_angle_deg:Number(launch.toFixed(1)),spray_angle_deg:Number(direction.toFixed(1)),distance_ft:Number(distance.toFixed(0)),result:outcome};
}
function fieldingAction(ball,outcome,random){
  if(!ball)return null;
  const angle=Number(ball.spray_angle_deg)||0,d=Number(ball.distance_ft)||0,launch=Number(ball.launch_angle_deg)||0;
  let fielder;
  if(d<175){if(angle<-24)fielder='3B';else if(angle<-5)fielder='SS';else if(angle<16)fielder='2B';else fielder='1B';}
  else {if(angle<-18)fielder='LF';else if(angle>18)fielder='RF';else fielder='CF';}
  let throw_to=null,action='retrieve';
  if(outcome==='OUT'){action=launch>12?'catch':'field_and_throw';throw_to=launch>12?null:1;}
  else if(outcome==='1B'){throw_to=random()<.55?2:3;}
  else if(outcome==='2B'){throw_to=2;}
  else if(outcome==='3B'){throw_to=3;}
  else if(outcome==='HR'){action='track_wall';throw_to=null;}
  return {presentation_only:true,fielder_slot:fielder,action,throw_to,urgency:outcome==='OUT'?'high':outcome==='3B'?'high':'medium'};
}
function locateRunner(name,bases){for(let i=0;i<3;i++)if(bases[i]===name)return i+1;return null;}
function runnerMoves(before,after,scored,batter,outcome){
  const moves=[];const names=new Set([...(before||[]).filter(Boolean),batter].filter(Boolean));
  for(const name of names){const from=before?.includes(name)?(before.indexOf(name)+1):0;let to=locateRunner(name,after);if((scored||[]).includes(name))to=4;if(name===batter&&['K','OUT'].includes(outcome))to=null;if(to!=null&&to!==from)moves.push({name,from,to});}
  return moves;
}
function scoreboardState(away,home,inning,half){return {away,home,inning,half};}
function buildBroadcast(row={}){
  const ctx=row.broadcast_context||row.context||{},game=row.representative_game||{},events=game.play_by_play||[],pmap=pitcherMap(ctx),bmap=playerMap(ctx),out=[];let away=0,home=0,bases=[null,null,null],lastHalf=null,lastInning=null,lastPitcher=null;
  for(let i=0;i<events.length;i++){
    const e=events[i];if(e.type==='automatic_runner'){bases[e.base-1]=e.runner;out.push({kind:'automatic_runner',index:i,inning:e.inning,half:e.half,runner:e.runner,base:e.base,score:scoreboardState(away,home,e.inning,e.half),bases_after:[...bases],duration_ms:900});continue;}
    if(e.type==='steal'){const from=Number(e.from_base)||1,to=Number(e.to_base)||Math.min(4,from+1),runner=e.runner||bases[from-1]||'Runner',success=e.success!==false;const beforeSteal=[...bases];if(success){if(from>=1&&from<=3)bases[from-1]=null;if(to>=1&&to<=3)bases[to-1]=runner;}const stealEvent={kind:'steal_attempt',index:i,inning:e.inning,half:e.half,runner,from,to,success,presentation_only:true,bases_before:beforeSteal,bases_after:[...bases],score:scoreboardState(away,home,e.inning,e.half),duration_ms:1500};stealEvent.leverage=physics.leverageScore({...stealEvent,bases_before:beforeSteal,outs_before:e.outs_before||0,scored:[]});stealEvent.crowd_reaction=physics.crowdReaction(stealEvent,stealEvent.leverage);stealEvent.camera_plan={presentation_only:true,auto:true,leverage:stealEvent.leverage,phases:{pre_pitch:'broadcast',pitch:'base_'+to,contact:'base_'+to,finish:'base_'+to}};out.push(stealEvent);continue;}
    if(lastHalf!==e.half||lastInning!==e.inning){bases=[null,null,null];lastPitcher=null;lastHalf=e.half;lastInning=e.inning;out.push({kind:'half_inning',inning:e.inning,half:e.half,score:scoreboardState(away,home,e.inning,e.half),duration_ms:800});}
    if(lastPitcher&&lastPitcher!==e.pitcher)out.push({kind:'pitching_change',inning:e.inning,half:e.half,pitcher:e.pitcher,score:scoreboardState(away,home,e.inning,e.half),duration_ms:1200});
    lastPitcher=e.pitcher;
    const random=rng(`${ctx.gamePk||0}|${e.inning}|${e.half}|${e.pa_number}|${e.batter}|${e.pitcher}`),pitcher=pmap.get(e.pitcher)||{name:e.pitcher,arsenal:[]},batter=bmap.get(e.batter)||{name:e.batter},seq=pitchResultSequence(e.outcome,e.pitch_count,random),pitches=seq.map((s,j)=>{const p={...buildPitch(pitcher,e.outcome,e.pitch_count,j,random),...s};if(p.result==='foul')p.foul_flight=physics.buildFoulFlight(p,`${ctx.gamePk}|${e.inning}|${e.half}|${e.pa_number}|${j}`);return p;}),before=[...bases],bb=battedBall(e.outcome,batter,random);
    bases=Array.isArray(e.bases)?[...e.bases]:bases;const runs=(e.scored||[]).length;if(e.half==='top')away+=runs;else home+=runs;
    const score=scoreboardState(away,home,e.inning,e.half),moves=runnerMoves(before,bases,e.scored||[],e.batter,e.outcome),fa=fieldingAction(bb,e.outcome,random),visualMoves=(e.outcome==='OUT'&&fa?.throw_to===1&&!moves.some(m=>m.name===e.batter))?[...moves,{name:e.batter,from:0,to:1,presentation_only:true,simulated_out:true}]:moves,flight=bb?physics.buildBallFlight(bb,ctx.weather||row.weather||{},ctx.venue?.field||{},e.outcome):null,relay=physics.buildRelayPlan(fa,bb,e.outcome),close=physics.closePlayDescriptor(fa,visualMoves,`${ctx.gamePk}|${e.inning}|${e.half}|${e.pa_number}`);const baseEvent={kind:'plate_appearance',index:i,inning:e.inning,half:e.half,pa_number:e.pa_number,batter:e.batter,pitcher:e.pitcher,outcome:e.outcome,pitch_count:e.pitch_count,outs_before:e.outs_before,outs_after:e.outs_after,scored:e.scored||[],bases_before:before,bases_after:[...bases],runner_moves:moves,visual_runner_moves:visualMoves,pitches,batted_ball:bb,ball_flight:flight,fielding_action:fa,relay_plan:relay,close_play:close,matchup:e.matchup||null,batter_profile:{...batter},pitcher_profile:{...pitcher},score,duration_ms:Math.min(9800,1950+pitches.length*470+(bb?2850:0))};baseEvent.leverage=physics.leverageScore(baseEvent);baseEvent.crowd_reaction=physics.crowdReaction(baseEvent,baseEvent.leverage);baseEvent.camera_plan=physics.cameraPlan(baseEvent,close,baseEvent.leverage);baseEvent.replay=physics.replayCue(baseEvent,close,baseEvent.leverage);out.push(baseEvent);
  }
  return {version:VERSION,presentation_only:true,gamePk:ctx.gamePk||row.gamePk||null,date:ctx.date||row.date||null,pregame_win_probability:{away:num(row.win_probability?.away,.5),home:num(row.win_probability?.home,.5)},venue:ctx.venue||{name:row.venue||'MLB Ballpark',field:fieldDimensions({}),timezone:null,coordinates:{}},weather:ctx.weather||row.weather||{},teams:{away:ctx.away?.name||row.away,home:ctx.home?.name||row.home},rosters:{away:ctx.away||null,home:ctx.home||null},final:game.final||null,events:out,capabilities:{true_3d:true,render_engine:'Three.js 0.185.1',visual_fidelity_version:'1.9.0',pbr_materials:true,procedural_pbr_textures:true,material_microdetail:true,imported_material_finishing:true,fabric_surface_response:true,leather_surface_response:true,glb_asset_pipeline:true,role_specific_glb_slots:true,skeleton_safe_cloning:true,external_asset_fail_safe:true,animation_blending_ready:true,asset_lod_selection:true,asset_triangle_budget_validation:true,asset_preload:true,asset_animation_contract_validation:true,bundled_original_glb_assets:true,bundled_character_lods:true,bundled_stadium_lods:true,bundled_asset_license:'original-gametwin',external_team_color_tinting:true,procedural_animation_blending:true,motion_blend_profiles:true,root_motion_stabilization:true,ground_contact_damping:true,character_pack_version:'1.7.0',advanced_baseball_animation_version:'1.7.0',cinematic_gameplay_version:'1.8.0',broadcast_director_version:'1.9.0',broadcast_experience_version:'2.0.0',deployment_readiness_version:'2.1.0',collision_safe_mobile_hud:true,orientation_layout_profiles:true,reduced_motion_support:true,renderer_performance_telemetry:true,asset_deployment_verification:true,broadcast_lower_thirds:true,pitch_location_overlay:true,contact_telemetry_cards:true,representative_state_probability_estimate:true,calibrated_live_win_probability:false,replay_graphics:true,inning_transition_cards:true,bullpen_transition_cards:true,between_pa_cuts:true,event_camera_timelines:true,multi_pass_replay_engine:true,slow_motion_replay_passes:true,runner_throw_race_synchronization:true,home_run_landing_shots:true,tv_transition_policy:true,release_contact_synchronization:true,batter_box_alignment:true,ball_hand_attachment:true,glove_ball_attachment:true,throw_release_choreography:true,close_play_choreography:true,runner_body_orientation:true,home_run_celebration_sequence:true,contextual_replay_camera:true,multi_stage_pitching:true,handed_batting_stances:true,contextual_throw_mechanics:true,catcher_receive_pop:true,runner_slide_animation:true,home_run_trot:true,contextual_reactions:true,analytical_two_bone_foot_ik:true,role_specific_player_rigs:true,catcher_gear_variant:true,umpire_gear_variant:true,generic_uniform_equipment:true,eased_camera_transitions:true,instanced_crowd:true,crowd_depth_layers:true,stadium_geometry:true,stadium_pack_version:'1.7.0',generic_dugouts:true,generic_bullpens:true,generic_video_board:true,generic_light_trusses:true,generic_concourse_ribbons:true,park_identity_profiles:true,venue_shaped_shell:true,actual_field_dimensions:true,weather_visualization:true,day_night_lighting:true,crowd_ambience_hook:true,leverage_crowd_reactions:true,mobile_quality_tiers:['auto','low','medium','high'],pitch_trajectories:true,foul_ball_trajectories:true,outcome_constrained_ball_physics:true,wind_aware_visual_flight:true,wall_collisions:true,ball_in_play:true,runner_paths:true,fielder_pursuit:true,throw_choreography:true,relay_throws:true,close_play_tags:true,stolen_base_events:'render_when_present',articulated_player_rigs:true,animation_states:['idle','stance_left','stance_right','pitch_set','pitch_lift','pitch_drive','pitch_follow','pitch','swing_load','swing_contact','swing_follow','swing','run','trot','slide','field','throw','throw_infield','throw_outfield','throw_catcher','catch','receive','tag','celebrate','react_strikeout','react_out'],camera_modes:['auto','broadcast','batter','pitcher','stadium','ball_track','plate_low','outfield_wall','dugout','cf','base_1','base_2','base_3','base_4'],leverage_camera_director:true,instant_replay_cues:true,webgl2_fallback:true,photorealistic_players:false,licensed_stadium_asset_models:false}};
}

module.exports={VERSION,PITCH_PRESETS,fieldDimensions,compactContext,pitchResultSequence,buildPitch,battedBall,fieldingAction,runnerMoves,buildBroadcast,rng};
