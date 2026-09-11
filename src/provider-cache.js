'use strict';

const crypto=require('crypto');

const SUPABASE_URL=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const SUPABASE_KEY=String(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
const KEY_MODE=SUPABASE_KEY.startsWith('sb_secret_')?'secret':(SUPABASE_KEY?'legacy-service-role':'none');
const STATE_ID=String(process.env.AEGIS_STATE_ID||'main').trim()||'main';
const MAX_BYTES=Math.max(100000,Math.min(3000000,Number(process.env.AEGIS_PROVIDER_CACHE_MAX_BYTES||1800000)));
const memory=new Map();
const persistent=!!(SUPABASE_URL&&SUPABASE_KEY);

function headers(extra={}){
  const h={apikey:SUPABASE_KEY,...extra};
  if(KEY_MODE==='legacy-service-role')h.Authorization=`Bearer ${SUPABASE_KEY}`;
  return h;
}

function cacheId(key){
  const hash=crypto.createHash('sha256').update(String(key)).digest('hex').slice(0,40);
  return `${STATE_ID}-provider-${hash}`;
}

function normalize(value){
  if(!value||typeof value!=='object')return null;
  if(!('data' in value)||!value.fetched_at)return null;
  return value;
}

async function get(key){
  if(memory.has(key))return memory.get(key);
  if(!persistent)return null;
  try{
    const id=cacheId(key);
    const r=await fetch(`${SUPABASE_URL}/rest/v1/aegis_state?id=eq.${encodeURIComponent(id)}&select=value,updated_at`,{
      headers:headers()
    });
    if(!r.ok)return null;
    const rows=await r.json();
    const value=normalize(rows?.[0]?.value);
    if(value)memory.set(key,value);
    return value;
  }catch{
    return null;
  }
}

async function set(key,value){
  const normalized=normalize(value);
  if(!normalized)return {ok:false,reason:'invalid'};
  const encoded=JSON.stringify(normalized);
  const bytes=Buffer.byteLength(encoded);
  if(bytes>MAX_BYTES)return {ok:false,reason:'too_large',bytes,max_bytes:MAX_BYTES};

  memory.set(key,normalized);
  if(!persistent)return {ok:true,persistent:false,bytes};

  try{
    const payload={id:cacheId(key),value:normalized,updated_at:new Date().toISOString()};
    const r=await fetch(`${SUPABASE_URL}/rest/v1/aegis_state?on_conflict=id`,{
      method:'POST',
      headers:headers({
        'Content-Type':'application/json',
        Prefer:'resolution=merge-duplicates,return=minimal'
      }),
      body:JSON.stringify(payload)
    });
    if(!r.ok)return {ok:false,persistent:true,status:r.status,bytes};
    return {ok:true,persistent:true,bytes};
  }catch(error){
    return {ok:false,persistent:true,error:error.message,bytes};
  }
}

function ageMs(entry,nowMs=Date.now()){
  const t=entry?.fetched_at?new Date(entry.fetched_at).getTime():NaN;
  return Number.isFinite(t)?Math.max(0,nowMs-t):Infinity;
}

function resetMemory(){memory.clear();}

function status(){
  return {
    persistent,
    backend:persistent?'supabase-row-cache':'memory-only',
    max_bytes:MAX_BYTES,
    key_mode:persistent?KEY_MODE:'none'
  };
}

module.exports={persistent,cacheId,get,set,ageMs,resetMemory,status};
