'use strict';

const VERSION='0.3.0-statcast-enrichment';
const SAVANT='https://baseballsavant.mlb.com/leaderboard';

function num(x,fb=null){const n=Number(x);return Number.isFinite(n)?n:fb;}
function parseCsv(text=''){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;continue;}
    if(ch==='"'){quoted=true;continue;}if(ch===','){row.push(cell);cell='';continue;}if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';continue;}if(ch!=='\r')cell+=ch;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}if(!rows.length)return [];
  const header=rows.shift().map(x=>String(x).trim());return rows.filter(r=>r.some(x=>String(x).trim()!=='')).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]??''])));
}
function mapById(rows=[]){const m=new Map();for(const r of rows){const id=Number(r.player_id??r.pitcher??r.pitcher_id);if(id)m.set(id,r);}return m;}
function groupById(rows=[]){const m=new Map();for(const r of rows){const id=Number(r.player_id??r.pitcher??r.pitcher_id);if(!id)continue;if(!m.has(id))m.set(id,[]);m.get(id).push(r);}return m;}
function contactFromRows(contactRow={},expectedRow={},pitcher=false){
  const xwoba=num(expectedRow.est_woba, num(expectedRow.xwoba));
  return pitcher?{
    xwoba_allowed:xwoba,woba_allowed:num(expectedRow.woba),hard_hit_pct_allowed:num(contactRow.ev95percent),barrel_pct_allowed:num(contactRow.brl_percent),avg_exit_velocity_allowed:num(contactRow.avg_hit_speed),xera:num(expectedRow.xera)
  }:{xwoba,woba:num(expectedRow.woba),hard_hit_pct:num(contactRow.ev95percent),barrel_pct:num(contactRow.brl_percent),avg_exit_velocity:num(contactRow.avg_hit_speed),avg_launch_angle:num(contactRow.avg_hit_angle)};
}
function pitchRows(rows=[]){return rows.map(r=>({
  pitch_type:String(r.pitch_type||'').toUpperCase(),pitch_name:r.pitch_name||null,usage:num(r.pitch_usage),pitches:num(r.pitches),PA:num(r.pa),woba:num(r.woba),xwoba:num(r.est_woba),whiff_pct:num(r.whiff_percent),k_pct:num(r.k_percent),hard_hit_pct:num(r.hard_hit_percent),run_value_per_100:num(r.run_value_per_100)
})).filter(r=>r.pitch_type);}
function buildBundle(parts={}){
  const bc=mapById(parts.batterContact),pc=mapById(parts.pitcherContact),be=mapById(parts.batterExpected),pe=mapById(parts.pitcherExpected),ba=groupById(parts.batterArsenal),pa=groupById(parts.pitcherArsenal),batters=new Map(),pitchers=new Map();
  const bIds=new Set([...bc.keys(),...be.keys(),...ba.keys()]),pIds=new Set([...pc.keys(),...pe.keys(),...pa.keys()]);
  for(const id of bIds)batters.set(id,{statcast:contactFromRows(bc.get(id)||{},be.get(id)||{},false),pitch_type_stats:pitchRows(ba.get(id)||[])});
  for(const id of pIds)pitchers.set(id,{statcast:contactFromRows(pc.get(id)||{},pe.get(id)||{},true),arsenal:pitchRows(pa.get(id)||[])});
  return {version:VERSION,batters,pitchers,counts:{batters:batters.size,pitchers:pitchers.size,batter_pitch_rows:(parts.batterArsenal||[]).length,pitcher_pitch_rows:(parts.pitcherArsenal||[]).length}};
}
function createStatcastClient(options={}){
  const fetchImpl=options.fetchImpl||globalThis.fetch;if(typeof fetchImpl!=='function')throw new Error('Statcast client requires fetch');const cache=new Map();
  async function getCsv(url,ttl=6*3600e3){const hit=cache.get(url);if(hit&&Date.now()-hit.at<ttl)return hit.rows;const r=await fetchImpl(url,{headers:{'User-Agent':'AEGIS-GameTwin/0.3'}});if(!r.ok)throw new Error(`Baseball Savant request failed ${r.status}`);const rows=parseCsv(await r.text());cache.set(url,{at:Date.now(),rows});return rows;}
  function url(path,params){const q=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined)q.set(k,String(v));return `${SAVANT}/${path}?${q}`;}
  async function contact(type,year){return getCsv(url('statcast',{type,year,position:'',team:'',min:1,csv:'true'}));}
  async function expected(type,year){return getCsv(url('expected_statistics',{type,year,position:'',team:'',filterType:'pa',min:1,csv:'true'}));}
  async function arsenal(type,year){return getCsv(url('pitch-arsenal-stats',{type,pitchType:'',year,team:'',min:10,csv:'true'}));}
  async function seasonBundle(year){year=Number(year);const [batterContact,pitcherContact,batterExpected,pitcherExpected,batterArsenal,pitcherArsenal]=await Promise.all([contact('batter',year),contact('pitcher',year),expected('batter',year),expected('pitcher',year),arsenal('batter',year),arsenal('pitcher',year)]);return buildBundle({batterContact,pitcherContact,batterExpected,pitcherExpected,batterArsenal,pitcherArsenal});}
  return {VERSION,contact,expected,arsenal,seasonBundle};
}

module.exports={VERSION,SAVANT,parseCsv,mapById,groupById,contactFromRows,pitchRows,buildBundle,createStatcastClient};
