'use strict';

const primary=require('./odds-provider');
const secondary=require('./odds-secondary-sgo');

const DIAGNOSTIC_SPORTS=new Set(['baseball_mlb','americanfootball_ncaaf']);
const DIAGNOSTIC_MARKETS=new Set(['h2h','spreads','totals']);

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

function diagnosticError(error){
  const status=Number(error?.status);
  if(error?.name==='AbortError')return 'secondary_timeout';
  if(status===401||status===403)return 'secondary_authentication_failed';
  if(status===429)return 'secondary_rate_limited';
  if(status===503)return 'secondary_not_configured';
  return 'secondary_request_failed';
}

function diagnosticRequest({sport,markets,bookmakers}={}){
  const sportKey=String(sport||'').trim();
  if(!DIAGNOSTIC_SPORTS.has(sportKey)){
    throw Object.assign(new Error('Unsupported diagnostic sport.'),{status:400,code:'unsupported_sport'});
  }

  const requested=(Array.isArray(markets)?markets:String(markets||'h2h,spreads,totals').split(','))
    .map(value=>String(value).trim())
    .filter(Boolean);
  const unique=[...new Set(requested)];
  if(!unique.length||unique.some(market=>!DIAGNOSTIC_MARKETS.has(market))){
    throw Object.assign(new Error('Unsupported diagnostic market.'),{status:400,code:'unsupported_markets'});
  }

  const params=new URLSearchParams({markets:unique.join(',')});
  const allowedBooks=String(bookmakers||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(allowedBooks.length)params.set('bookmakers',allowedBooks.join(','));
  return {
    sport:sportKey,
    markets:unique,
    endpoint:`sports/${encodeURIComponent(sportKey)}/odds?${params.toString()}`
  };
}

async function diagnoseFailover(input,{env=process.env}={}){
  const request=diagnosticRequest(input);
  const started=Date.now();
  const base={
    provider_used:'sportsgameodds',
    route:'diagnostic_secondary_failover',
    sport:request.sport,
    normalized_event_count:0,
    bookmaker_count:0,
    hard_rock_bet_present:false,
    production_route_untouched:true
  };

  // This error is intentionally local to this request. It proves the same retryable
  // condition that production failover recognizes without calling or mutating primary.
  const simulatedPrimaryError=Object.assign(new Error('diagnostic_primary_failure'),{
    status:503,
    provider:primary.config(env).name
  });

  if(!primary.retryable(simulatedPrimaryError)){
    return {...base,success:false,elapsed_ms:Date.now()-started,error:'primary_failure_not_retryable'};
  }

  try{
    // Use the real secondary adapter, including its production normalization path.
    // Do not call useSecondary(): it owns the production router state mutations.
    const result=await secondary.fetchOdds(request.endpoint,{env});
    const events=Array.isArray(result?.data)?result.data:[];
    const bookmakerKeys=new Set();
    for(const event of events){
      for(const book of event?.bookmakers||[])bookmakerKeys.add(String(book?.key||''));
    }
    const summary={
      ...base,
      normalized_event_count:events.length,
      bookmaker_count:bookmakerKeys.size,
      hard_rock_bet_present:[...bookmakerKeys].some(key=>key.startsWith('hardrockbet')),
      elapsed_ms:Date.now()-started
    };
    if(events.length===0)return {...summary,success:false,error:'no_usable_normalized_events'};
    if(bookmakerKeys.size===0)return {...summary,success:false,error:'no_usable_normalized_bookmakers'};
    return {...summary,success:true};
  }catch(error){
    return {...base,success:false,elapsed_ms:Date.now()-started,error:diagnosticError(error)};
  }
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

module.exports={config,fetchOdds,diagnoseFailover,status,primaryCircuitOpen,resetForTest};
