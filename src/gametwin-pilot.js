'use strict';

const VERSION='1.0.0-production-shadow-pilot';

function boolEnv(value,fallback=true){
  if(value==null||value==='')return fallback;
  return !['0','false','off','no'].includes(String(value).trim().toLowerCase());
}
function nowIso(){return new Date().toISOString();}
function defaults(options={}){
  return {
    enabled:options.enabled??boolEnv(process.env.GAMETWIN_PILOT_ENABLED,true),
    max_consecutive_failures:Math.max(1,Math.min(10,Number(options.maxConsecutiveFailures||process.env.GAMETWIN_PILOT_MAX_FAILURES||3))),
    cooldown_minutes:Math.max(15,Math.min(24*60,Number(options.cooldownMinutes||process.env.GAMETWIN_PILOT_COOLDOWN_MINUTES||120))),
    stale_minutes:Math.max(30,Math.min(24*60,Number(options.staleMinutes||process.env.GAMETWIN_PILOT_STALE_MINUTES||360)))
  };
}
function ensurePilot(state,config=defaults()){
  state.gametwin=state.gametwin&&typeof state.gametwin==='object'?state.gametwin:{};
  const g=state.gametwin;
  g.pilot=g.pilot&&typeof g.pilot==='object'?g.pilot:{};
  const p=g.pilot;
  if(typeof p.enabled!=='boolean')p.enabled=!!config.enabled;
  p.circuit=p.circuit||'CLOSED';
  p.consecutive_failures=Number(p.consecutive_failures||0);
  p.total_runs=Number(p.total_runs||0);
  p.successful_runs=Number(p.successful_runs||0);
  p.failed_runs=Number(p.failed_runs||0);
  p.config={max_consecutive_failures:config.max_consecutive_failures,cooldown_minutes:config.cooldown_minutes,stale_minutes:config.stale_minutes};
  return p;
}
function circuitOpen(p,at=Date.now()){
  if(p?.circuit!=='OPEN')return false;
  const opened=p?.circuit_opened_at?(Date.parse(p.circuit_opened_at)||0):0;
  const cooldown=Number(p.config?.cooldown_minutes||120)*60000;
  return !!opened&&at-opened<cooldown;
}
function publicStatus(p,at=Date.now()){
  p=p||{};
  const enabled=p.enabled!==false,open=circuitOpen(p,at),lastSuccess=p.last_success_at?(Date.parse(p.last_success_at)||0):0;
  const staleMinutes=Number(p.config?.stale_minutes||360);
  const age=lastSuccess?Math.max(0,(at-lastSuccess)/60000):null;
  let health='GREEN',reason='Production shadow pilot is healthy.';
  if(!enabled){health='PAUSED';reason='GameTwin pilot is manually paused.';}
  else if(open){health='RED';reason='GameTwin circuit breaker is open after repeated failures.';}
  else if(p.circuit==='OPEN'){health='YELLOW';reason='Circuit-breaker cooldown elapsed; the next run is a recovery attempt.';}
  else if(p.last_error&&Number(p.consecutive_failures||0)>0){health='YELLOW';reason='GameTwin recorded a recent isolated failure.';}
  else if(age!=null&&age>staleMinutes){health='YELLOW';reason='GameTwin shadow pilot has not completed a successful run recently.';}
  else if(!lastSuccess){health='COLLECTING';reason='Pilot is armed and waiting for its first successful MLB shadow run.';}
  return {
    version:VERSION,enabled,health,reason,circuit:p.circuit||'CLOSED',circuit_open:circuitOpen(p,at),
    consecutive_failures:Number(p.consecutive_failures||0),total_runs:Number(p.total_runs||0),successful_runs:Number(p.successful_runs||0),failed_runs:Number(p.failed_runs||0),
    last_started_at:p.last_started_at||null,last_success_at:p.last_success_at||null,last_failure_at:p.last_failure_at||null,last_error:p.last_error||null,
    last_success_age_minutes:age==null?null:Math.round(age*10)/10,config:p.config||null
  };
}
function createPilotController({aegisStore,...options}={}){
  if(!aegisStore||typeof aegisStore.load!=='function'||typeof aegisStore.mutate!=='function')throw new Error('GameTwin pilot requires existing AEGIS store');
  const config=defaults(options);
  async function read(){const state=await aegisStore.load();return ensurePilot(state,config);}
  async function status(){return publicStatus(await read());}
  async function gate(){
    const p=await read();
    if(p.enabled===false)return {allowed:false,reason:'pilot paused',status:publicStatus(p)};
    if(circuitOpen(p))return {allowed:false,reason:'circuit breaker open',status:publicStatus(p)};
    return {allowed:true,recovery:p.circuit==='OPEN',status:publicStatus(p)};
  }
  async function markStarted(meta={}){await aegisStore.mutate(state=>{const p=ensurePilot(state,config);p.last_started_at=nowIso();p.total_runs++;p.last_run_meta=meta;});}
  async function recordSuccess(meta={}){await aegisStore.mutate(state=>{const p=ensurePilot(state,config);p.successful_runs++;p.consecutive_failures=0;p.last_success_at=nowIso();p.last_error=null;p.circuit='CLOSED';p.circuit_opened_at=null;p.last_success_meta=meta;});return status();}
  async function recordFailure(error,meta={}){await aegisStore.mutate(state=>{const p=ensurePilot(state,config);p.failed_runs++;p.consecutive_failures++;p.last_failure_at=nowIso();p.last_error=error?.message||String(error);p.last_failure_meta=meta;if(p.consecutive_failures>=config.max_consecutive_failures){p.circuit='OPEN';p.circuit_opened_at=nowIso();}});return status();}
  async function setEnabled(enabled){await aegisStore.mutate(state=>{const p=ensurePilot(state,config);p.enabled=!!enabled;p.updated_at=nowIso();if(enabled&&p.circuit==='OPEN'&&!circuitOpen(p))p.circuit='HALF_OPEN';});return status();}
  async function resetCircuit(){await aegisStore.mutate(state=>{const p=ensurePilot(state,config);p.circuit='CLOSED';p.circuit_opened_at=null;p.consecutive_failures=0;p.last_error=null;p.updated_at=nowIso();});return status();}
  return {VERSION,config,status,gate,markStarted,recordSuccess,recordFailure,setEnabled,resetCircuit};
}

module.exports={VERSION,boolEnv,defaults,ensurePilot,circuitOpen,publicStatus,createPilotController};
