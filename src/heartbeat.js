'use strict';

const crypto=require('crypto');

let inFlight=null;
let telemetry={
  last_probe_at:null,
  last_decision:null,
  last_queued_at:null,
  last_triggered_at:null,
  last_recovery_success_at:null,
  last_result:null,
  last_error:null
};

function finite(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

function iso(nowMs=Date.now()){
  return new Date(nowMs).toISOString();
}

function ageMinutes(value,nowMs=Date.now()){
  if(!value)return null;
  const ms=new Date(value).getTime();
  if(!Number.isFinite(ms))return null;
  return Math.max(0,(nowMs-ms)/60000);
}

function bearerToken(header){
  const raw=String(header||'');
  return raw.startsWith('Bearer ')?raw.slice(7).trim():'';
}

function authorized(header,secret){
  const expected=String(secret||'').trim();
  const actual=bearerToken(header);
  if(!expected||!actual)return false;
  const a=Buffer.from(actual);
  const b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

function publicState({
  secretReady=false,
  autopilotSecretReady=false,
  staleMinutes=35,
  probeFreshMinutes=25,
  debounceMs=15000,
  uptimeSeconds=null,
  nowMs=Date.now()
}={}){
  const ready=!!secretReady&&!!autopilotSecretReady;
  const probeAge=ageMinutes(telemetry.last_probe_at,nowMs);
  const uptime=finite(uptimeSeconds);
  const grace=ready&&probeAge===null&&uptime!==null&&uptime<20*60;
  let status='UNCONFIGURED';
  if(ready){
    if(inFlight)status='RECOVERY_RUNNING';
    else if(telemetry.last_error)status='RECOVERY_ERROR';
    else if(probeAge===null)status=grace?'STARTING':'AWAITING_PROBE';
    else if(probeAge<=Number(probeFreshMinutes||25))status='HEALTHY';
    else status='STALE';
  }
  return {
    ready,
    status,
    heartbeat_secret_ready:!!secretReady,
    autopilot_secret_ready:!!autopilotSecretReady,
    in_flight:!!inFlight,
    stale_after_minutes:Number(staleMinutes||35),
    probe_fresh_minutes:Number(probeFreshMinutes||25),
    debounce_seconds:+(Number(debounceMs||15000)/1000).toFixed(1),
    last_probe_at:telemetry.last_probe_at,
    last_probe_age_minutes:probeAge===null?null:+probeAge.toFixed(1),
    last_decision:telemetry.last_decision,
    last_queued_at:telemetry.last_queued_at,
    last_triggered_at:telemetry.last_triggered_at,
    last_recovery_success_at:telemetry.last_recovery_success_at,
    last_result:telemetry.last_result,
    last_error:telemetry.last_error,
    startup_grace:grace
  };
}

function decide({
  operations={},
  storage={},
  secretReady=false,
  autopilotSecretReady=false,
  staleMinutes=35,
  uptimeSeconds=null,
  ignoreInFlight=false,
  nowMs=Date.now()
}={}){
  const age=finite(operations.last_success_age_minutes);
  const uptime=finite(uptimeSeconds);
  let trigger=false;
  let reason='fresh';

  if(!secretReady)reason='heartbeat_secret_missing';
  else if(!autopilotSecretReady)reason='autopilot_secret_missing';
  else if(operations.inside_operating_window===false)reason='sleep_window';
  else if(storage.ok===false||storage.persistent!==true)reason='persistence_unhealthy';
  else if(inFlight&&!ignoreInFlight)reason='recovery_in_flight';
  else if(age!==null&&age<Number(staleMinutes||35))reason='fresh';
  else if(age===null&&uptime!==null&&uptime<Number(staleMinutes||35)*60)reason='startup_grace';
  else{
    trigger=true;
    reason=age===null?'no_success_recorded':'scheduler_stale';
  }

  return {
    trigger,
    reason,
    last_success_age_minutes:age,
    threshold_minutes:Number(staleMinutes||35),
    evaluated_at:iso(nowMs)
  };
}

function recordProbe(decision,nowMs=Date.now()){
  telemetry.last_probe_at=iso(nowMs);
  telemetry.last_decision=decision?.reason||null;
  if(decision?.reason==='fresh'){
    telemetry.last_error=null;
    if(telemetry.last_result==='error')telemetry.last_result='primary_fresh';
  }
  return telemetry.last_probe_at;
}

function wait(ms){
  return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
}

function queueRecovery({delayMs=15000,recheck,run}={}){
  if(inFlight)return false;
  if(typeof recheck!=='function'||typeof run!=='function')throw new Error('heartbeat recovery requires recheck and run callbacks');

  telemetry.last_queued_at=iso();
  telemetry.last_result='queued';
  telemetry.last_error=null;

  inFlight=(async()=>{
    await wait(delayMs);
    const gate=await recheck();
    if(!gate||gate.trigger!==true){
      telemetry.last_result=`suppressed:${gate?.reason||'recheck'}`;
      return {suppressed:true,reason:gate?.reason||'recheck'};
    }

    telemetry.last_triggered_at=iso();
    telemetry.last_result='running';
    const result=await run();
    telemetry.last_recovery_success_at=iso();
    telemetry.last_result='success';
    telemetry.last_error=null;
    return result;
  })().catch(err=>{
    telemetry.last_result='error';
    telemetry.last_error=String(err?.message||err||'heartbeat recovery failed').slice(0,240);
    console.error('[AEGIS heartbeat recovery]',telemetry.last_error);
    return {ok:false,error:telemetry.last_error};
  }).finally(()=>{
    inFlight=null;
  });

  return true;
}

async function waitForIdleForTest(){
  if(inFlight)await inFlight;
}

function resetForTests(){
  inFlight=null;
  telemetry={
    last_probe_at:null,
    last_decision:null,
    last_queued_at:null,
    last_triggered_at:null,
    last_recovery_success_at:null,
    last_result:null,
    last_error:null
  };
}

module.exports={
  authorized,
  publicState,
  decide,
  recordProbe,
  queueRecovery,
  _waitForIdleForTest:waitForIdleForTest,
  _resetForTests:resetForTests
};
