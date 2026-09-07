export const GAMETWIN_READINESS_VERSION='2.1.0';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number(x)||0));
const finite=x=>Number.isFinite(Number(x));

export function viewportProfile({width=0,height=0,orientation=null}={}){
  const w=Math.max(1,Number(width)||1),h=Math.max(1,Number(height)||1);
  const landscape=orientation?String(orientation).toLowerCase().startsWith('land'):w>h;
  if(w<=430&&!landscape)return {id:'compact_portrait',mobile:true,landscape:false,compact:true,short:h<700};
  if(w<=760&&landscape&&h<=520)return {id:'short_landscape',mobile:true,landscape:true,compact:true,short:true};
  if(w<=760&&landscape)return {id:'mobile_landscape',mobile:true,landscape:true,compact:false,short:false};
  if(w<=760)return {id:'mobile_portrait',mobile:true,landscape:false,compact:false,short:h<700};
  if(w<=1100)return {id:landscape?'tablet_landscape':'tablet_portrait',mobile:false,tablet:true,landscape,compact:false,short:h<650};
  return {id:'desktop',mobile:false,tablet:false,landscape,compact:false,short:false};
}

export function timingProfile(profile={},reducedMotion=false){
  const p=typeof profile==='string'?{id:profile}:profile||{};
  const mobile=/mobile|compact|short_landscape/.test(p.id||'');
  const landscape=String(p.id||'').includes('landscape');
  return {
    controls_hide_ms:reducedMotion?0:(landscape&&mobile?1800:mobile?2400:3000),
    lower_third_min_ms:reducedMotion?650:(mobile?800:900),
    transition_extra_ms:reducedMotion?0:(mobile?120:250),
    css_motion_scale:reducedMotion?0:1,
    presentation_only:true
  };
}

export function overlayLayoutPlan(viewport={},active={}){
  const profile=viewportProfile(viewport);
  const keys=['pitch','telemetry','lower','state','replay','break','controls'];
  const on=Object.fromEntries(keys.map(k=>[k,!!active[k]]));
  const count=keys.filter(k=>on[k]).length;
  const density=on.break?'transition':on.replay?'replay':count>=4?'busy':count>=2?'active':'light';
  const suppress={
    pitch:!!on.break||!!on.replay,
    telemetry:!!on.break,
    lower:!!on.break||!!on.replay,
    state:!!on.break||!!on.replay,
    controls:!!on.break
  };
  // On very short landscape screens, keep only the core scoreboard/matchup and one contextual overlay.
  if(profile.id==='short_landscape'){
    if(on.pitch&&on.telemetry)suppress.pitch=true;
    if(on.lower&&on.telemetry)suppress.telemetry=true;
    if(on.state&&on.lower)suppress.state=true;
  }
  return {version:GAMETWIN_READINESS_VERSION,profile,density,active:on,suppress,presentation_only:true,predictive_authority:false};
}

export function createFramePerformanceMonitor({windowSize=120,emitEvery=60,minSamples=30,quality='medium'}={}){
  const frames=[];let last=null,total=0;
  const q=()=>quality;
  function summary(){
    if(!frames.length)return {samples:0,fps:null,p95_ms:null,long_frame_rate:null,grade:'COLLECTING',recommended_quality:q(),presentation_only:true};
    const sorted=[...frames].sort((a,b)=>a-b),avg=frames.reduce((a,b)=>a+b,0)/frames.length,p95=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],long=frames.filter(x=>x>34).length/frames.length,fps=1000/Math.max(1,avg);
    let grade='GREEN',recommended=q();
    if(fps<38||p95>48||long>.22){grade='RED';recommended=q()==='high'?'medium':'low';}
    else if(fps<50||p95>28||long>.10){grade='YELLOW';recommended=q()==='high'?'medium':q();}
    return {samples:frames.length,fps:Number(fps.toFixed(1)),avg_ms:Number(avg.toFixed(2)),p95_ms:Number(p95.toFixed(2)),long_frame_rate:Number(long.toFixed(3)),grade,recommended_quality:recommended,auto_quality_change:false,presentation_only:true,predictive_authority:false};
  }
  return {
    frame(ts){const now=Number(ts);if(!finite(now))return null;if(last!=null){const dt=clamp(now-last,0,250);if(dt>0){frames.push(dt);if(frames.length>windowSize)frames.shift();total++;}}last=now;if(total>=minSamples&&total%emitEvery===0)return summary();return null;},
    snapshot:summary,
    reset(){frames.length=0;last=null;total=0;},
    setQuality(v){quality=String(v||quality);}
  };
}

export function assetReadiness(status={}){
  const failures=Array.isArray(status.failures)?status.failures:[],warnings=Array.isArray(status.warnings)?status.warnings:[],loaded=status.loaded&&typeof status.loaded==='object'?Object.keys(status.loaded).length:0,configured=status.configured&&typeof status.configured==='object'?Object.values(status.configured).filter(Boolean).length:0;
  const grade=failures.length?'YELLOW':configured&&!loaded?'COLLECTING':'GREEN';
  return {grade,configured,loaded,failures:failures.length,warnings:warnings.length,fallback_safe:true,presentation_only:true,predictive_authority:false};
}

export function deploymentReadiness({tests_passed=false,asset_status={},performance=null,aegis_weight=0,release_eligible=false,webgl='unknown'}={}){
  const assets=assetReadiness(asset_status),perf=performance||{grade:'COLLECTING'};
  const firewall=Number(aegis_weight)===0&&release_eligible===false;
  const blockers=[];
  if(!tests_passed)blockers.push('release_gate_not_verified');
  if(!firewall)blockers.push('shadow_firewall_changed');
  if(assets.grade==='RED')blockers.push('asset_runtime_red');
  if(perf.grade==='RED')blockers.push('renderer_performance_red');
  return {version:GAMETWIN_READINESS_VERSION,ready:blockers.length===0,blockers,tests_passed:!!tests_passed,shadow_firewall:firewall,assets,performance:perf,webgl,presentation_only:true,predictive_authority:false};
}
