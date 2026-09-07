export const GAMETWIN_MOTION_VERSION='1.7.0';

const DEFAULT={fade:.18,timeScale:1,loop:false,responsiveness:10,groundLock:.72};
export const MOTION_PROFILES=Object.freeze({
  idle:{...DEFAULT,fade:.24,loop:true,responsiveness:7,groundLock:.92},
  stance_left:{...DEFAULT,fade:.18,loop:true,responsiveness:8,groundLock:.96},
  stance_right:{...DEFAULT,fade:.18,loop:true,responsiveness:8,groundLock:.96},
  pitch_set:{...DEFAULT,fade:.10,timeScale:1,responsiveness:14,groundLock:.98},
  pitch_lift:{...DEFAULT,fade:.08,timeScale:1,responsiveness:16,groundLock:.94},
  pitch_drive:{...DEFAULT,fade:.06,timeScale:1.04,responsiveness:18,groundLock:.76},
  pitch_follow:{...DEFAULT,fade:.08,timeScale:1,responsiveness:15,groundLock:.86},
  pitch:{...DEFAULT,fade:.14,timeScale:1.02,responsiveness:13,groundLock:.78},
  swing_load:{...DEFAULT,fade:.07,timeScale:1,responsiveness:17,groundLock:.96},
  swing_contact:{...DEFAULT,fade:.045,timeScale:1.09,responsiveness:20,groundLock:.9},
  swing_follow:{...DEFAULT,fade:.07,timeScale:1.03,responsiveness:16,groundLock:.9},
  swing:{...DEFAULT,fade:.10,timeScale:1.08,responsiveness:15,groundLock:.86},
  run:{...DEFAULT,fade:.18,timeScale:1.0,loop:true,responsiveness:12,groundLock:.96},
  trot:{...DEFAULT,fade:.20,timeScale:.76,loop:true,responsiveness:9,groundLock:.98},
  slide:{...DEFAULT,fade:.08,timeScale:1.03,responsiveness:18,groundLock:.84},
  field:{...DEFAULT,fade:.13,timeScale:1.0,responsiveness:12,groundLock:.9},
  throw:{...DEFAULT,fade:.11,timeScale:1.05,responsiveness:14,groundLock:.88},
  throw_infield:{...DEFAULT,fade:.07,timeScale:1.12,responsiveness:18,groundLock:.9},
  throw_outfield:{...DEFAULT,fade:.10,timeScale:.96,responsiveness:14,groundLock:.86},
  throw_catcher:{...DEFAULT,fade:.055,timeScale:1.18,responsiveness:19,groundLock:.94},
  catch:{...DEFAULT,fade:.12,timeScale:1.0,responsiveness:13,groundLock:.92},
  receive:{...DEFAULT,fade:.08,timeScale:1.02,responsiveness:17,groundLock:.98},
  tag:{...DEFAULT,fade:.11,timeScale:1.02,responsiveness:14,groundLock:.94},
  celebrate:{...DEFAULT,fade:.13,timeScale:.95,responsiveness:11,groundLock:.94},
  react_strikeout:{...DEFAULT,fade:.12,timeScale:.92,responsiveness:10,groundLock:.94},
  react_out:{...DEFAULT,fade:.12,timeScale:.94,responsiveness:10,groundLock:.94}
});

const ROLE_OVERRIDES=Object.freeze({
  pitcher:{pitch:{fade:.11,timeScale:1.0,responsiveness:15},pitch_drive:{timeScale:1.02,responsiveness:19}},
  batter:{swing:{fade:.08,timeScale:1.06,responsiveness:17},swing_contact:{fade:.035,timeScale:1.12,responsiveness:22}},
  catcher:{catch:{fade:.09,responsiveness:15},receive:{fade:.055,responsiveness:19},throw_catcher:{fade:.045,timeScale:1.2}},
  runner:{run:{timeScale:1.06,responsiveness:14},slide:{fade:.06,responsiveness:19},trot:{timeScale:.74}},
  fielder:{field:{fade:.1,responsiveness:14},throw:{fade:.09,responsiveness:15},throw_infield:{fade:.055,responsiveness:19},throw_outfield:{fade:.085,responsiveness:16}}
});

export function motionProfile(role='fielder',action='idle'){
  const base=MOTION_PROFILES[action]||DEFAULT,over=ROLE_OVERRIDES[role]?.[action]||{};
  return {...base,...over,role,action};
}

export function expDampAlpha(dt,responsiveness=10){
  const d=Math.max(0,Number(dt)||0),r=Math.max(.01,Number(responsiveness)||10);
  return 1-Math.exp(-d*r);
}

export function smoothPhase(t){
  const x=Math.max(0,Math.min(1,Number(t)||0));
  return x*x*(3-2*x);
}

export function footPlantCorrection({rootY=0,leftFootY=0,rightFootY=0,groundY=0,maxCorrection=.35,lock=1}={}){
  const foot=Math.min(Number(leftFootY)||0,Number(rightFootY)||0),delta=(Number(groundY)||0)-foot;
  const cap=Math.max(0,Number(maxCorrection)||0),strength=Math.max(0,Math.min(1,Number(lock)||0));
  const correction=Math.max(-cap,Math.min(cap,delta))*strength;
  return {rootY:(Number(rootY)||0)+correction,correction,footY:foot,groundY:Number(groundY)||0};
}

export function stabilizedRootY(currentY,targetY,dt,{responsiveness=12,maxStep=.18}={}){
  const a=expDampAlpha(dt,responsiveness),delta=(Number(targetY)||0)-(Number(currentY)||0),step=Math.max(-maxStep,Math.min(maxStep,delta*a));
  return (Number(currentY)||0)+step;
}

export function cameraEaseAlpha(dt,mode='broadcast'){
  const rates={broadcast:6.5,batter:8.5,pitcher:8.2,ball_track:11,stadium:4.8,base:10,replay:5.6,celebration:4.6};
  const key=String(mode||'broadcast').startsWith('base_')?'base':mode;
  return expDampAlpha(dt,rates[key]||6.5);
}

export function actionPlayback(role,action,{speed=1,loop=null}={}){
  const p=motionProfile(role,action);return {fade:p.fade,timeScale:p.timeScale*Math.max(.25,Number(speed)||1),loop:loop==null?p.loop:!!loop,responsiveness:p.responsiveness,groundLock:p.groundLock};
}
