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
  const entries=Object.entries(out.market_history||{}).slice(-2200);
  for(const [k,v] of entries)mh[k]=(Array.isArray(v)?v:[]).slice(-120);
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
async function supabaseSave(state){
  const payload={id:STATE_ID,value:compactState(state),updated_at:new Date().toISOString()};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/aegis_state?on_conflict=id`,{method:'POST',headers:supabaseHeaders({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify(payload)});
  if(!r.ok)throw new Error(`Supabase write failed (${r.status}): ${await r.text()}`);
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
  if(persistent)await supabaseSave(next); else localSave(next);
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
