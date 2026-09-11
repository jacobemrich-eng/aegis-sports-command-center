'use strict';

const primary=require('./odds-provider');
const secondary=require('./odds-secondary-sgo');

const state={
  consecutivePrimaryFailures:0,
  circuitUntil:0,
  lastPrimarySuccessAt:null,
  lastPrimaryFailureAt:null,
  lastFailoverAt:null,
  lastRoute:'primary'
};

function config(env=process.env){
  return {
    failureThreshold:Math.max(1,Math.min(10,Number(env.AEGIS_PRIMARY_PROVIDER_FAILURE_THRESHOLD||2))),
    cooldownMs:Math.max(30000,Math.min(30*60*1000,Number(env.AEGIS_PRIMARY_PROVIDER_COOLDOWN_MS||180000)))
  };
}

function secondaryReady(endpoint,env=process.env){
  const c=secondary.config(env);
  return c.configured&&secondary.canHandle(endpoint);
}

function primaryCircuitOpen(now=Date.now()){
  return state.circuitUntil>now;
}

function recordPrimarySuccess(){
  state.consecutivePrimaryFailures=0;
  state.circuitUntil=0;
  state.lastPrimarySuccessAt=new Date().toISOString();
  state.lastRoute='primary';
}

function recordPrimaryFailure(cfg){
  state.consecutivePrimaryFailures++;
  state.lastPrimaryFailureAt=new Date().toISOString();
  if(state.consecutivePrimaryFailures>=cfg.failureThreshold){
    state.circuitUntil=Date.now()+cfg.cooldownMs;
  }
}

function cleanError(error){
  return {
    provider:error?.provider||'primary',
    status:Number.isFinite(Number(error?.status))?Number(error.status):null,
    message:String(error?.message||'provider error').slice(0,180)
  };
}

async function useSecondary(endpoint,reason,primaryError,env){
  const result=await secondary.fetchOdds(endpoint,{env});
  state.lastFailoverAt=new Date().toISOString();
  state.lastRoute='secondary';
  return {
    data:result.data,
    meta:{
      ...result.meta,
      route:'secondary',
      failover_reason:reason,
      primary_error:primaryError?cleanError(primaryError):null
    }
  };
}

async function fetchOdds(endpoint,{env=process.env}={}){
  const cfg=config(env);

  if(primaryCircuitOpen()&&secondaryReady(endpoint,env)){
    try{
      return await useSecondary(endpoint,'primary_circuit_open',null,env);
    }catch(secondaryError){
      secondaryError.route='secondary_circuit_attempt';
      throw secondaryError;
    }
  }

  try{
    const result=await primary.fetchOdds(endpoint,{env});
    recordPrimarySuccess();
    return {
      data:result.data,
      meta:{...result.meta,route:'primary',failover:false}
    };
  }catch(primaryError){
    if(primary.retryable(primaryError))recordPrimaryFailure(cfg);

    if(primary.retryable(primaryError)&&secondaryReady(endpoint,env)){
      try{
        return await useSecondary(endpoint,'primary_retryable_failure',primaryError,env);
      }catch(secondaryError){
        primaryError.secondary_error=cleanError(secondaryError);
      }
    }

    throw primaryError;
  }
}

function status(env=process.env){
  const cfg=config(env);
  return {
    mode:'primary_with_secondary_failover',
    primary:primary.config(env).name,
    secondary:secondary.publicStatus(env),
    primary_circuit_open:primaryCircuitOpen(),
    primary_circuit_until:state.circuitUntil?new Date(state.circuitUntil).toISOString():null,
    consecutive_primary_failures:state.consecutivePrimaryFailures,
    failure_threshold:cfg.failureThreshold,
    cooldown_ms:cfg.cooldownMs,
    last_primary_success_at:state.lastPrimarySuccessAt,
    last_primary_failure_at:state.lastPrimaryFailureAt,
    last_failover_at:state.lastFailoverAt,
    last_route:state.lastRoute
  };
}

function resetForTest(){
  state.consecutivePrimaryFailures=0;
  state.circuitUntil=0;
  state.lastPrimarySuccessAt=null;
  state.lastPrimaryFailureAt=null;
  state.lastFailoverAt=null;
  state.lastRoute='primary';
}

module.exports={config,fetchOdds,status,primaryCircuitOpen,resetForTest};
