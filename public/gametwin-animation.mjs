export const GAMETWIN_ANIMATION_VERSION='1.7.0';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number(x)||0));
const deg=x=>x*Math.PI/180;

export const BASEBALL_ACTIONS=Object.freeze([
  'idle','stance_left','stance_right',
  'pitch_set','pitch_lift','pitch_drive','pitch_follow','pitch',
  'swing_load','swing_contact','swing_follow','swing',
  'run','trot','slide','field','catch','receive',
  'throw','throw_infield','throw_outfield','throw_catcher','tag',
  'celebrate','react_strikeout','react_out'
]);

export function normalizeHand(v,fallback='R'){
  const x=String(v||'').trim().toUpperCase();return x==='L'?'L':x==='S'?'S':x==='R'?'R':fallback;
}

export function batterStance(bats='R'){
  const hand=normalizeHand(bats,'R'),left=hand==='L';
  return {hand,clip:left?'stance_left':'stance_right',mirror:left?1:-1,openAngle:left?deg(-8):deg(8),batSide:left?'left':'right'};
}

export function pitchMechanics(throws='R'){
  const hand=normalizeHand(throws,'R'),mirror=hand==='L'?-1:1;
  return {
    hand,mirror,
    phases:[
      {name:'set',clip:'pitch_set',from:0,to:.18},
      {name:'lift',clip:'pitch_lift',from:.18,to:.42},
      {name:'drive',clip:'pitch_drive',from:.42,to:.76},
      {name:'follow',clip:'pitch_follow',from:.76,to:1}
    ],
    armSlotZ:deg(10)*mirror,
    strideYaw:deg(5)*mirror
  };
}

export function phaseAt(phases,t){
  const x=clamp(t);for(const p of phases||[])if(x<=p.to)return {...p,local:clamp((x-p.from)/Math.max(.001,p.to-p.from))};
  const p=(phases||[]).at(-1);return p?{...p,local:1}:null;
}

export function swingMechanics(bats='R'){
  const stance=batterStance(bats);
  return {
    ...stance,
    phases:[
      {name:'load',clip:'swing_load',from:0,to:.34},
      {name:'contact',clip:'swing_contact',from:.34,to:.66},
      {name:'follow',clip:'swing_follow',from:.66,to:1}
    ]
  };
}

export function throwProfile(position=''){
  const p=String(position||'').toUpperCase();
  if(p==='C'||p==='CATCHER')return {clip:'throw_catcher',style:'catcher_pop',timeScale:1.18,release:.48};
  if(['LF','CF','RF'].includes(p))return {clip:'throw_outfield',style:'crow_hop',timeScale:.96,release:.62};
  if(['SS','2B','3B','1B'].includes(p))return {clip:'throw_infield',style:'quick_transfer',timeScale:1.12,release:.50};
  return {clip:'throw',style:'generic',timeScale:1.0,release:.55};
}

export function runnerFinish({outcome='',to=null,close=false,steal=false,scored=false}={}){
  const o=String(outcome||'').toUpperCase();
  if(o==='HR')return {clip:'trot',style:'home_run_trot',speed:.72};
  if(close||steal||(Number(to)>=2&&Number(to)<=4))return {clip:'slide',style:'feet_first_slide',speed:1.0};
  if(scored)return {clip:'celebrate',style:'score_reaction',speed:.92};
  return {clip:'run',style:'run_through',speed:1.0};
}

export function reactionCue({outcome='',scored=0,leverage=0,side='offense'}={}){
  const o=String(outcome||'').toUpperCase(),lev=clamp(leverage,0,1);
  if(o==='HR'||Number(scored)>0)return {clip:'celebrate',intensity:.55+.45*lev};
  if(o==='K'&&side==='offense')return {clip:'react_strikeout',intensity:.4+.4*lev};
  if(o==='OUT'&&side==='offense')return {clip:'react_out',intensity:.3+.35*lev};
  return null;
}

// Analytical two-segment leg solve used by the generated GameTwin skeleton.
// It returns bounded joint angles; the renderer applies only a small overlay on top of the authored clip.
export function solveTwoBoneIK({upper=1.42,lower=1.30,targetDistance=2.70,bend=1,maxCorrection=.32}={}){
  const a=Math.max(.01,Number(upper)||1.42),b=Math.max(.01,Number(lower)||1.30),
    raw=Math.max(.01,Number(targetDistance)||a+b),d=Math.max(Math.abs(a-b)+.001,Math.min(a+b-.001,raw));
  const kneeInterior=Math.acos(clamp((a*a+b*b-d*d)/(2*a*b),-1,1));
  const hipOffset=Math.acos(clamp((a*a+d*d-b*b)/(2*a*d),-1,1));
  const kneeBend=(Math.PI-kneeInterior)*Math.sign(Number(bend)||1);
  const cap=Math.max(.01,Number(maxCorrection)||.32);
  return {
    reachable:raw<=a+b&&raw>=Math.abs(a-b),
    distance:d,
    hipCorrection:Math.max(-cap,Math.min(cap,hipOffset*Math.sign(Number(bend)||1))),
    kneeCorrection:Math.max(-cap*1.75,Math.min(cap*1.75,kneeBend)),
    stretch:clamp(raw/(a+b),0,1.25)
  };
}

export function footPlacementOverlay({ankleY=0,groundY=0,upper=1.42,lower=1.30,lock=1,side='L'}={}){
  const error=(Number(ankleY)||0)-(Number(groundY)||0),strength=clamp(lock),
    target=Math.max(.05,upper+lower-Math.min(.28,Math.abs(error))*strength),
    solved=solveTwoBoneIK({upper,lower,targetDistance:target,bend:side==='L'?1:1,maxCorrection:.22});
  return {...solved,error,hipCorrection:solved.hipCorrection*strength*Math.sign(error||1),kneeCorrection:solved.kneeCorrection*strength*Math.sign(error||1)};
}

export function animationPlan(event={}){
  const outcome=String(event.outcome||'').toUpperCase(),pitcher=pitchMechanics(event?.pitcher_profile?.throws),rawBats=normalizeHand(event?.batter_profile?.bats,'R'),resolvedBats=rawBats==='S'?(pitcher.hand==='R'?'L':'R'):rawBats,batter=batterStance(resolvedBats);
  return {
    presentation_only:true,
    batter,
    pitcher,
    swing:swingMechanics(resolvedBats),
    runner:runnerFinish({outcome,close:!!event?.close_play?.active}),
    reaction:reactionCue({outcome,scored:(event.scored||[]).length,leverage:event.leverage||0,side:'offense'})
  };
}
