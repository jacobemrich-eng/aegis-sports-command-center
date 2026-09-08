const fs = require('fs');
const path = require('path');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_KEY_MODE = SUPABASE_KEY.startsWith('sb_secret_') ? 'secret' : (SUPABASE_KEY ? 'legacy-service-role' : 'none');
const STATE_ID = String(process.env.AEGIS_STATE_ID || 'main').trim() || 'main';
const LOCAL_DIR = String(process.env.AEGIS_DATA_DIR || path.join(__dirname, '..', '.data'));
const LOCAL_FILE = path.join(LOCAL_DIR, 'aegis-state.json');
const persistent = !!(SUPABASE_URL && SUPABASE_KEY);
let queue = Promise.resolve();
let memory = null;

function freshState(){
  return {
    schema_version: 2,
    updated_at: new Date().toISOString(),
    latest_cards: {},
    board_snapshots: {},
    audit: [],
    locks: [],
    market_history: {},
    tier_history: [],
    alerts: [],
    autopilot: {
      enabled: true,
      last_tick_at: null,
      last_success_at: null,
      last_error: null,
      next_due_hint: null,
      sport_runs: {},
      daily_usage: {},
      monthly_usage: {},
      grading: { last_run_at: null, last_graded: 0 },
      transitions: []
    }
  };
}
function normalizeState(s){
  const base=freshState(), out=(s && typeof s==='object')?s:{};
  return {
    ...base,
    ...out,
    latest_cards: out.latest_cards || {},
    board_snapshots: out.board_snapshots || {},
    audit: Array.isArray(out.audit)?out.audit:[],
    locks: Array.isArray(out.locks)?out.locks:[],
    market_history: out.market_history || {},
    tier_history: Array.isArray(out.tier_history)?out.tier_history:[],
    alerts: Array.isArray(out.alerts)?out.alerts:[],
    autopilot: {...base.autopilot,...(out.autopilot||{}),sport_runs:{...(out.autopilot?.sport_runs||{})},daily_usage:{...(out.autopilot?.daily_usage||{})},monthly_usage:{...(out.autopilot?.monthly_usage||{})},grading:{...base.autopilot.grading,...(out.autopilot?.grading||{})},transitions:Array.isArray(out.autopilot?.transitions)?out.autopilot.transitions:[]}
  };
}
function compactState(s){
  const out=normalizeState(s);
  out.updated_at=new Date().toISOString();
  out.audit=out.audit.slice(-3500);
  out.locks=out.locks.slice(-1200);
  out.tier_history=out.tier_history.slice(-1800);
  out.alerts=out.alerts.slice(-250);
  out.autopilot.transitions=(out.autopilot.transitions||[]).slice(-500);
  const mh={};
  // AEGIS_PERSISTENCE_HARDENING_V1
  // Keep the hot-state JSONB row bounded. Critical audit/locks/tier history
  // remains untouched; only dense sportsbook price snapshots are capped here.
  const entries=Object.entries(out.market_history||{}).slice(-600);
  for(const [k,v] of entries)mh[k]=(Array.isArray(v)?v:[]).slice(-48);
  out.market_history=mh;
  return out;
}
function supabaseHeaders(extra={}){
  const headers={apikey:SUPABASE_KEY,...extra};
  // Modern sb_secret_ keys are server-only opaque keys and should be supplied
  // through the apikey header. Legacy service_role JWTs still use Bearer auth.
  if(SUPABASE_KEY_MODE==='legacy-service-role')headers.Authorization=`Bearer ${SUPABASE_KEY}`;
  return headers;
}
async function supabaseLoad(){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/aegis_state?id=eq.${encodeURIComponent(STATE_ID)}&select=value,updated_at`,{headers:supabaseHeaders()});
  if(!r.ok)throw new Error(`Supabase read failed (${r.status}): ${await r.text()}`);
  const rows=await r.json();
  if(!rows.length)return freshState();
  return normalizeState(rows[0].value);
}
function boundedPersistenceState(state,keyCap=600,pointCap=48){
  const out=compactState(state),mh={};
  const entries=Object.entries(out.market_history||{}).slice(-keyCap);
  for(const [k,v] of entries)mh[k]=(Array.isArray(v)?v:[]).slice(-pointCap);
  out.market_history=mh;
  return out;
}
function persistenceRetryable(status,text=''){
  return status===408||status===425||status===429||status>=500||/\\b57014\\b/.test(text)||/statement timeout/i.test(text);
}
function persistenceStatementTimeout(text=''){
  return /\\b57014\\b/.test(text)||/statement timeout/i.test(text);
}
async function persistenceDelay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function supabaseSave(state){
  // Preserve upsert/bootstrap semantics; only shrink dense market-price history
  // after a confirmed PostgreSQL 57014 statement timeout.
  const profiles=[
    {keys:600,points:48,label:'normal'},
    {keys:320,points:32,label:'timeout-retry'},
    {keys:180,points:24,label:'timeout-recovery'}
  ];
  const delays=[0,250,750];
  let timeoutLevel=0,lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    if(delays[attempt])await persistenceDelay(delays[attempt]);
    const profile=profiles[Math.min(timeoutLevel,profiles.length-1)];
    const value=boundedPersistenceState(state,profile.keys,profile.points);
    const payload={id:STATE_ID,value,updated_at:new Date().toISOString()};
    const body=JSON.stringify(payload);
    let r;
    try{
      r=await fetch(`${SUPABASE_URL}/rest/v1/aegis_state?on_conflict=id`,{
        method:'POST',
        headers:supabaseHeaders({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),
        body
      });
    }catch(e){
      lastError=e;
      if(attempt===2)throw e;
      console.warn(`[AEGIS persistence retry] network write failure on attempt ${attempt+1}; retrying without local fallback.`);
      continue;
    }
    if(r.ok)return value;
    const text=await r.text();
    const timedOut=persistenceStatementTimeout(text);
    lastError=new Error(`Supabase write failed (${r.status}): ${text}`);
    if(!persistenceRetryable(r.status,text)||attempt===2)throw lastError;
    if(timedOut)timeoutLevel=Math.min(timeoutLevel+1,profiles.length-1);
    const bytes=Buffer.byteLength(body);
    console.warn(`[AEGIS persistence retry] transient write failure status=${r.status} attempt=${attempt+1} profile=${profile.label} bytes=${bytes}; retrying.`);
  }
  throw lastError||new Error('Supabase write failed after persistence retries.');
}
function localLoad(){
  try{return normalizeState(JSON.parse(fs.readFileSync(LOCAL_FILE,'utf8')));}catch{return freshState();}
}
function localSave(state){
  fs.mkdirSync(LOCAL_DIR,{recursive:true});
  const tmp=`${LOCAL_FILE}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(compactState(state),null,2));
  fs.renameSync(tmp,LOCAL_FILE);
}
async function load(){
  if(memory)return normalizeState(memory);
  memory=persistent?await supabaseLoad():localLoad();
  return normalizeState(memory);
}
async function save(state){
  const next=compactState(state);
  if(persistent){
    const persisted=await supabaseSave(next);
    memory=persisted;
    return persisted;
  }
  localSave(next);
  memory=next;
  return next;
}
function mutate(fn){
  queue=queue.catch(()=>{}).then(async()=>{
    const state=await load();
    const working=normalizeState(JSON.parse(JSON.stringify(state)));
    const result=await fn(working);
    const saved=await save(working);
    return {state:saved,result};
  });
  return queue;
}
async function health(){
  try{const s=await load();return {ok:true,persistent,backend:persistent?'supabase':'local-ephemeral',key_mode:persistent?SUPABASE_KEY_MODE:'none',updated_at:s.updated_at};}
  catch(e){return {ok:false,persistent,backend:persistent?'supabase':'local-ephemeral',key_mode:persistent?SUPABASE_KEY_MODE:'none',error:e.message};}
}
function resetMemory(){memory=null;}

module.exports={load,save,mutate,health,persistent,resetMemory,freshState,STATE_ID,SUPABASE_KEY_MODE,supabaseHeaders};
