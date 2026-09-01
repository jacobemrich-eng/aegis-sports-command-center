const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const engine = require('./src/engine');
const autopilot = require('./src/autopilot');
const store = require('./src/store');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const ACCESS_PIN = String(process.env.AEGIS_ACCESS_PIN || '').trim();
const SESSION_SECRET = String(process.env.AEGIS_SESSION_SECRET || ACCESS_PIN || 'aegis-local-development');
const AUTOPILOT_SECRET = String(process.env.AEGIS_AUTOPILOT_SECRET || '').trim();
const SESSION_DAYS = 30;
const RATE = new Map();
const SECURITY_HEADERS = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'same-origin',
  'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

function send(res,status,data,type='application/json',headers={}){
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',...SECURITY_HEADERS,...headers});
  res.end(type.startsWith('application/json')?JSON.stringify(data):data);
}
function readBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',d=>{s+=d;if(s.length>4e6){reject(new Error('Request too large'));req.destroy();}});req.on('end',()=>resolve(s));req.on('error',reject);});}
function cookies(req){const out={};String(req.headers.cookie||'').split(';').forEach(x=>{const i=x.indexOf('=');if(i>0)out[x.slice(0,i).trim()]=decodeURIComponent(x.slice(i+1).trim())});return out;}
function sign(text){return crypto.createHmac('sha256',SESSION_SECRET).update(text).digest('hex');}
function secureEqual(a,b){a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function makeSession(){const exp=Date.now()+SESSION_DAYS*864e5,payload=String(exp);return `${payload}.${sign(payload)}`;}
function validSession(req){if(!ACCESS_PIN)return true;const token=cookies(req).aegis_session||'',parts=token.split('.');if(parts.length!==2)return false;const [exp,sig]=parts;if(!secureEqual(sig,sign(exp)))return false;return Number(exp)>Date.now();}
function bearer(req){const h=String(req.headers.authorization||'');return h.startsWith('Bearer ')?h.slice(7).trim():'';}
function validAutopilot(req){return !!AUTOPILOT_SECRET&&secureEqual(bearer(req),AUTOPILOT_SECRET);}
function ip(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();}
function rateLimit(req,res,bucket,limit,windowMs=3600e3){const key=`${bucket}|${ip(req)}`,t=Date.now(),row=RATE.get(key)||{start:t,count:0};if(t-row.start>windowMs){row.start=t;row.count=0;}row.count++;RATE.set(key,row);if(row.count>limit){const retry=Math.ceil((row.start+windowMs-t)/1000);send(res,429,{error:`AEGIS rate limit reached for ${bucket}. Try again in ${Math.ceil(retry/60)} minute(s).`},'application/json',{'Retry-After':String(retry)});return false;}return true;}
function requireAuth(req,res){if(validSession(req))return true;send(res,401,{error:'AEGIS access is locked. Enter the configured access PIN.',auth_required:true});return false;}
function mime(file){const ext=path.extname(file).toLowerCase();return ({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'}[ext]||'application/octet-stream');}
function serveFile(res,file){try{const buf=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':file.endsWith('.html')?'no-store':'public, max-age=180',...SECURITY_HEADERS});res.end(buf);}catch{send(res,404,{error:'Not found'});}}
function baseOddsEndpoint(sport,markets){const cfg=engine.config();return `sports/${encodeURIComponent(sport)}/odds?bookmakers=${encodeURIComponent(cfg.bookmakers)}&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`;}
async function safeStatus(){try{return await autopilot.status();}catch(e){return {enabled:autopilot.config.ENABLED,persistent:store.persistent,last_error:e.message,alerts:[{severity:'error',message:e.message}]};}}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&u.pathname==='/')return serveFile(res,path.join(PUBLIC,'index.html'));
    if(req.method==='GET'&&['/app.js','/styles.css'].includes(u.pathname))return serveFile(res,path.join(PUBLIC,path.basename(u.pathname)));

    if(req.method==='GET'&&u.pathname==='/api/health'){
      const c=engine.config(),storage=await store.health(),auto=await safeStatus();
      return send(res,200,{ok:true,version:engine.VERSION,models:engine.MODELS.length,odds_ready:c.oddsReady,cfbd_ready:c.cfbdReady,max_scan_games:c.maxScanGames,max_deep_market_games:c.maxDeepMarketGames,max_deep_market_credits:c.maxDeepMarketCredits,odds_cache_ttl_ms:c.oddsCacheTtlMs,min_odds_refresh_ms:c.minOddsRefreshMs,odds_quota_reserve:c.oddsQuotaReserve,auth_required:!!ACCESS_PIN,authenticated:validSession(req),autopilot_enabled:auto.enabled,autopilot_secret_ready:!!AUTOPILOT_SECRET,persistent_storage:storage.persistent,storage_backend:storage.backend,storage_key_mode:storage.key_mode||'none',storage_ok:storage.ok,last_autopilot_success:auto.last_success_at||null,last_autopilot_error:auto.last_error||null,openai_used:false,cost_layer:'No paid AI calls. Public/free data + quota-governed sportsbook API.',autopilot_sports:autopilot.config.AUTO_SPORTS,release_sports:autopilot.config.RELEASE_SPORTS,daily_odds_budget:autopilot.config.DAILY_BUDGET,monthly_odds_budget:autopilot.config.MONTHLY_BUDGET,auto_deep_credit_cap:autopilot.config.AUTO_DEEP_CREDIT_CAP});
    }
    if(req.method==='POST'&&u.pathname==='/api/login'){
      if(!ACCESS_PIN)return send(res,200,{ok:true,auth_required:false});
      if(!rateLimit(req,res,'login',12,15*60e3))return;
      const body=JSON.parse(await readBody(req)||'{}');
      if(!secureEqual(String(body.pin||''),ACCESS_PIN))return send(res,401,{error:'Incorrect AEGIS PIN.'});
      const token=makeSession(),secure=String(req.headers['x-forwarded-proto']||'').includes('https')||process.env.NODE_ENV==='production';
      return send(res,200,{ok:true},'application/json',{'Set-Cookie':`aegis_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}${secure?'; Secure':''}`});
    }
    if(req.method==='POST'&&u.pathname==='/api/logout')return send(res,200,{ok:true},'application/json',{'Set-Cookie':'aegis_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'});
    if(req.method==='GET'&&u.pathname==='/api/models')return send(res,200,{models:engine.MODELS});
    if(req.method==='GET'&&u.pathname==='/api/sports')return send(res,200,{sports:engine.SPORTS});

    // Scheduled GitHub Actions calls authenticate with their own bearer secret and do not need a browser session.
    if(req.method==='POST'&&u.pathname==='/api/autopilot/tick'){
      if(!validAutopilot(req)&&!(ACCESS_PIN&&validSession(req)))return send(res,401,{error:'Autopilot authorization failed. Configure AEGIS_AUTOPILOT_SECRET for scheduled runs.'});
      const body=JSON.parse(await readBody(req)||'{}'),sport=u.searchParams.get('sport')||body.sport||null,force=u.searchParams.get('force')==='1'||!!body.force;
      const result=await autopilot.tick({force,sports:sport?[sport]:body.sports,reason:body.reason||'scheduled autopilot'});
      return send(res,200,result);
    }

    if(u.pathname.startsWith('/api/')&&!requireAuth(req,res))return;

    if(req.method==='GET'&&u.pathname==='/api/autopilot/status')return send(res,200,await autopilot.status());
    if(req.method==='GET'&&u.pathname==='/api/cards/latest'){
      const sport=u.searchParams.get('sport');return send(res,200,{card:await autopilot.latestCard(sport),sport:sport||null});
    }
    if(req.method==='GET'&&u.pathname==='/api/results/ledger')return send(res,200,await autopilot.results());
    if(req.method==='POST'&&u.pathname==='/api/results/grade'){
      if(!rateLimit(req,res,'grade',20))return;return send(res,200,{ok:true,...await autopilot.gradeNow()});
    }
    if(req.method==='POST'&&u.pathname==='/api/card/lock'){
      const body=JSON.parse(await readBody(req)||'{}');return send(res,200,{ok:true,...await autopilot.manualLock(Array.isArray(body.keys)?body.keys:[])});
    }
    if(req.method==='GET'&&u.pathname==='/api/state/export'){
      const state=await store.load();return send(res,200,{exported_at:new Date().toISOString(),version:engine.VERSION,state});
    }
    if(req.method==='POST'&&u.pathname==='/api/results/resolve'){
      if(!rateLimit(req,res,'results',30))return;
      const body=JSON.parse(await readBody(req)||'{}'),records=Array.isArray(body.records)?body.records.slice(0,120):[],results=[];
      for(const r of records){const score=await engine.resolveFinalScore(r),outcome=engine.settledBetOutcome(r,score);results.push({...r,...score,outcome});}
      return send(res,200,{ok:true,results});
    }
    if(req.method==='GET'&&u.pathname==='/api/odds'){
      if(!rateLimit(req,res,'odds',40))return;
      const sport=u.searchParams.get('sport')||'baseball_mlb',markets=u.searchParams.get('markets')||'h2h,spreads,totals',force=u.searchParams.get('force')==='1';
      const r=await engine.oddsFetch(baseOddsEndpoint(sport,markets),{force});
      const events=engine.pregameOnly(r.data),fetchedAt=r.meta?.fetched_at||(r.meta?.cached?new Date(Date.now()-(r.meta.cache_age_ms||0)).toISOString():new Date().toISOString());
      return send(res,200,{events,filtered_live_count:(r.data||[]).length-events.length,quota:r.meta,fetched_at:fetchedAt,cached:!!r.meta?.cached});
    }
    if(req.method==='POST'&&u.pathname==='/api/scan'){
      if(!rateLimit(req,res,'scan',24))return;
      const body=JSON.parse(await readBody(req)||'{}');
      let events=(body.events||[]).map(engine.sanitizeEvent),boardRefreshed=false;
      const age=body.board_synced_at?Date.now()-new Date(body.board_synced_at).getTime():Infinity;
      const sport=body.sport||events[0]?.sport_key||'baseball_mlb',markets=body.markets||'h2h,spreads,totals';
      if(!events.length||!Number.isFinite(age)||age>180000){
        const r=await engine.oddsFetch(baseOddsEndpoint(sport,markets),{force:true});events=engine.pregameOnly(r.data).map(engine.sanitizeEvent);boardRefreshed=true;
      }
      if(!events.length)return send(res,400,{error:'No upcoming events were supplied or found.'});
      const out=await engine.scanSlate(events);out.board_refreshed=boardRefreshed;out.board_age_ms=boardRefreshed?0:Math.max(0,age);out.release_enabled=autopilot.config.RELEASE_SPORTS.includes(sport);out.autopilot={generated:false,reason:'manual in-depth scan',release_enabled:out.release_enabled};
      try{out.persistence=await autopilot.captureScan(sport,out,events,'manual in-depth scan');}catch(e){out.persistence={saved:false,error:e.message};}
      return send(res,200,out);
    }
    return send(res,404,{error:'Not found'});
  }catch(e){console.error(e);return send(res,500,{error:e.message||'Server error'});}
});

server.listen(PORT,'0.0.0.0',()=>console.log(`AEGIS ${engine.VERSION} running on ${PORT} • ${engine.MODELS.length} registered systems • autopilot ${autopilot.config.ENABLED?'enabled':'disabled'} • persistence ${store.persistent?'cloud':'ephemeral fallback'}`));
