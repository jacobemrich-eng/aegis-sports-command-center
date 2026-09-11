'use strict';

const DEFAULT_BASE_URL='https://api.the-odds-api.com/v4';

function config(env=process.env){
  return {
    name:'the_odds_api',
    baseUrl:String(env.AEGIS_ODDS_PRIMARY_BASE_URL||DEFAULT_BASE_URL).replace(/\/+$/,''),
    apiKey:String(env.ODDS_API_KEY||'').trim(),
    timeoutMs:Math.max(3000,Math.min(30000,Number(env.AEGIS_ODDS_PROVIDER_TIMEOUT_MS||10000)))
  };
}

function endpointUrl(endpoint,cfg=config()){
  const join=String(endpoint).includes('?')?'&':'?';
  return `${cfg.baseUrl}/${String(endpoint).replace(/^\/+/,'')}${join}apiKey=${encodeURIComponent(cfg.apiKey)}`;
}

async function fetchWithTimeout(url,timeoutMs,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetch(url,{
      ...options,
      signal:controller.signal,
      headers:{
        'User-Agent':'SB101-AEGIS/9.1.1',
        'Accept':'application/json,text/plain,*/*',
        ...(options.headers||{})
      }
    });
  }finally{
    clearTimeout(timer);
  }
}

function metaFromHeaders(headers){
  return {
    remaining:headers.get('x-requests-remaining'),
    used:headers.get('x-requests-used'),
    last:headers.get('x-requests-last')
  };
}

async function fetchOdds(endpoint,{env=process.env}={}){
  const cfg=config(env);
  if(!cfg.apiKey)throw new Error('ODDS_API_KEY is not configured.');
  const response=await fetchWithTimeout(endpointUrl(endpoint,cfg),cfg.timeoutMs);
  const raw=await response.text();
  let data;
  try{data=JSON.parse(raw);}catch{data={raw};}
  if(!response.ok){
    const err=new Error(data?.message||data?.error||`Odds provider ${response.status}`);
    err.status=response.status;
    err.provider=cfg.name;
    throw err;
  }
  return {
    data,
    meta:{
      ...metaFromHeaders(response.headers),
      provider:cfg.name,
      source:'provider',
      fetched_at:new Date().toISOString()
    }
  };
}

async function probeQuota({env=process.env}={}){
  const cfg=config(env);
  if(!cfg.apiKey)throw new Error('ODDS_API_KEY is not configured.');
  const response=await fetchWithTimeout(`${cfg.baseUrl}/sports/?apiKey=${encodeURIComponent(cfg.apiKey)}`,cfg.timeoutMs);
  if(!response.ok)throw new Error(`Odds provider quota probe ${response.status}`);
  await response.arrayBuffer();
  return {
    ...metaFromHeaders(response.headers),
    provider:cfg.name,
    source:'provider_probe',
    fetched_at:new Date().toISOString(),
    ready:true
  };
}

function retryable(error){
  const status=Number(error?.status);
  return error?.name==='AbortError'||!Number.isFinite(status)||status===408||status===425||status===429||status>=500;
}

module.exports={DEFAULT_BASE_URL,config,endpointUrl,fetchOdds,probeQuota,retryable};
