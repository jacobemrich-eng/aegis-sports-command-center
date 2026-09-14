const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const engine = require('./src/engine');
const autopilot = require('./src/autopilot');
const store = require('./src/store');
const release = require('./src/release');
const operations = require('./src/operations');
const heartbeat = require('./src/heartbeat');
const dataGateway = require('./src/data-gateway');
const providerRouter = require('./src/provider-router');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PUBLIC_ROOT = path.resolve(PUBLIC);
const ACCESS_PIN = String(process.env.AEGIS_ACCESS_PIN || '').trim();
const SESSION_SECRET = String(process.env.AEGIS_SESSION_SECRET || '').trim();
const AUTOPILOT_SECRET = String(process.env.AEGIS_AUTOPILOT_SECRET || '').trim();
const SESSION_TTL_MS = 8*60*60*1000;
const MAX_SESSIONS = 512;
const MAX_RATE_ENTRIES = 512;
const LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15*60*1000;
const RATE = new Map();
const SESSIONS = new Map();
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
function adminAuthConfigured(){return !!ACCESS_PIN&&!!SESSION_SECRET;}
function pruneSessions(now=Date.now()){
  for(const [id,row] of SESSIONS)if(row.expiresAt<=now)SESSIONS.delete(id);
  while(SESSIONS.size>=MAX_SESSIONS){
    const oldest=SESSIONS.keys().next().value;
    if(oldest===undefined)break;
    SESSIONS.delete(oldest);
  }
}
function makeSession(){
  pruneSessions();
  const expiresAt=Date.now()+SESSION_TTL_MS,
        id=crypto.randomBytes(24).toString('base64url'),
        csrfToken=crypto.randomBytes(24).toString('base64url'),
        payload=`${expiresAt}.${id}`;
  SESSIONS.set(id,{expiresAt,csrfToken});
  return {token:`${payload}.${sign(payload)}`,csrfToken,expiresAt};
}
function session(req){
  if(!adminAuthConfigured())return null;
  const token=cookies(req).aegis_session||'',parts=token.split('.');
  if(parts.length!==3)return null;
  const [expiresAt,id,sig]=parts,payload=`${expiresAt}.${id}`;
  if(!secureEqual(sig,sign(payload)))return null;
  const row=SESSIONS.get(id);
  if(!row||row.expiresAt!==Number(expiresAt)||row.expiresAt<=Date.now()){
    if(row)SESSIONS.delete(id);
    return null;
  }
  return {id,...row};
}
function validSession(req){return !!session(req);}
function revokeSession(req){const current=session(req);if(current)SESSIONS.delete(current.id);}
function bearer(req){const h=String(req.headers.authorization||'');return h.startsWith('Bearer ')?h.slice(7).trim():'';}
function validAutopilot(req){return !!AUTOPILOT_SECRET&&secureEqual(bearer(req),AUTOPILOT_SECRET);}
function ip(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();}
function pruneRateLimits(now=Date.now()){
  for(const [key,row] of RATE)if(row.start+row.windowMs<=now)RATE.delete(key);
  while(RATE.size>=MAX_RATE_ENTRIES){
    const oldest=RATE.keys().next().value;
    if(oldest===undefined)break;
    RATE.delete(oldest);
  }
}
function rateLimit(req,res,bucket,limit,windowMs=3600e3){
  const key=`${bucket}|${ip(req)}`,t=Date.now();
  let row=RATE.get(key);
  if(row&&row.start+row.windowMs<=t){RATE.delete(key);row=null;}
  if(!row){pruneRateLimits(t);row={start:t,count:0,windowMs};}
  row.count++;
  RATE.delete(key);
  RATE.set(key,row);
  if(row.count>limit){const retry=Math.ceil((row.start+row.windowMs-t)/1000);send(res,429,{error:`AEGIS rate limit reached for ${bucket}. Try again in ${Math.ceil(retry/60)} minute(s).`},'application/json',{'Retry-After':String(retry)});return false;}
  return true;
}
function requireAdminAuth(req,res){
  if(!adminAuthConfigured()){
    send(res,503,{error:'AEGIS administrator access is unavailable.',code:'admin_auth_unavailable'});
    return false;
  }
  if(validSession(req))return true;
  send(res,401,{error:'AEGIS administrator authentication is required.',auth_required:true});
  return false;
}
function requestOrigin(req){
  const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim(),
        host=String(req.headers.host||'').trim();
  return `${proto}://${host}`;
}
function trustedBrowserOrigin(req,{allowMissing=false}={}){
  const fetchSite=String(req.headers['sec-fetch-site']||'').toLowerCase();
  if(fetchSite==='cross-site')return false;
  const source=String(req.headers.origin||req.headers.referer||'').trim();
  if(!source)return allowMissing&&!fetchSite;
  try{return new URL(source).origin===new URL(requestOrigin(req)).origin;}catch{return false;}
}
function requireLoginOrigin(req,res){
  if(trustedBrowserOrigin(req))return true;
  send(res,403,{error:'Request origin is not allowed.',code:'invalid_origin'});
  return false;
}
function requireAdminMutation(req,res){
  if(!requireAdminAuth(req,res))return false;
  const current=session(req);
  if(!trustedBrowserOrigin(req)){
    send(res,403,{error:'Request origin is not allowed.',code:'invalid_origin'});
    return false;
  }
  if(!current||!secureEqual(String(req.headers['x-aegis-csrf']||''),current.csrfToken)){
    send(res,403,{error:'CSRF validation failed.',code:'invalid_csrf'});
    return false;
  }
  return true;
}
function mime(file){const ext=path.extname(file).toLowerCase();return ({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'}[ext]||'application/octet-stream');}
function serveFile(res,file){try{const buf=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':file.endsWith('.html')?'no-store':'public, max-age=180',...SECURITY_HEADERS});res.end(buf);}catch{send(res,404,{error:'Not found'});}}
function publicFile(urlPath){
  try{
    const rel=decodeURIComponent(String(urlPath||'')).replace(/^\/+/, '');
    if(!rel||rel.includes('\0'))return null;
    const file=path.resolve(PUBLIC_ROOT,rel);
    if(file!==PUBLIC_ROOT&&!file.startsWith(PUBLIC_ROOT+path.sep))return null;
    return file;
  }catch{return null;}
}
function baseOddsEndpoint(sport,markets){const cfg=engine.config();return `sports/${encodeURIComponent(sport)}/odds?bookmakers=${encodeURIComponent(cfg.bookmakers)}&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`;}
const DATA_GATEWAY=dataGateway.config();
async function sharedBoard(sport){
  try{
    const state=await store.load();
    return dataGateway.boardSnapshot(state,sport,{
      maxAgeMs:DATA_GATEWAY.maxAgeMs,
      maxStaleMs:DATA_GATEWAY.maxStaleMs
    });
  }catch(e){
    return {available:false,fresh:false,stale:false,events:[],fetched_at:null,age_ms:null,source:'persistent_shared_board',error:e.message};
  }
}
async function safeStatus(){try{return await autopilot.status();}catch(e){return {enabled:autopilot.config.ENABLED,persistent:store.persistent,last_error:e.message,alerts:[{severity:'error',message:e.message}]};}}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&u.pathname==='/')return serveFile(res,path.join(PUBLIC,'index.html'));

    // Serve any real file inside /public. This keeps the frontend future-proof for
    // versioned CSS/JS, logos, SVGs, images and other presentation assets.
    if(req.method==='GET'&&!u.pathname.startsWith('/api/')){
      const file=publicFile(u.pathname);
      if(file&&fs.existsSync(file)&&fs.statSync(file).isFile())return serveFile(res,file);
    }

    if(req.method==='GET'&&u.pathname==='/api/health'){
      return send(res,200,{ok:true,status:'UP',service:'aegis-sports-command-center'});
    }

    if(req.method==='GET'&&u.pathname==='/api/admin/status'){
    if(!requireAdminAuth(req,res))return;
    const c=engine.config(),
storage=await store.health(),
auto=await safeStatus();
              const ops=operations.evaluate({
                auto,
                storage,
                config:{
                  autopilotEnabled:auto.enabled,
                  dailyBudget:autopilot.config.DAILY_BUDGET,
                  monthlyBudget:autopilot.config.MONTHLY_BUDGET,
                  scheduleMinutes:15,
                  autoLockMinutes:Number(process.env.AEGIS_AUTO_LOCK_MINUTES||30),
                  gradeDelayHours:Number(process.env.AEGIS_GRADE_DELAY_HOURS||2),
                  releaseSports:autopilot.config.RELEASE_SPORTS,
                  schedulerRedundancy:heartbeat.publicState({
                    secretReady:!!String(process.env.AEGIS_HEARTBEAT_SECRET||'').trim(),
                    autopilotSecretReady:!!String(process.env.AEGIS_AUTOPILOT_SECRET||'').trim(),
                    staleMinutes:Number(process.env.AEGIS_HEARTBEAT_STALE_MINUTES||35),
                    probeFreshMinutes:Number(process.env.AEGIS_HEARTBEAT_PROBE_FRESH_MINUTES||25),
                    debounceMs:Number(process.env.AEGIS_HEARTBEAT_DEBOUNCE_MS||15000),
                    uptimeSeconds:process.uptime()
                  })
                },
                production:process.env.NODE_ENV==='production',
                uptimeSeconds:process.uptime()
              });

    const health=release.buildHealth({
      storage,
      auto,
      oddsReady:c.oddsReady,
      cfbdReady:c.cfbdReady,
      autopilotSecretReady:!!AUTOPILOT_SECRET,
      releaseSports:autopilot.config.RELEASE_SPORTS,
      schedulerRedundancy:heartbeat.publicState({
        secretReady:!!String(process.env.AEGIS_HEARTBEAT_SECRET||'').trim(),
        autopilotSecretReady:!!String(process.env.AEGIS_AUTOPILOT_SECRET||'').trim(),
        staleMinutes:Number(process.env.AEGIS_HEARTBEAT_STALE_MINUTES||35),
        probeFreshMinutes:Number(process.env.AEGIS_HEARTBEAT_PROBE_FRESH_MINUTES||25),
        debounceMs:Number(process.env.AEGIS_HEARTBEAT_DEBOUNCE_MS||15000),
        uptimeSeconds:process.uptime()
      }),
      engineVersion:engine.VERSION
    });

    return send(res,200,{
      ...health,
                operations:ops,
                scheduler_redundancy:ops.safeguards?.scheduler_redundancy||null,

      version:release.APP_VERSION,

      models:engine.MODELS.length,

      odds_ready:c.oddsReady,
      cfbd_ready:c.cfbdReady,

      max_scan_games:c.maxScanGames,
      max_deep_market_games:c.maxDeepMarketGames,
      max_deep_market_credits:c.maxDeepMarketCredits,

      odds_cache_ttl_ms:c.oddsCacheTtlMs,
      min_odds_refresh_ms:c.minOddsRefreshMs,
      odds_quota_reserve:c.oddsQuotaReserve,

      provider_cache:c.providerCache,
      provider_cache_max_stale_ms:c.providerCacheMaxStaleMs,
      odds_provider:c.oddsProvider,
      provider_router:c.providerRouter,

      auth_required:true,
      authenticated:validSession(req),

      autopilot_enabled:auto.enabled,
      autopilot_secret_ready:!!AUTOPILOT_SECRET,

      persistent_storage:storage.persistent,
      storage_backend:storage.backend,
      storage_key_mode:storage.key_mode||'none',
      storage_ok:storage.ok,

      last_autopilot_success:auto.last_success_at||null,
      last_autopilot_error:auto.last_error||null,

      openai_used:false,

      cost_layer:
        'No paid AI calls. Public/free data + quota-governed sportsbook API.',

      autopilot_sports:autopilot.config.AUTO_SPORTS,
      release_sports:autopilot.config.RELEASE_SPORTS,

      daily_odds_budget:autopilot.config.DAILY_BUDGET,
      monthly_odds_budget:autopilot.config.MONTHLY_BUDGET,
      auto_deep_credit_cap:
        autopilot.config.AUTO_DEEP_CREDIT_CAP,
      data_gateway:{
        mode:DATA_GATEWAY.mode,
        shared_board_max_age_ms:DATA_GATEWAY.maxAgeMs,
        shared_board_max_stale_ms:DATA_GATEWAY.maxStaleMs,
        public_force_refresh_enabled:DATA_GATEWAY.mode==='legacy'
      }
    });
  }
                if(req.method==='GET'&&u.pathname==='/api/operations/status'){
              if(!requireAdminAuth(req,res))return;
              const c=engine.config(),
                    storage=await store.health(),
                    auto=await safeStatus();

              const ops=operations.evaluate({
                auto,
                storage,
                config:{
                  autopilotEnabled:auto.enabled,
                  dailyBudget:autopilot.config.DAILY_BUDGET,
                  monthlyBudget:autopilot.config.MONTHLY_BUDGET,
                  scheduleMinutes:15,
                  autoLockMinutes:Number(process.env.AEGIS_AUTO_LOCK_MINUTES||30),
                  gradeDelayHours:Number(process.env.AEGIS_GRADE_DELAY_HOURS||2),
                  releaseSports:autopilot.config.RELEASE_SPORTS,
                  oddsQuotaReserve:c.oddsQuotaReserve
                },
                production:process.env.NODE_ENV==='production',
                uptimeSeconds:process.uptime()
              });

              return send(res,200,{
                ok:ops.status!=='RED',
                release_version:release.APP_VERSION,
                engine_version:engine.VERSION,
                operations:ops,
                scheduler_redundancy:ops.safeguards?.scheduler_redundancy||null
              });
            }
if(req.method==='POST'&&u.pathname==='/api/autopilot/heartbeat'){
  const heartbeatSecret=String(process.env.AEGIS_HEARTBEAT_SECRET||'').trim();
  const autopilotSecret=String(process.env.AEGIS_AUTOPILOT_SECRET||'').trim();

  if(!heartbeat.authorized(req.headers.authorization,heartbeatSecret)){
    return send(res,401,{ok:false,error:'unauthorized'});
  }

  const storage=await store.health(),
        auto=await safeStatus();

  const heartbeatState=heartbeat.publicState({
    secretReady:!!heartbeatSecret,
    autopilotSecretReady:!!autopilotSecret,
    staleMinutes:Number(process.env.AEGIS_HEARTBEAT_STALE_MINUTES||35),
    probeFreshMinutes:Number(process.env.AEGIS_HEARTBEAT_PROBE_FRESH_MINUTES||25),
    debounceMs:Number(process.env.AEGIS_HEARTBEAT_DEBOUNCE_MS||15000),
    uptimeSeconds:process.uptime()
  });

  const ops=operations.evaluate({
    auto,
    storage,
    config:{
      autopilotEnabled:auto.enabled,
      dailyBudget:autopilot.config.DAILY_BUDGET,
      monthlyBudget:autopilot.config.MONTHLY_BUDGET,
      scheduleMinutes:15,
      autoLockMinutes:Number(process.env.AEGIS_AUTO_LOCK_MINUTES||30),
      gradeDelayHours:Number(process.env.AEGIS_GRADE_DELAY_HOURS||2),
      releaseSports:autopilot.config.RELEASE_SPORTS,
      schedulerRedundancy:heartbeatState
    },
    production:process.env.NODE_ENV==='production',
    uptimeSeconds:process.uptime()
  });

  const gate=heartbeat.decide({
    operations:ops,
    storage,
    secretReady:!!heartbeatSecret,
    autopilotSecretReady:!!autopilotSecret,
    staleMinutes:Number(process.env.AEGIS_HEARTBEAT_STALE_MINUTES||35),
    uptimeSeconds:process.uptime()
  });

  heartbeat.recordProbe(gate);

  if(!gate.trigger){
    return send(res,200,{
      ok:true,
      triggered:false,
      reason:gate.reason,
      last_success_age_minutes:gate.last_success_age_minutes,
      redundancy:heartbeat.publicState({
        secretReady:!!heartbeatSecret,
        autopilotSecretReady:!!autopilotSecret,
        staleMinutes:Number(process.env.AEGIS_HEARTBEAT_STALE_MINUTES||35),
        probeFreshMinutes:Number(process.env.AEGIS_HEARTBEAT_PROBE_FRESH_MINUTES||25),
        debounceMs:Number(process.env.AEGIS_HEARTBEAT_DEBOUNCE_MS||15000),
        uptimeSeconds:process.uptime()
      })
    });
  }

  const queued=heartbeat.queueRecovery({
    delayMs:Number(process.env.AEGIS_HEARTBEAT_DEBOUNCE_MS||15000),
    recheck:async()=>{
      const storage2=await store.health(),
            auto2=await safeStatus();
      const state2=heartbeat.publicState({
        secretReady:!!heartbeatSecret,
        autopilotSecretReady:!!autopilotSecret,
        staleMinutes:Number(process.env.AEGIS_HEARTBEAT_STALE_MINUTES||35),
        probeFreshMinutes:Number(process.env.AEGIS_HEARTBEAT_PROBE_FRESH_MINUTES||25),
        debounceMs:Number(process.env.AEGIS_HEARTBEAT_DEBOUNCE_MS||15000),
        uptimeSeconds:process.uptime()
      });
      const ops2=operations.evaluate({
        auto:auto2,
        storage:storage2,
        config:{
          autopilotEnabled:auto2.enabled,
          dailyBudget:autopilot.config.DAILY_BUDGET,
          monthlyBudget:autopilot.config.MONTHLY_BUDGET,
          scheduleMinutes:15,
          autoLockMinutes:Number(process.env.AEGIS_AUTO_LOCK_MINUTES||30),
          gradeDelayHours:Number(process.env.AEGIS_GRADE_DELAY_HOURS||2),
          releaseSports:autopilot.config.RELEASE_SPORTS,
          schedulerRedundancy:state2
        },
        production:process.env.NODE_ENV==='production',
        uptimeSeconds:process.uptime()
      });
      return heartbeat.decide({
        operations:ops2,
        storage:storage2,
        ignoreInFlight:true,
        secretReady:!!heartbeatSecret,
        autopilotSecretReady:!!autopilotSecret,
        staleMinutes:Number(process.env.AEGIS_HEARTBEAT_STALE_MINUTES||35),
        uptimeSeconds:process.uptime()
      });
    },
    run:async()=>{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),220000);
      try{
        const response=await fetch(`http://127.0.0.1:${PORT}/api/autopilot/tick`,{
          method:'POST',
          headers:{
            Authorization:`Bearer ${autopilotSecret}`,
            'Content-Type':'application/json',
            'X-AEGIS-Recovery-Source':'heartbeat'
          },
          signal:controller.signal
        });
        const raw=await response.text();
        let body=null;
        try{body=raw?JSON.parse(raw):null;}catch{}
        if(!response.ok||!body||body.ok!==true){
          throw new Error(`autopilot_tick_failed_${response.status}`);
        }
        return {
          ok:true,
          status:response.status,
          runs:Array.isArray(body.runs)?body.runs.length:null,
          errors:Array.isArray(body.errors)?body.errors.length:null,
          graded:body.graded??null,
          persistent:body.persistent??null
        };
      }finally{
        clearTimeout(timer);
      }
    }
  });

  return send(res,queued?202:200,{
    ok:true,
    triggered:queued,
    reason:queued?'recovery_queued':'recovery_already_queued',
    last_success_age_minutes:gate.last_success_age_minutes
  });
}
  // Unauthenticated authentication-entry route. Origin and rate checks run before credentials are evaluated.
  if(req.method==='POST'&&u.pathname==='/api/login'){
      if(!requireLoginOrigin(req,res))return;
      if(!rateLimit(req,res,'login',LOGIN_ATTEMPTS,LOGIN_WINDOW_MS))return;
      if(!adminAuthConfigured())return send(res,503,{error:'AEGIS administrator login is unavailable.',code:'admin_auth_unavailable'});
      let body;
      try{body=JSON.parse(await readBody(req)||'{}');}
      catch{return send(res,400,{error:'Invalid request.',code:'invalid_request'});}
      if(!secureEqual(String(body.pin||''),ACCESS_PIN))return send(res,401,{error:'Authentication failed.',code:'authentication_failed'});
      revokeSession(req);
      const created=makeSession(),secure=String(req.headers['x-forwarded-proto']||'').includes('https')||process.env.NODE_ENV==='production';
      return send(res,200,{ok:true,csrf_token:created.csrfToken,expires_at:new Date(created.expiresAt).toISOString()},'application/json',{'Set-Cookie':`aegis_session=${encodeURIComponent(created.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}${secure?'; Secure':''}`});
    }
    if(req.method==='GET'&&u.pathname==='/api/session'){
      const current=session(req);
      return send(res,200,{
        authenticated:!!current,
        ...(current?{csrf_token:current.csrfToken,expires_at:new Date(current.expiresAt).toISOString()}:{}),
      });
    }
    if(req.method==='POST'&&u.pathname==='/api/logout'){
      if(!requireAdminMutation(req,res))return;
      revokeSession(req);
      const secure=String(req.headers['x-forwarded-proto']||'').includes('https')||process.env.NODE_ENV==='production';
      return send(res,200,{ok:true},'application/json',{'Set-Cookie':`aegis_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`});
    }
    if(req.method==='GET'&&u.pathname==='/api/models')return send(res,200,{models:engine.MODELS});
    if(req.method==='GET'&&u.pathname==='/api/sports')return send(res,200,{sports:engine.SPORTS});
    if(req.method==='GET'&&u.pathname==='/api/cards/latest'){
      const sport=u.searchParams.get('sport');return send(res,200,{card:await autopilot.latestCard(sport),sport:sport||null});
    }
    if(req.method==='GET'&&u.pathname==='/api/results/ledger')return send(res,200,await autopilot.results());

    // Scheduled GitHub Actions calls authenticate with their own bearer secret and do not need a browser session.
    if(req.method==='POST'&&u.pathname==='/api/autopilot/tick'){
      const machineAuthorized=validAutopilot(req);
      if(!machineAuthorized&&!requireAdminMutation(req,res))return;
      const body=JSON.parse(await readBody(req)||'{}'),sport=u.searchParams.get('sport')||body.sport||null,force=u.searchParams.get('force')==='1'||!!body.force;
      const result=await autopilot.tick({force,sports:sport?[sport]:body.sports,reason:body.reason||'scheduled autopilot'});
      return send(res,200,result);
    }
    if(req.method==='GET'&&u.pathname==='/api/autopilot/status'){
      const machineAuthorized=validAutopilot(req);
      if(!machineAuthorized&&!requireAdminAuth(req,res))return;
      return send(res,200,await autopilot.status());
    }

    if(u.pathname.startsWith('/api/')&&req.method!=='GET'&&req.method!=='HEAD'&&!requireAdminMutation(req,res))return;
    if(u.pathname.startsWith('/api/')&&!requireAdminAuth(req,res))return;

    if(req.method==='POST'&&u.pathname==='/api/admin/diagnostics/provider-failover'){
      if(!rateLimit(req,res,'provider-failover-diagnostic',2,60*60*1000))return;

      let body;
      try{body=JSON.parse(await readBody(req)||'{}');}
      catch{return send(res,400,{success:false,provider_used:null,route:'diagnostic_rejected',sport:null,normalized_event_count:0,bookmaker_count:0,hard_rock_bet_present:false,elapsed_ms:0,production_route_untouched:true,error:'invalid_request'});}

      try{
        const result=await providerRouter.diagnoseFailover({
          sport:body.sport,
          markets:body.markets,
          bookmakers:engine.config().bookmakers
        });
        return send(res,result.success?200:502,result);
      }catch(error){
        const status=Number(error?.status)===400?400:500;
        return send(res,status,{success:false,provider_used:null,route:'diagnostic_rejected',sport:String(body.sport||'').slice(0,40),normalized_event_count:0,bookmaker_count:0,hard_rock_bet_present:false,elapsed_ms:0,production_route_untouched:true,error:status===400?String(error.code||'invalid_request'):'diagnostic_failed'});
      }
    }

    if(req.method==='POST'&&u.pathname==='/api/results/grade'){
      if(!rateLimit(req,res,'grade',20))return;return send(res,200,{ok:true,...await autopilot.gradeNow()});
    }
    if(req.method==='POST'&&u.pathname==='/api/card/lock'){
      const body=JSON.parse(await readBody(req)||'{}');return send(res,200,{ok:true,...await autopilot.manualLock(Array.isArray(body.keys)?body.keys:[])});
    }
    if(req.method==='GET'&&u.pathname==='/api/state/export'){
      const state=await store.load();return send(res,200,{exported_at:new Date().toISOString(),version:release.APP_VERSION,release_version:release.APP_VERSION,engine_version:engine.VERSION,state});
    }
    if(req.method==='POST'&&u.pathname==='/api/results/resolve'){
      if(!rateLimit(req,res,'results',30))return;
      const body=JSON.parse(await readBody(req)||'{}'),records=Array.isArray(body.records)?body.records.slice(0,120):[],results=[];
      for(const r of records){const score=await engine.resolveFinalScore(r),outcome=engine.settledBetOutcome(r,score);results.push({...r,...score,outcome});}
      return send(res,200,{ok:true,results});
    }
    if(req.method==='GET'&&u.pathname==='/api/odds'){
      if(!rateLimit(req,res,'odds',40))return;
      const sport=u.searchParams.get('sport')||'baseball_mlb',
            markets=u.searchParams.get('markets')||'h2h,spreads,totals',
            queryForce=u.searchParams.get('force')==='1',
            shared=await sharedBoard(sport);

      if(dataGateway.shouldUseShared(shared,DATA_GATEWAY.mode)){
        const events=engine.pregameOnly(shared.events).map(engine.sanitizeEvent);
        return send(res,200,{
          events,
          filtered_live_count:Math.max(0,shared.events.length-events.length),
          quota:engine.config().lastOddsMeta||null,
          fetched_at:shared.fetched_at,
          cached:true,
          source:shared.source,
          stale:shared.stale,
          cache_age_ms:shared.age_ms,
          gateway_mode:DATA_GATEWAY.mode
        });
      }

      const force=dataGateway.publicProviderForceRequested(queryForce,DATA_GATEWAY.mode);
      const r=await engine.oddsFetch(baseOddsEndpoint(sport,markets),{force});
      const events=engine.pregameOnly(r.data),
            fetchedAt=r.meta?.fetched_at||(r.meta?.cached?new Date(Date.now()-(r.meta.cache_age_ms||0)).toISOString():new Date().toISOString());
      return send(res,200,{
        events,
        filtered_live_count:(r.data||[]).length-events.length,
        quota:r.meta,
        fetched_at:fetchedAt,
        cached:!!r.meta?.cached,
        source:'provider_read_through',
        stale:false,
        gateway_mode:DATA_GATEWAY.mode
      });
    }
    if(req.method==='POST'&&u.pathname==='/api/scan'){
      if(!rateLimit(req,res,'scan',24))return;
      const body=JSON.parse(await readBody(req)||'{}');
      let events=(body.events||[]).map(engine.sanitizeEvent),
          boardRefreshed=false,
          boardSource='request',
          boardAge=body.board_synced_at?Date.now()-new Date(body.board_synced_at).getTime():Infinity;
      const sport=body.sport||events[0]?.sport_key||'baseball_mlb',
            markets=body.markets||'h2h,spreads,totals';

      if(!events.length||!Number.isFinite(boardAge)||boardAge>180000){
        const shared=await sharedBoard(sport);
        if(dataGateway.shouldUseShared(shared,DATA_GATEWAY.mode)){
          events=engine.pregameOnly(shared.events).map(engine.sanitizeEvent);
          boardSource=shared.source;
          boardAge=shared.age_ms;
        }else{
          const r=await engine.oddsFetch(baseOddsEndpoint(sport,markets),{force:false});
          events=engine.pregameOnly(r.data).map(engine.sanitizeEvent);
          boardRefreshed=!r.meta?.cached;
          boardSource='provider_read_through';
          boardAge=r.meta?.cached?Number(r.meta.cache_age_ms||0):0;
        }
      }

      if(!events.length)return send(res,400,{error:'No upcoming events were supplied or found.'});
      const out=await engine.scanSlate(events);
      out.board_refreshed=boardRefreshed;
      out.board_age_ms=Number.isFinite(boardAge)?Math.max(0,boardAge):null;
      out.board_source=boardSource;
      out.gateway_mode=DATA_GATEWAY.mode;
      out.release_enabled=autopilot.config.RELEASE_SPORTS.includes(sport);
      out.autopilot={generated:false,reason:'manual in-depth scan',release_enabled:out.release_enabled};
      try{out.persistence=await autopilot.captureScan(sport,out,events,'manual in-depth scan');}catch(e){out.persistence={saved:false,error:e.message};}
      return send(res,200,out);
    }
    return send(res,404,{error:'Not found'});
  }catch(e){console.error(e);return send(res,500,{error:'Internal server error',code:'internal_server_error'});}
});

server.listen(PORT,'0.0.0.0',()=>console.log(`AEGIS release ${release.APP_VERSION} • engine ${engine.VERSION} running on ${PORT} • ${engine.MODELS.length} registered systems • autopilot ${autopilot.config.ENABLED?'enabled':'disabled'} • persistence ${store.persistent?'cloud':'ephemeral fallback'}`));
