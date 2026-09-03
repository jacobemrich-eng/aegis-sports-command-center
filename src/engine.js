const http = require('http');
const { URL } = require('url');
const decision = require('./decision');

const PORT = Number(process.env.PORT || 3000);
const ODDS_KEY = process.env.ODDS_API_KEY || '';
const CFBD_KEY = process.env.CFBD_API_KEY || '';
const ODDS_BOOKMAKERS = process.env.ODDS_BOOKMAKERS || 'hardrockbet_fl,fanduel,draftkings,bovada,betmgm,espnbet,fanatics';
const MAX_SCAN_GAMES = Math.max(1, Math.min(40, Number(process.env.MAX_SCAN_GAMES || 15)));
const MAX_DEEP_MARKET_GAMES = Math.max(1, Math.min(8, Number(process.env.MAX_DEEP_MARKET_GAMES || 4)));
const MAX_DEEP_MARKET_CREDITS = Math.max(3, Math.min(24, Number(process.env.MAX_DEEP_MARKET_CREDITS || 10)));
const ODDS_CACHE_TTL_MS = Math.max(30000, Math.min(300000, Number(process.env.ODDS_CACHE_TTL_MS || 120000)));
const MIN_ODDS_REFRESH_MS = Math.max(30000, Math.min(180000, Number(process.env.MIN_ODDS_REFRESH_MS || 60000)));
const ODDS_QUOTA_RESERVE = Math.max(0, Math.min(200, Number(process.env.ODDS_QUOTA_RESERVE || 35)));
const TARGET_BOOK = 'hardrockbet_fl';
const VERSION = '8.8.0-decision-intelligence';
let LAST_ODDS_META = {remaining:null,used:null,last:null};
let LAST_QUOTA_PROBE_AT = 0;
const DEEP_ODDS_CACHE = new Map();
const ODDS_RESPONSE_CACHE = new Map();
const MARKET_HISTORY = new Map();

const MODELS = [
  ['SB101 AEGIS v1.1 — September Daily-Use Freeze','governance','Canonical release/governance layer with freshness grades, executable price bands and immutable card-lock controls.'],
  ['Precision Mode','execution','Bankroll-protection mode with tight Core/Secondary caps.'],
  ['Independent Thesis Model','projection','Locks sports direction before sportsbook price.'],
  ['Model Agreement Score','governance','Penalizes major disagreement across relevant modules.'],
  ['Two-Independent-Edges Gate','governance','Requires multiple independent drivers for Core.'],
  ['Core Distinction / Stress-Test Gate v2','governance','Stress-tests qualified candidates against normal variance, modest efficiency regression, a weakened matchup assumption and information downgrade before Core survives.'],
  ['Cross-Slate Top-3 Scarcity Gate','execution','Keeps at most three standalone bankroll exposures actionable after cross-slate comparison; excess qualifiers remain WATCH rather than being forced.'],
  ['Execution Price State Engine','execution','Converts Play-To / Downgrade / Pass bands into automatic Core, Secondary, Watch or Pass execution states at the verified target book.'],
  ['Market Challenger / Prior','market','De-vigs market prices and treats consensus as a rival forecast.'],
  ['Market Intelligence System','market','Measures consensus, dispersion and quote freshness.'],
  ['Market-Specific Cushion Model','governance','Applies stricter required edge to volatile markets.'],
  ['Data Quality / Uncertainty Gate','governance','Blocks false precision when inputs are missing or stale.'],
  ['Mistake Firewall','governance','Final stale-data, correlation, price and contradiction check.'],
  ['How Does This Lose?','risk','Scores plausible failure paths before release.'],
  ['Score Prediction Model','projection','Produces expected score/margin/total from verified inputs.'],
  ['Market Selection Engine','market','Chooses the cleanest expression of the independent thesis.'],
  ['Offensive Support Filter v1.0','mlb','Checks whether pitcher edges have realistic run support.'],
  ['Road Favorite Filter','risk','Raises requirements for road favorites.'],
  ['Favorite Tax Model','market','Measures expensive-favorite price drag.'],
  ['Favorite Split Rule','execution','Supports ML/spread split for very expensive favorites when justified.'],
  ['F5 Tie-Risk Model','mlb','Adjusts early-inning baseball markets for draw probability.'],
  ['Fragile Totals Guard','risk','Raises the bar for totals with multiple volatility paths.'],
  ['NRFI/YRFI Model','mlb','Standalone first-inning scoring model when a verified market is available.'],
  ['MLB Game Model','mlb','Blends SP, offense, staff pitching, matchup and environment.'],
  ['MLB Starting Pitcher Projection','mlb','Uses probable starter season workload and skill profile.'],
  ['MLB Player Prop Model','mlb','Activates only when a verified prop feed is present.'],
  ['HR101','mlb','Activates only when verified hitter/pitcher prop inputs are present.'],
  ['HR101 × SB101 Alignment','mlb','Cross-validates HR candidates against game environment.'],
  ['KBO Model','baseball','League-adjusted KBO quality and volatility model.'],
  ['NPB Model','baseball','League-adjusted NPB run-prevention and leverage model.'],
  ['NFL Preseason Rotation Model','nfl_preseason','Requires verified rotation/depth evidence; otherwise lowers data quality.'],
  ['NFL Preseason QB Depth Model','nfl_preseason','Requires verified QB2/QB3/depth evidence.'],
  ['NFL Preseason Large-Favorite Gate','nfl_preseason','Blocks large preseason favorites without depth confirmation.'],
  ['NFL Preseason 1Q / 1H Model','nfl_preseason','Activates when early-rotation markets and verified usage are available.'],
  ['NFL Preseason Coaching Usage','nfl_preseason','Uses structured/news-feed usage evidence where available.'],
  ['NFL Preseason Joint-Practice Adjustment','nfl_preseason','Uses structured/news-feed joint-practice evidence where available.'],
  ['NFL Special Teams / Penalty / Turnover','nfl_preseason','Adds volatility guard to reserve-heavy football.'],
  ['WNBA Game Model','wnba','Projects pace/scoring, recent performance and availability.'],
  ['WNBA Player Prop Model','wnba','Activates only when verified player-role/prop feeds are available.'],
  ['Tennis Match Model','tennis','Registry-ready; not released without a configured free tennis data provider.'],
  ['Live Betting Model','live','Separated from pregame; no live game may enter the pregame final card.'],
  ['BET NOW / WAIT','execution','Uses quote freshness, game proximity and uncertainty.'],
  ['Correlation & Exposure Model','risk','Enforces one-thesis/limited same-game exposure.'],
  ['Parlay Construction System','execution','Requires every leg to qualify independently.'],
  ['Boost Evaluation System','execution','Promos never create an edge.'],
  ['Bankroll / Unit System','execution','Maps release tier to disciplined stake sizing.'],
  ['Slate Ranking System','execution','Ranks qualified bets relative to the full slate.'],
  ['Final Verification System','governance','Rechecks data coverage, market and failure paths before lock.'],
  ['Daily Results Audit System','audit','Automatically records pregame model snapshots, grades final outcomes, and measures ROI/calibration without paid services.'],
  ['Model Calibration / Development','audit','Uses minimum-sample performance evidence before any threshold or weight changes; never self-tunes from one game.'],
  ['Chat-First Development Policy','governance','Keeps research logic auditable before production porting.'],
  ['VantageIQ / SBOS Implementation Layer','platform','Production-facing implementation and display layer.'],
  ['Autopilot Research Orchestrator','automation','Schedules quota-aware pregame research and verification passes without manual scans.'],
  ['Source Freshness Gate','governance','Grades critical source recency A/B/C and blocks Core releases on C-level freshness.'],
  ['Play-To / Downgrade / Pass Engine','execution','Publishes executable price bands for every qualified market.'],
  ['Market History Recorder','market','Persists open-to-current snapshots, quote movement and model-vs-market changes.'],
  ['Automatic Promotion / Demotion Engine','automation','Moves candidates between Core, Secondary, Watch and Pass as evidence changes.'],
  ['Immutable Card Lock System','execution','Freezes qualified final-card snapshots and preserves later withdrawals for audit.'],
  ['Server-Side Results Ledger','audit','Stores official snapshots, grading, ROI, calibration and model version history off-device.'],
  ['Persistent State Adapter','platform','Uses Supabase when configured with an explicit ephemeral fallback for development.'],
  ['Free-Tier Quota Governor','automation','Budgets sportsbook-API credits by day/month and prioritizes high-value verification windows.'],
  ['Failure Monitor / Source Alerts','platform','Surfaces stale, failed or degraded feeds instead of silently claiming readiness.']
];

const SPORTS = [
  {key:'baseball_mlb',title:'MLB'},
  {key:'baseball_kbo',title:'KBO'},
  {key:'baseball_npb',title:'NPB'},
  {key:'americanfootball_nfl_preseason',title:'NFL Preseason'},
  {key:'americanfootball_nfl',title:'NFL'},
  {key:'americanfootball_ncaaf',title:'NCAAF'},
  {key:'basketball_wnba',title:'WNBA'}
];

const ESPN = {
  americanfootball_ncaaf:{sport:'football',league:'college-football',avgPoints:28.0,marginSd:16.0,homeAdv:2.5},
  americanfootball_nfl:{sport:'football',league:'nfl',avgPoints:22.5,marginSd:13.5,homeAdv:1.7},
  americanfootball_nfl_preseason:{sport:'football',league:'nfl',avgPoints:19.5,marginSd:14.5,homeAdv:1.0},
  basketball_wnba:{sport:'basketball',league:'wnba',avgPoints:80.0,marginSd:11.5,homeAdv:2.4},
  baseball_kbo:{sport:'baseball',league:'kbo',avgPoints:5.1,marginSd:3.7,homeAdv:0.25},
  baseball_npb:{sport:'baseball',league:'japanese-baseball',avgPoints:3.5,marginSd:2.7,homeAdv:0.18}
};

const CACHE = new Map();
function now(){ return Date.now(); }
function clamp(x,lo=0,hi=100){ x=Number(x); return Number.isFinite(x)?Math.max(lo,Math.min(hi,x)):lo; }
function clamp01(x){ return Math.max(0,Math.min(1,Number(x)||0)); }
function mean(a){ const v=a.filter(Number.isFinite); return v.length?v.reduce((s,x)=>s+x,0)/v.length:null; }
function median(a){ const v=a.filter(Number.isFinite).sort((x,y)=>x-y); if(!v.length)return null; const m=Math.floor(v.length/2); return v.length%2?v[m]:(v[m-1]+v[m])/2; }
function stdev(a){ const m=mean(a); if(m==null)return null; const v=a.filter(Number.isFinite); if(v.length<2)return 0; return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/(v.length-1)); }
function num(x,fb=null){ const n=Number(x); return Number.isFinite(n)?n:fb; }
function safeDiv(a,b,fb=0){ a=Number(a);b=Number(b);return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?a/b:fb; }
function sigmoid(x){ return 1/(1+Math.exp(-x)); }
function normCdf(x){ const t=1/(1+0.2316419*Math.abs(x)); const d=0.3989423*Math.exp(-x*x/2); let p=d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429)))); p=1-p; return x>=0?p:1-p; }
function poissonDist(lambda,max=22){ lambda=Math.max(.05,Number(lambda)||.05); const a=new Array(max+1).fill(0); a[0]=Math.exp(-lambda); let sum=a[0]; for(let k=1;k<=max;k++){a[k]=a[k-1]*lambda/k;sum+=a[k];} if(sum<1)a[max]+=1-sum; return a; }
function negBinDist(mu,k=6,max=24){mu=Math.max(.05,Number(mu)||.05);k=Math.max(.5,Number(k)||6);const p=k/(k+mu),q=1-p,a=new Array(max+1).fill(0);a[0]=Math.pow(p,k);let sum=a[0];for(let x=1;x<=max;x++){a[x]=a[x-1]*q*(x+k-1)/x;sum+=a[x];}if(sum<1)a[max]+=1-sum;return a;}
function mlbDiscreteMarket(proj,market,selection,point,home,away){ const hl=Number(proj.projected_score?.home),al=Number(proj.projected_score?.away); if(!Number.isFinite(hl)||!Number.isFinite(al))return null; const hd=negBinDist(hl,6.2),ad=negBinDist(al,6.2); let win=0,lose=0,push=0; for(let h=0;h<hd.length;h++)for(let a=0;a<ad.length;a++){const pr=hd[h]*ad[a];let z;if(market==='spreads'){z=(sameTeam(selection,home)?h-a:a-h)+Number(point);}else if(market==='totals'){z=h+a-Number(point); if(String(selection).toLowerCase()==='under')z=-z;}else continue; if(z>1e-9)win+=pr;else if(z<-1e-9)lose+=pr;else push+=pr;} const denom=win+lose; return denom>0?{prob:win/denom,push}:null; }
function mlbDiscreteScores(homeLambda,awayLambda,baseMarket,selection,point,home,away){ const hl=Number(homeLambda),al=Number(awayLambda); if(!Number.isFinite(hl)||!Number.isFinite(al))return null; const hd=poissonDist(hl,14),ad=poissonDist(al,14); let win=0,lose=0,push=0; for(let h=0;h<hd.length;h++)for(let a=0;a<ad.length;a++){const pr=hd[h]*ad[a];let z;if(baseMarket==='h2h')z=sameTeam(selection,home)?h-a:a-h;else if(baseMarket==='spreads')z=(sameTeam(selection,home)?h-a:a-h)+Number(point);else if(baseMarket==='totals'){z=h+a-Number(point);if(String(selection).toLowerCase()==='under')z=-z;}else continue;if(z>1e-9)win+=pr;else if(z<-1e-9)lose+=pr;else push+=pr;} const denom=win+lose; return denom>0?{prob:win/denom,push}:null; }
function evFromAmericanPush(prob,price,push=0){ const base=evFromAmerican(prob,price); return base==null?null:base*(1-clamp01(push)); }
function americanToProb(price){ const p=Number(price); if(!Number.isFinite(p)||p===0)return null; return p<0?(-p)/((-p)+100):100/(p+100); }
function probToAmerican(prob){ prob=Number(prob); if(!Number.isFinite(prob)||prob<=0||prob>=1)return null; return prob>=.5?Math.round(-100*prob/(1-prob)):Math.round(100*(1-prob)/prob); }
function evFromAmerican(prob,price){ prob=Number(prob);price=Number(price); if(!Number.isFinite(prob)||!Number.isFinite(price))return null; const win=price>0?price/100:100/(-price); return prob*win-(1-prob); }
function formatAmerican(p){ p=Number(p); return Number.isFinite(p)?(p>0?`+${Math.round(p)}`:`${Math.round(p)}`):'—'; }
function fmtPct(x){ return Number.isFinite(Number(x))?`${(Number(x)*100).toFixed(1)}%`:'—'; }
function isoDate(d){ const x=new Date(d); return x.toISOString().slice(0,10); }
function ymd(d){ return isoDate(d).replaceAll('-',''); }
function seasonYear(date){ return new Date(date).getUTCFullYear(); }
function addDays(date,days){ const d=new Date(date); d.setUTCDate(d.getUTCDate()+days); return d; }
function hoursUntil(date){ return (new Date(date).getTime()-Date.now())/36e5; }
const TEAM_STOP=new Set(['the','fc','club','university','college','state','city']);
function normalizeTeam(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\b(the|fc|club|university|college)\b/g,' ').replace(/\s+/g,' ').trim(); }
function tokens(s){ return new Set(normalizeTeam(s).split(' ').filter(x=>x.length>1)); }
function coreTokens(s){ return [...tokens(s)].filter(x=>!TEAM_STOP.has(x)); }
function teamSimilarity(a,b){ const A=tokens(a),B=tokens(b); if(!A.size||!B.size)return 0; const na=normalizeTeam(a),nb=normalizeTeam(b); if(na===nb)return 1; const ca=coreTokens(a),cb=coreTokens(b); if(ca.length&&cb.length&&ca.join(' ')===cb.join(' '))return .98; let inter=0; for(const x of A)if(B.has(x))inter++; const j=inter/Math.max(A.size,B.size); const coreInter=ca.filter(x=>cb.includes(x)).length,coreDen=Math.max(ca.length,cb.length,1),cj=coreInter/coreDen; const containment=(na.includes(nb)||nb.includes(na)) && Math.min(ca.length,cb.length)>=2 ? .88 : 0; return Math.max(j*.72+cj*.28,containment); }
function sameTeam(a,b){ const na=normalizeTeam(a),nb=normalizeTeam(b); if(!na||!nb)return false;if(na===nb)return true; const ca=coreTokens(a),cb=coreTokens(b); if(!ca.length||!cb.length)return false; const shared=ca.filter(x=>cb.includes(x)); if(shared.length<Math.min(2,Math.min(ca.length,cb.length)))return false; const uniqueA=ca.filter(x=>!cb.includes(x)),uniqueB=cb.filter(x=>!ca.includes(x)); if(shared.length===1&&(uniqueA.length||uniqueB.length))return false; return teamSimilarity(a,b)>=.72; }
function send(res,status,data,type='application/json'){ res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(type.startsWith('application/json')?JSON.stringify(data):data); }
function readBody(req){ return new Promise((resolve,reject)=>{let s='';req.on('data',d=>{s+=d;if(s.length>5e6)req.destroy();});req.on('end',()=>resolve(s));req.on('error',reject);}); }

async function fetchWithTimeout(url,options={},timeout=9000){ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); try{return await fetch(url,{...options,signal:c.signal,headers:{'User-Agent':'SB101-AEGIS/8.0.0','Accept':'application/json,text/plain,*/*',...(options.headers||{})}});}finally{clearTimeout(t);} }
async function cachedJson(url,ttl=300000,options={}){ const k=`json|${url}|${JSON.stringify(options.headers||{})}`; const hit=CACHE.get(k); if(hit&&hit.exp>now())return hit.data; const r=await fetchWithTimeout(url,options); if(!r.ok)throw new Error(`Data source ${r.status}: ${url}`); const d=await r.json(); CACHE.set(k,{exp:now()+ttl,data:d}); return d; }
async function cachedText(url,ttl=3600000,options={}){ const k=`text|${url}`; const hit=CACHE.get(k); if(hit&&hit.exp>now())return hit.data; const r=await fetchWithTimeout(url,options,12000); if(!r.ok)throw new Error(`Data source ${r.status}: ${url}`); const d=await r.text(); CACHE.set(k,{exp:now()+ttl,data:d}); return d; }

function recordMarketHistory(events){ const at=new Date().toISOString(); for(const e of events||[])for(const b of e.bookmakers||[])for(const m of b.markets||[])for(const o of m.outcomes||[]){const k=[e.id,b.key,m.key,normalizeTeam(o.description||o.name),o.point==null?'':o.point].join('|');const arr=MARKET_HISTORY.get(k)||[];const last=arr[arr.length-1];if(!last||last.price!==o.price)arr.push({at,price:o.price,point:o.point});MARKET_HISTORY.set(k,arr.slice(-20));} }
function marketHistoryFor(eventId,bookKey,market,outcome,point){const k=[eventId,bookKey,market,normalizeTeam(outcome),point==null?'':point].join('|');return MARKET_HISTORY.get(k)||[];}
async function oddsFetch(endpoint,{ttl=ODDS_CACHE_TTL_MS,force=false}={}){
  if(!ODDS_KEY)throw new Error('ODDS_API_KEY is not configured.');
  const hit=ODDS_RESPONSE_CACHE.get(endpoint),age=hit?Date.now()-hit.at:Infinity; if(hit&&((!force&&hit.exp>Date.now())||(force&&age<MIN_ODDS_REFRESH_MS)))return {data:hit.data,meta:{...hit.meta,cached:true,cache_age_ms:age,refresh_floor_ms:MIN_ODDS_REFRESH_MS}};
  const join=endpoint.includes('?')?'&':'?';
  const url=`https://api.the-odds-api.com/v4/${endpoint}${join}apiKey=${encodeURIComponent(ODDS_KEY)}`;
  const r=await fetchWithTimeout(url,{},10000); const text=await r.text(); let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!r.ok)throw new Error(data.message||data.error||`Odds API ${r.status}`);
  const meta={remaining:r.headers.get('x-requests-remaining'),used:r.headers.get('x-requests-used'),last:r.headers.get('x-requests-last'),cached:false,fetched_at:new Date().toISOString()}; LAST_ODDS_META=meta; if(Array.isArray(data))recordMarketHistory(data); else if(data?.bookmakers)recordMarketHistory([data]); ODDS_RESPONSE_CACHE.set(endpoint,{exp:Date.now()+ttl,at:Date.now(),data,meta}); return {data,meta};
}
async function oddsQuotaProbe({force=false}={}){
  if(!ODDS_KEY)return {...LAST_ODDS_META,ready:false};
  if(!force&&Date.now()-LAST_QUOTA_PROBE_AT<15*60*1000)return {...LAST_ODDS_META,ready:true,cached:true};
  const url=`https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(ODDS_KEY)}`;
  const r=await fetchWithTimeout(url,{},10000);if(!r.ok)throw new Error(`Odds API quota probe ${r.status}`);
  await r.arrayBuffer();
  const meta={remaining:r.headers.get('x-requests-remaining'),used:r.headers.get('x-requests-used'),last:r.headers.get('x-requests-last'),cached:false,fetched_at:new Date().toISOString(),probe:true,ready:true};
  LAST_ODDS_META={...LAST_ODDS_META,...meta};LAST_QUOTA_PROBE_AT=Date.now();return meta;
}
function isHardRock(book){ return String(book?.key||'').startsWith('hardrockbet'); }
function sanitizeEvent(e){ return {id:e.id,sport_key:e.sport_key,sport_title:e.sport_title,commence_time:e.commence_time,home_team:e.home_team,away_team:e.away_team,bookmakers:e.bookmakers||[]}; }
function pregameOnly(events){ const t=Date.now()+60*1000; return (events||[]).filter(e=>new Date(e.commence_time).getTime()>t); }
function marketBase(key){ const k=String(key||''); if(k.startsWith('h2h'))return 'h2h'; if(k.startsWith('spreads'))return 'spreads'; if(k.startsWith('totals'))return 'totals'; return k; }
function mlbPeriodInnings(key){ const m=String(key||'').match(/_1st_(1|3|5|7)_innings$/); return m?Number(m[1]):null; }
function isF5Market(key){ return mlbPeriodInnings(key)===5; }
function isMlbPeriodMarket(key){ return mlbPeriodInnings(key)!=null; }
function marketLabel(key){ const inn=mlbPeriodInnings(key),base=marketBase(key); if(inn)return `${inn===1?'1st inning':`F${inn}`} ${base==='h2h'?'ML':base==='spreads'?'Spread':'Total'}`; return base==='h2h'?'ML':base==='spreads'?'Spread':base==='totals'?'Total':key; }
function mergeEventMarkets(base,extra){
  const out=sanitizeEvent(base), map=new Map((out.bookmakers||[]).map(b=>[b.key,{...b,markets:[...(b.markets||[])]}]));
  for(const b of extra?.bookmakers||[]){ const cur=map.get(b.key)||{...b,markets:[]}; const mk=new Map((cur.markets||[]).map(m=>[m.key,m])); for(const m of b.markets||[])mk.set(m.key,m); cur.markets=[...mk.values()]; cur.last_update=b.last_update||cur.last_update; map.set(b.key,cur); }
  out.bookmakers=[...map.values()]; return out;
}
async function deepEventOdds(event,markets){
  const key=`${event.sport_key}|${event.id}|${markets}`; const hit=DEEP_ODDS_CACHE.get(key); if(hit&&hit.exp>Date.now())return hit.data;
  const endpoint=`sports/${encodeURIComponent(event.sport_key)}/events/${encodeURIComponent(event.id)}/odds?bookmakers=${encodeURIComponent(ODDS_BOOKMAKERS)}&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`;
  const r=await oddsFetch(endpoint); DEEP_ODDS_CACHE.set(key,{exp:Date.now()+8*60*1000,data:r.data}); return r.data;
}
async function refreshEventMarkets(event,markets){
  const list=Array.isArray(markets)?markets.filter(Boolean):String(markets||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!list.length)return sanitizeEvent(event);
  const extra=await deepEventOdds(event,list.join(','));
  return mergeEventMarkets(event,extra);
}
function mlbDeepPriority(proj){
  const f=proj?.f5||{}, margin=Math.abs(Number(f.projected_margin_home)||0), totalMove=Math.abs((Number(f.projected_total)||4.5)-4.5); const sp=(proj?.modules||[]).find(m=>/Starting pitcher quality/i.test(m.name));
  return margin*2.4+totalMove*.7+Math.abs(Number(sp?.value)||0)*1.8+(Number(proj?.data_quality)||0)/100+(Number(proj?.coverage_score)||0)/160;
}
function deepGameCount(){ const r=Number(LAST_ODDS_META?.remaining); if(!Number.isFinite(r))return Math.min(2,MAX_DEEP_MARKET_GAMES); if(r<=ODDS_QUOTA_RESERVE)return 0; if(r<80)return 1; if(r<160)return Math.min(2,MAX_DEEP_MARKET_GAMES); if(r<280)return Math.min(3,MAX_DEEP_MARKET_GAMES); return MAX_DEEP_MARKET_GAMES; }

function quotePairs(event,marketKey){
  const pairs=[];
  for(const b of event.bookmakers||[]){
    for(const m of b.markets||[]){ if(m.key!==marketKey)continue; const outcomes=m.outcomes||[]; if(outcomes.length<2)continue; pairs.push({book:b.title,book_key:b.key,hard_rock:isHardRock(b),market_key:m.key,last_update:m.last_update||b.last_update||null,outcomes}); }
  }
  return pairs;
}
function fairTwoWay(a,b){ const pa=americanToProb(a),pb=americanToProb(b); if(pa==null||pb==null)return [null,null]; const s=pa+pb; return [pa/s,pb/s]; }
function marketConsensus(event,market,sideName,oppName,point){ const probs=[]; for(const p of quotePairs(event,market)){ const so=getPairOutcome(p,sideName),oo=getPairOutcome(p,oppName); if(!so||!oo)continue; const base=marketBase(market); if(base!=='h2h'){ if(so.point==null||point==null||Math.abs(Number(so.point)-Number(point))>.001)continue; if(base==='totals'&&oo.point!=null&&Math.abs(Number(oo.point)-Number(point))>.001)continue; } const [sp]=fairTwoWay(so.price,oo.price); if(sp!=null)probs.push(sp); } return {prob:median(probs),books:probs.length,dispersion:stdev(probs)||0}; }
function bestPrice(a,b){ if(a==null)return b;if(b==null)return a; return Number(a)>Number(b)?a:b; }

async function espnBoard(cfg,date){ const url=`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard?dates=${ymd(date)}&limit=1000`; return cachedJson(url,120000); }
function espnEventMatch(board,event){ let best=null,score=0; for(const x of board.events||[]){ const c=x.competitions?.[0]; if(!c)continue; const comps=c.competitors||[]; const h=comps.find(z=>z.homeAway==='home'),a=comps.find(z=>z.homeAway==='away'); if(!h||!a)continue; const s=(teamSimilarity(h.team?.displayName,event.home_team)+teamSimilarity(a.team?.displayName,event.away_team))/2; if(s>score){score=s;best=x;} } return score>=.48?best:null; }
function extractEspnTeam(eventObj,side){ const c=eventObj?.competitions?.[0]; const x=(c?.competitors||[]).find(z=>z.homeAway===side); if(!x)return null; return {id:String(x.team?.id||''),name:x.team?.displayName||'',location:x.team?.location||x.team?.shortDisplayName||'',abbr:x.team?.abbreviation||'',score:num(x.score),records:(x.records||[]).map(r=>({name:r.name,summary:r.summary,type:r.type})),winner:!!x.winner}; }
function espnVenue(eventObj){ const c=eventObj?.competitions?.[0],v=c?.venue||{}; return {name:v.fullName||null,city:v.address?.city||null,state:v.address?.state||null,indoor:!!v.indoor}; }
async function espnTeamSchedule(cfg,teamId,year){ if(!teamId)return null; const url=`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/teams/${encodeURIComponent(teamId)}/schedule?season=${year}`; try{return await cachedJson(url,15*60*1000);}catch{return null;} }
function scheduleMetrics(data,teamId,before){ const rows=[]; for(const e of data?.events||[]){ const c=e.competitions?.[0]; if(!c)continue; if(new Date(e.date||c.date).getTime()>=new Date(before).getTime())continue; const st=c.status?.type||{}; if(!(st.completed||st.name==='STATUS_FINAL'))continue; const me=(c.competitors||[]).find(x=>String(x.team?.id)===String(teamId)); if(!me)continue; const opp=(c.competitors||[]).find(x=>String(x.team?.id)!==String(teamId)); const pf=num(me.score),pa=num(opp?.score); if(pf==null||pa==null)continue; rows.push({date:e.date||c.date,pf,pa,margin:pf-pa,home:me.homeAway==='home',win:pf>pa}); }
  rows.sort((a,b)=>new Date(a.date)-new Date(b.date)); const recent=rows.slice(-5); return {games:rows.length,wins:rows.filter(x=>x.win).length,pf:mean(rows.map(x=>x.pf)),pa:mean(rows.map(x=>x.pa)),margin:mean(rows.map(x=>x.margin)),recentMargin:mean(recent.map(x=>x.margin)),recentPF:mean(recent.map(x=>x.pf)),recentPA:mean(recent.map(x=>x.pa)),volatility:stdev(rows.map(x=>x.margin)),rows}; }
async function espnSummary(cfg,id){ if(!id)return null; const url=`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/summary?event=${encodeURIComponent(id)}`; try{return await cachedJson(url,120000);}catch{return null;} }
async function espnNews(cfg){ const url=`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/news?limit=100`; try{return await cachedJson(url,5*60*1000);}catch{return {articles:[]};} }
function teamNews(team,news){ const name=normalizeTeam(team),tt=[...tokens(team)].filter(x=>x.length>=4); const critical=/injur|ruled out|out for|questionable|doubtful|surgery|suspend|scratch|will not play|won't play|limited|minutes restriction|pitch count|starter|rotation|qb2|qb3|joint practice|rested|illness/i; const rows=[]; for(const a of news?.articles||[]){ const text=[a.headline,a.description,a.story].filter(Boolean).join(' '); const low=normalizeTeam(text); if((name&&low.includes(name))||tt.some(t=>low.includes(t))){ rows.push({headline:a.headline||'News',description:a.description||'',critical:critical.test(text),url:(a.links?.web?.href||a.links?.api?.href||'')}); } } return rows.slice(0,8); }
function summaryRisk(summary,team){ const raw=JSON.stringify(summary||{}); const low=normalizeTeam(raw); const toks=[...tokens(team)].filter(x=>x.length>=4); const mentions=toks.filter(t=>low.includes(t)).length; const injuryHits=(raw.match(/injur|questionable|doubtful|out for|inactive|suspend/gi)||[]).length; return {mentions,injuryHits}; }

async function cfbdAll(year){
  if(!CFBD_KEY)return null;
  const headers={Authorization:`Bearer ${CFBD_KEY}`};
  const fetchOne=async(path)=>{try{return await cachedJson(`https://api.collegefootballdata.com${path}`,6*3600*1000,{headers});}catch{return [];}};
  const py=year-1;
  const [sp,core,elo,priorSp,priorCore,priorElo,records,games]=await Promise.all([
    fetchOne(`/ratings/sp?year=${year}`),fetchOne(`/ratings/core?year=${year}`),fetchOne(`/ratings/elo?year=${year}`),
    fetchOne(`/ratings/sp?year=${py}`),fetchOne(`/ratings/core?year=${py}`),fetchOne(`/ratings/elo?year=${py}`),
    // /records exposes explicit team classification. /games additionally exposes the
    // exact homeClassification/awayClassification for each scheduled matchup, which
    // is the safest source for FBS/FCS crossover detection.
    fetchOne(`/records?year=${year}`),fetchOne(`/games?year=${year}`)
  ]);
  return {sp,core,elo,priorSp,priorCore,priorElo,records,games,year,priorYear:py};
}
const CFBD_NAME_ALIASES=new Map([
  ['ole miss','mississippi'],['mississippi rebels','mississippi'],
  ['nc state','nc state'],['north carolina state','nc state'],
  ['miami fl','miami'],['miami florida','miami'],
  ['utsa','utsa'],['texas san antonio','utsa'],
  ['utep','utep'],['texas el paso','utep']
]);
function cfbdNameCandidates(team){
  const raw=normalizeTeam(team); if(!raw)return [];
  const out=new Set([raw]); const w=raw.split(' ').filter(Boolean);
  // Sportsbook display names frequently append one- or two-word mascots.
  // Exact-only mascot stripping is safe: North Carolina A&T Aggies -> North Carolina A T,
  // never the generic North Carolina row; West Georgia Wolves -> West Georgia.
  if(w.length>=2)out.add(w.slice(0,-1).join(' '));
  if(w.length>=3)out.add(w.slice(0,-2).join(' '));
  for(const x of [...out]){const a=CFBD_NAME_ALIASES.get(x);if(a)out.add(a);}
  return [...out].filter(Boolean);
}
function ratingTeamSimilarity(a,b){
  const na=normalizeTeam(a),nb=normalizeTeam(b),A=[...tokens(a)],B=[...tokens(b)];
  if(!na||!nb||!A.length||!B.length)return 0;
  if(na===nb)return 1;
  // Prefix/containment is deliberately NOT rewarded here. That was the source of
  // North Carolina -> North Carolina A&T and Georgia -> West Georgia contamination.
  let inter=0; for(const x of A)if(B.includes(x))inter++;
  return inter/Math.max(A.length,B.length);
}
function findRatingMatch(rows,team){
  const candidates=cfbdNameCandidates(team);
  if(!candidates.length)return {row:null,score:0,ambiguous:false,matched:null};
  // First preference: exact canonical school-name match, including safe mascot stripping.
  for(const c of candidates){
    const exact=(rows||[]).filter(r=>normalizeTeam(r.team)===c);
    if(exact.length===1)return {row:exact[0],score:1,ambiguous:false,matched:exact[0].team};
    if(exact.length>1)return {row:null,score:1,ambiguous:true,matched:exact[0]?.team||null};
  }
  // Fallback is intentionally conservative. Generic containment is rejected even when
  // token overlap is high; an unmatched team is safer than borrowing another school's rating.
  let best=null,bestScore=0,second=0;
  for(const r of rows||[]){
    let q=0;
    for(const c of candidates){
      const nr=normalizeTeam(r.team);
      const strictContain=(c.startsWith(nr+' ')||nr.startsWith(c+' '));
      if(strictContain)continue;
      q=Math.max(q,ratingTeamSimilarity(r.team,c));
    }
    if(q>bestScore+1e-9){second=bestScore;bestScore=q;best=r;}
    else if(q>second)second=q;
  }
  if(bestScore<.93)return {row:null,score:bestScore,ambiguous:false,matched:best?.team||null};
  const ambiguous=(bestScore-second)<.06;
  return {row:ambiguous?null:best,score:bestScore,ambiguous,matched:best?.team||null};
}
function findRating(rows,team){ return findRatingMatch(rows,team).row; }
const FBS_CONFS=new Set(['acc','american athletic','big 12','big ten','conference usa','c usa','mid american','mountain west','pac 12','sec','sun belt','fbs independents','independent']);
function conferenceClass(conf){ const c=normalizeTeam(conf); if(!c)return 'unknown'; for(const x of FBS_CONFS)if(c===x||c.includes(x))return 'fbs'; return 'non-fbs'; }
function normalizeClassification(v){ const c=normalizeTeam(v); if(c==='fbs')return 'fbs'; if(c==='fcs')return 'fcs'; if(c==='ii'||c==='iii'||c==='ii iii')return 'lower'; return 'unknown'; }
function classificationMatch(records,team){
  const m=findRatingMatch(records||[],team);
  const cls=normalizeClassification(m.row?.classification);
  return {row:m.row||null,matched:m.matched||null,score:m.score||0,ambiguous:!!m.ambiguous,class:cls};
}
function cfbdGameMatch(rows,event){
  const hc=new Set(cfbdNameCandidates(event.home_team)),ac=new Set(cfbdNameCandidates(event.away_team));
  const exact=(rows||[]).filter(g=>hc.has(normalizeTeam(g.homeTeam))&&ac.has(normalizeTeam(g.awayTeam)));
  if(exact.length===1)return exact[0];
  if(exact.length>1){const target=new Date(event.commence_time).getTime();return exact.sort((a,b)=>Math.abs(new Date(a.startDate).getTime()-target)-Math.abs(new Date(b.startDate).getTime()-target))[0];}
  let best=null,bestScore=0,second=0;
  for(const g of rows||[]){
    const hs=Math.max(...[...hc].map(x=>ratingTeamSimilarity(g.homeTeam,x)),0),as=Math.max(...[...ac].map(x=>ratingTeamSimilarity(g.awayTeam,x)),0);
    const q=Math.min(hs,as);
    if(q>bestScore){second=bestScore;bestScore=q;best=g;}else if(q>second)second=q;
  }
  return bestScore>=.96&&(bestScore-second)>=.04?best:null;
}
function resolvedNcaafClass(recordMatch,ratingRow){
  if(recordMatch?.class&&recordMatch.class!=='unknown')return recordMatch.class;
  // Conference inference is only a fallback if the explicit CFBD record classification is unavailable.
  return conferenceClass(ratingRow?.conference);
}
function ncaafCurrentWeight(games){ const g=Math.max(0,Number(games)||0); if(g<=1)return .18;if(g===2)return .28;if(g===3)return .42;if(g===4)return .56;if(g===5)return .68;if(g===6)return .78;return .86; }
function ncaafScheduleWeight(games){ const g=Math.max(0,Number(games)||0); if(g<=0)return 0;if(g===1)return .06;if(g===2)return .12;if(g===3)return .20;if(g===4)return .28;if(g===5)return .36;if(g===6)return .42;return .46; }
function ncaafCrossClassBaseline(homeClass,awayClass){
  // Neutral-field structural prior only. Home field is added separately.
  // It deliberately does not subtract raw FBS and FCS SP+/CORE/Elo values.
  if(homeClass==='fbs'&&['fcs','lower','non-fbs'].includes(awayClass))return 21;
  if(awayClass==='fbs'&&['fcs','lower','non-fbs'].includes(homeClass))return -21;
  return 0;
}
function blendPriorCurrent(current,prior,currentWeight){
  const c=num(current),p=num(prior); if(c==null&&p==null)return null; if(c==null)return p;
  // If a valid prior is unavailable (new/reclassified team), do not invent one and do
  // not give a tiny current-season sample a 30% minimum weight. Shrink it toward neutral
  // using the same current-season ramp.
  if(p==null)return c*clamp01(currentWeight);
  return currentWeight*c+(1-currentWeight)*p;
}

function parseCsvLine(line){ const out=[]; let cur='',q=false; for(let i=0;i<line.length;i++){const ch=line[i]; if(ch==='"'){ if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;} else if(ch===','&&!q){out.push(cur);cur='';} else cur+=ch;} out.push(cur); return out; }
async function nflverseGames(){ try{ const text=await cachedText('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',6*3600*1000); const lines=text.trim().split(/\r?\n/); const h=parseCsvLine(lines[0]); return lines.slice(1).map(l=>{const a=parseCsvLine(l),o={};h.forEach((k,i)=>o[k]=a[i]);return o;}); }catch{return [];} }
function nflverseMetrics(games,team,before,preseason=false){ const aliases={
  'arizona cardinals':'ARI','atlanta falcons':'ATL','baltimore ravens':'BAL','buffalo bills':'BUF','carolina panthers':'CAR','chicago bears':'CHI','cincinnati bengals':'CIN','cleveland browns':'CLE','dallas cowboys':'DAL','denver broncos':'DEN','detroit lions':'DET','green bay packers':'GB','houston texans':'HOU','indianapolis colts':'IND','jacksonville jaguars':'JAX','kansas city chiefs':'KC','las vegas raiders':'LV','los angeles chargers':'LAC','los angeles rams':'LA','miami dolphins':'MIA','minnesota vikings':'MIN','new england patriots':'NE','new orleans saints':'NO','new york giants':'NYG','new york jets':'NYJ','philadelphia eagles':'PHI','pittsburgh steelers':'PIT','san francisco 49ers':'SF','seattle seahawks':'SEA','tampa bay buccaneers':'TB','tennessee titans':'TEN','washington commanders':'WAS'};
  const code=aliases[normalizeTeam(team)]; if(!code)return null; const rows=[]; for(const g of games){ if(new Date(g.gameday||g.game_date||0).getTime()>=new Date(before).getTime())continue; const gt=String(g.game_type||'').toUpperCase(); if(preseason){ if(!['PRE','PS','PRESEASON'].includes(gt))continue; } else { if(gt&&gt!=='REG'&&gt!=='WC'&&gt!=='DIV'&&gt!=='CON'&&gt!=='SB')continue; }
    const h=g.home_team,a=g.away_team; if(h!==code&&a!==code)continue; const hs=num(g.home_score),as=num(g.away_score); if(hs==null||as==null)continue; const pf=h===code?hs:as,pa=h===code?as:hs; rows.push({date:g.gameday,pf,pa,margin:pf-pa,win:pf>pa}); }
  rows.sort((a,b)=>new Date(a.date)-new Date(b.date)); const recent=rows.slice(-5); return {games:rows.length,wins:rows.filter(x=>x.win).length,pf:mean(rows.map(x=>x.pf)),pa:mean(rows.map(x=>x.pa)),margin:mean(rows.map(x=>x.margin)),recentMargin:mean(recent.map(x=>x.margin)),volatility:stdev(rows.map(x=>x.margin)),rows}; }

async function openMeteoGeo(city,state){ if(!city)return null; const q=encodeURIComponent(`${city}${state?`, ${state}`:''}`); try{const d=await cachedJson(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`,24*3600*1000); const r=d.results?.[0]; return r?{lat:r.latitude,lon:r.longitude,name:r.name}:null;}catch{return null;} }
async function openMeteo(lat,lon,time){ if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(hoursUntil(time))>24*7)return null; const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m,wind_direction_10m&timezone=UTC&forecast_days=7`; try{const d=await cachedJson(url,30*60*1000); const times=d.hourly?.time||[]; if(!times.length)return null; const target=new Date(time).getTime(); let idx=0,best=Infinity; times.forEach((t,i)=>{const z=Math.abs(new Date(t+'Z').getTime()-target);if(z<best){best=z;idx=i;}}); return {temperature_c:num(d.hourly.temperature_2m?.[idx]),precip_probability:num(d.hourly.precipitation_probability?.[idx]),wind_kph:num(d.hourly.wind_speed_10m?.[idx]),gust_kph:num(d.hourly.wind_gusts_10m?.[idx]),wind_direction_deg:num(d.hourly.wind_direction_10m?.[idx])}; }catch{return null;} }

async function mlbSchedule(date){ const u=`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${isoDate(date)}&hydrate=probablePitcher,team,venue`; return cachedJson(u,120000); }
function mlbGameMatch(data,event){ let best=null,s=0; for(const day of data.dates||[])for(const g of day.games||[]){ const q=(teamSimilarity(g.teams?.home?.team?.name,event.home_team)+teamSimilarity(g.teams?.away?.team?.name,event.away_team))/2; if(q>s){s=q;best=g;} } return s>=.72?best:null; }
async function mlbTeamStats(id,group,year){ if(!id)return null; try{return await cachedJson(`https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=season&group=${group}&season=${year}`,30*60*1000);}catch{return null;} }
async function mlbPersonStats(id,year){ if(!id)return null; try{return await cachedJson(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=${year}`,30*60*1000);}catch{return null;} }
function statRoot(d){ return d?.stats?.[0]?.splits?.[0]?.stat||{}; }
function baseballInnings(s){ if(s==null)return null; const [a,b='0']=String(s).split('.'); const outs=b==='1'?1:b==='2'?2:0; return num(a,0)+outs/3; }
async function mlbRecentAll(eventTime){ const end=isoDate(addDays(eventTime,-1)),start=isoDate(addDays(eventTime,-16)); try{return await cachedJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}&hydrate=linescore`,10*60*1000);}catch{return null;} }
function mlbRecentMetrics(data,teamId){ const rows=[]; for(const d of data?.dates||[])for(const g of d.games||[]){ if(g.status?.abstractGameState!=='Final')continue; const home=g.teams?.home,away=g.teams?.away; const side=String(home?.team?.id)===String(teamId)?home:String(away?.team?.id)===String(teamId)?away:null; const opp=side===home?away:home; if(!side||side.score==null||opp?.score==null)continue; rows.push({date:g.gameDate,pf:num(side.score),pa:num(opp.score),margin:num(side.score)-num(opp.score),win:num(side.score)>num(opp.score)}); } rows.sort((a,b)=>new Date(a.date)-new Date(b.date)); const recent=rows.slice(-10); return {games:recent.length,wins:recent.filter(x=>x.win).length,pf:mean(recent.map(x=>x.pf)),pa:mean(recent.map(x=>x.pa)),margin:mean(recent.map(x=>x.margin)),volatility:stdev(recent.map(x=>x.margin)),rows:recent}; }
function lineupOps(side,order){const vals=[];for(const id of order||[]){const pl=side?.players?.[`ID${id}`],b=pl?.seasonStats?.batting||{};let ops=num(b.ops);if(ops==null){const obp=num(b.obp),slg=num(b.slg);if(obp!=null&&slg!=null)ops=obp+slg;}if(ops!=null)vals.push(ops);}return vals.length>=5?mean(vals):null;}
async function mlbLineups(gamePk){ if(!gamePk)return {confirmed:false}; try{const d=await cachedJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,60000); const hs=d.liveData?.boxscore?.teams?.home||{},as=d.liveData?.boxscore?.teams?.away||{},h=hs.battingOrder||[],a=as.battingOrder||[]; return {confirmed:h.length>=9&&a.length>=9,homeCount:h.length,awayCount:a.length,homeOrder:h,awayOrder:a,homeOps:lineupOps(hs,h),awayOps:lineupOps(as,a)};}catch{return {confirmed:false};} }
async function mlbPitcherGameLog(id,year){ if(!id)return null; try{return await cachedJson(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=pitching&season=${year}`,10*60*1000);}catch{return null;} }
function pitcherRecentWorkload(d){ const splits=d?.stats?.[0]?.splits||[]; const rows=[]; for(const x of splits){ const st=x.stat||{}; const gs=num(st.gamesStarted,0); const ip=baseballInnings(st.inningsPitched); const pitches=num(st.numberOfPitches); if((gs>0||ip>=2.2)&&ip!=null)rows.push({date:x.date||x.game?.gameDate||'',ip,pitches}); } rows.sort((a,b)=>new Date(a.date)-new Date(b.date)); const r=rows.slice(-5); return {starts:r.length,avgIP:mean(r.map(x=>x.ip)),avgPitches:mean(r.map(x=>x.pitches)),lastPitches:r.length?r[r.length-1].pitches:null,rows:r}; }
async function mlbTeamRecentGames(teamId,eventTime,days=4){ const end=isoDate(addDays(eventTime,-1)),start=isoDate(addDays(eventTime,-days)); try{const d=await cachedJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${end}`,5*60*1000); const rows=[]; for(const day of d.dates||[])for(const g of day.games||[]){if(g.status?.abstractGameState==='Final')rows.push({gamePk:g.gamePk,date:g.gameDate,homeId:g.teams?.home?.team?.id,awayId:g.teams?.away?.team?.id});} rows.sort((a,b)=>new Date(b.date)-new Date(a.date)); return rows.slice(0,3);}catch{return [];} }
async function mlbBoxscore(gamePk){ if(!gamePk)return null; try{return await cachedJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`,15*60*1000);}catch{return null;} }
async function mlbBullpenUsage(teamId,eventTime){ const games=await mlbTeamRecentGames(teamId,eventTime,4); if(!games.length)return {verified:false,availability:55,heavyCount:0,relievers:[],games:0}; const boxes=await Promise.all(games.map(g=>mlbBoxscore(g.gamePk))); const agg=new Map(); let observed=0; for(let i=0;i<games.length;i++){ const b=boxes[i]; if(!b)continue; const g=games[i],home=String(g.homeId)===String(teamId),side=home?b.teams?.home:b.teams?.away; const ids=side?.pitchers||[]; if(ids.length<2)continue; observed++; const relievers=ids.slice(1); const ageH=Math.max(0,(new Date(eventTime)-new Date(g.date))/36e5); const bucket=ageH<=36?1:ageH<=60?2:3; for(let ri=0;ri<relievers.length;ri++){ const id=relievers[ri],pl=side.players?.[`ID${id}`]||{}; const st=pl.stats?.pitching||{}; const pitches=num(st.numberOfPitches,0),ip=baseballInnings(st.inningsPitched)||0,leverage=relievers.length>1?0.75+0.55*(ri/(relievers.length-1)):1; const cur=agg.get(id)||{id,name:pl.person?.fullName||`Pitcher ${id}`,p1:0,p2:0,p3:0,appearances:0,innings:0,leverageLoad:0}; cur.appearances++;cur.innings+=ip;cur.leverageLoad+=pitches*leverage; if(bucket<=1)cur.p1+=pitches*leverage;if(bucket<=2)cur.p2+=pitches*leverage;cur.p3+=pitches*leverage;agg.set(id,cur); } }
  const relievers=[...agg.values()].sort((a,b)=>b.p2-a.p2); let penalty=0,heavy=0; for(const r of relievers){ let rp=0; if(r.p1>=35)rp+=18;else if(r.p1>=25)rp+=12;else if(r.p1>=18)rp+=6; if(r.p2>=50)rp+=10;else if(r.p2>=38)rp+=6; if(r.appearances>=2&&r.p2>=28)rp+=5; if(rp>=10)heavy++; penalty+=Math.min(20,rp); } penalty=Math.min(42,penalty); const availability=clamp(92-penalty,45,96); return {verified:observed>0,availability,heavyCount:heavy,relievers:relievers.slice(0,6),games:observed,totalPitches:relievers.reduce((s,r)=>s+r.p3,0)}; }
function pitcherAdvanced(st,staffEra=4.35){const era=num(st.era,staffEra),ip=Math.max(.1,baseballInnings(st.inningsPitched)||.1),k=num(st.strikeOuts,num(st.strikeouts,0)),bb=num(st.baseOnBalls,num(st.walks,0)),hbp=num(st.hitBatsmen,0),hr=num(st.homeRuns,0),bf=num(st.battersFaced,0),go=num(st.groundOuts,0),ao=num(st.airOuts,0);const kbbPct=bf>0?(k-bb)/bf:null;const fip=3.15+(13*hr+3*(bb+hbp)-2*k)/ip;const gbRatio=ao>0?go/ao:null;return {era,fip:Number.isFinite(fip)?fip:era,kbbPct,gbRatio};}
function starterRegression(st,staffEra=4.35){
  const raw=pitcherAdvanced(st,staffEra),
    ip=Math.max(0,baseballInnings(st.inningsPitched)||0);

  const priorEra=clamp(
    .70*4.35+.30*num(staffEra,4.35),
    3.65,
    5.05
  );

  const priorWhip=clamp(
    1.30*(.85+.15*priorEra/4.35),
    1.16,
    1.46
  );

  const rawWhip=num(st.whip,priorWhip),
    rawK9=num(st.strikeoutsPer9Inn,num(st.strikeoutsPer9,8.5)),
    rawBB9=num(st.walksPer9Inn,num(st.walksPer9,3.0)),
    rawHR9=num(st.homeRunsPer9,1.15);

  const shrink=(obs,prior,stab)=>{
    obs=num(obs,prior);
    const w=ip/(ip+stab);
    return prior+w*(obs-prior);
  };

  return {
    ip,
    priorEra,
    rawEra:raw.era,
    rawFip:raw.fip,
    rawWhip,
    rawK9,
    rawBB9,
    rawHR9,
    era:shrink(raw.era,priorEra,55),
    fip:shrink(raw.fip,priorEra,45),
    whip:shrink(rawWhip,priorWhip,35),
    k9:shrink(rawK9,8.5,25),
    bb9:shrink(rawBB9,3.0,25),
    hr9:shrink(rawHR9,1.15,60),
    sampleWeight:ip/(ip+45),
    sampleConfidence:clamp(
      45+50*(1-Math.exp(-ip/70)),
      45,
      95
    ),
    active:ip<45,
    severe:ip<10
  };
}

function starterSkill(st,staffEra=4.35){
  const r=starterRegression(st,staffEra),
    eraF=safeDiv(r.era,4.35,1),
    fipF=safeDiv(r.fip,4.35,1),
    whipF=safeDiv(r.whip,1.30,1),
    cmdF=clamp(
      safeDiv(
        safeDiv(r.bb9,Math.max(4,r.k9),.35),
        .35,
        1
      ),
      .72,
      1.30
    ),
    hrF=safeDiv(r.hr9,1.15,1);

  return clamp(
    .26*eraF+
    .25*fipF+
    .18*whipF+
    .19*cmdF+
    .12*hrF,
    .60,
    1.58
  );
}

function starterExpectedIP(st,recent){ const seasonIP=baseballInnings(st.inningsPitched),gs=num(st.gamesStarted,0),seasonAvg=gs>0?safeDiv(seasonIP,gs,5.3):5.1,rec=num(recent?.avgIP,seasonAvg); return clamp(.62*seasonAvg+.38*rec,4.0,6.7); }
function bullpenRunAdjustment(usage){ if(!usage?.verified)return .08; return clamp((75-usage.availability)/100*.9,-.12,.38); }
function expectedModuleCount(sport){ if(sport==='baseball_mlb')return 9;if(sport==='americanfootball_ncaaf')return 7;if(sport==='americanfootball_nfl_preseason')return 8;if(sport==='basketball_wnba')return 6;if(sport==='americanfootball_nfl')return 6;if(sport==='baseball_kbo'||sport==='baseball_npb')return 5;return 6; }
function coverageScore(mods,sport,criticalPenalty=0){ const expected=expectedModuleCount(sport); const points=(mods||[]).reduce((s,m)=>s+Math.min(90,clamp(m.confidence))/90,0); return clamp(100*points/expected-criticalPenalty,0,100); }
function driverCoverage(mods,expected=4){ const points=(mods||[]).reduce((s,m)=>s+Math.min(90,clamp(m.confidence))/90,0); return clamp(100*points/Math.max(1,expected),0,100); }
function effectiveAgreement(raw,coverage,dq){ return clamp(50+(clamp(raw)-50)*(clamp(coverage)/100)*(clamp(dq)/100),0,100); }
function uncertaintyWidth(proj,market='h2h'){ const dq=clamp(proj.data_quality)/100,cov=clamp(proj.coverage_score??proj.data_quality)/100,base=marketBase(market); let w=.025+(1-dq)*.08+(1-cov)*.07; if(base!=='h2h')w+=.01;if(isMlbPeriodMarket(market))w+=mlbPeriodInnings(market)<=3?.012:.008;if(proj.sport==='americanfootball_nfl_preseason')w+=.02;return Math.max(.03,Math.min(.14,w)); }

function modelModule(name,value,side,evidence,confidence=70){ return {name,value:Number(value)||0,side,evidence,confidence:clamp(confidence)}; }
function agreement(mods){ const usable=mods.filter(m=>Math.abs(m.value)>=0.08); if(!usable.length)return 50; const pos=usable.filter(m=>m.value>0).reduce((s,m)=>s+Math.abs(m.value)*m.confidence/100,0); const neg=usable.filter(m=>m.value<0).reduce((s,m)=>s+Math.abs(m.value)*m.confidence/100,0); const total=pos+neg; return total?clamp(50+50*Math.abs(pos-neg)/total):50; }
function edgeCount(mods,homeLean){ return mods.filter(m=>(homeLean?m.value>0:m.value<0)&&Math.abs(m.value)>=0.15&&m.confidence>=55).length; }
function supportStrength(mods,positiveLean){
  const rows=(mods||[]).filter(m=>(positiveLean?m.value>0:m.value<0)&&Math.abs(m.value)>=0.06&&m.confidence>=45);
  if(!rows.length)return 0;
  const weighted=rows.map(m=>Math.min(1,Math.abs(m.value)/0.35)*(clamp(m.confidence)/100));
  const quality=mean(weighted)||0;
  const breadth=Math.min(1,rows.length/3);
  return clamp(100*quality*(0.55+0.45*breadth),0,100);
}
function weatherSummary(w){ if(!w)return 'Weather unavailable or not applicable.'; return `${w.temperature_c!=null?`${Math.round(w.temperature_c*9/5+32)}°F`:''}${w.wind_kph!=null?`, wind ${Math.round(w.wind_kph/1.609)} mph`:''}${w.precip_probability!=null?`, precip ${Math.round(w.precip_probability)}%`:''}`; }
function weatherTotalAdjustment(sport,w,indoor){ if(!w||indoor)return 0; const mph=(w.wind_kph||0)/1.609; const f=w.temperature_c!=null?w.temperature_c*9/5+32:null; if(sport.startsWith('americanfootball'))return (mph>=20?-3:mph>=15?-1.5:0)+(w.precip_probability>=60?-1.5:0)+(f!=null&&f<=25?-1:0);
  if(sport==='baseball_mlb')return (f!=null?clamp((f-70)*0.02,-.35,.35):0); return 0; }

async function analyzeMLB(event){
  const year=seasonYear(event.commence_time),sched=await mlbSchedule(event.commence_time),g=mlbGameMatch(sched,event); const sources=[{name:'MLB Stats API',url:'https://statsapi.mlb.com/api/v1/schedule'}];
  if(!g)return lowInfoProjection(event,'MLB schedule match unavailable',42,['MLB game identity could not be matched to the public Stats API.']);
  const homeId=g.teams.home.team.id,awayId=g.teams.away.team.id; const hp=g.teams.home.probablePitcher,ap=g.teams.away.probablePitcher;
  const [hh,hpStaff,ah,apStaff,hsp,asp,hlog,alog,recent,lineups,hBull,aBull]=await Promise.all([
    mlbTeamStats(homeId,'hitting',year),mlbTeamStats(homeId,'pitching',year),mlbTeamStats(awayId,'hitting',year),mlbTeamStats(awayId,'pitching',year),
    mlbPersonStats(hp?.id,year),mlbPersonStats(ap?.id,year),mlbPitcherGameLog(hp?.id,year),mlbPitcherGameLog(ap?.id,year),mlbRecentAll(event.commence_time),hoursUntil(event.commence_time)<=12?mlbLineups(g.gamePk):Promise.resolve({confirmed:false}),mlbBullpenUsage(homeId,event.commence_time),mlbBullpenUsage(awayId,event.commence_time)
  ]);
  const H=statRoot(hh),HP=statRoot(hpStaff),A=statRoot(ah),AP=statRoot(apStaff),HSP=statRoot(hsp),ASP=statRoot(asp); const hWork=pitcherRecentWorkload(hlog),aWork=pitcherRecentWorkload(alog);
  const hr=mlbRecentMetrics(recent,homeId),ar=mlbRecentMetrics(recent,awayId);
  let lat=num(g.venue?.location?.defaultCoordinates?.latitude),lon=num(g.venue?.location?.defaultCoordinates?.longitude); if(lat==null||lon==null){ const geo=await openMeteoGeo(g.venue?.location?.city,g.venue?.location?.stateAbbrev); if(geo){lat=geo.lat;lon=geo.lon;} }
  const weather=await openMeteo(lat,lon,event.commence_time); if(weather)sources.push({name:'Open-Meteo',url:'https://open-meteo.com/'});
  const lg=4.35; const hRpg=num(H.runsPerGame,safeDiv(H.runs,H.gamesPlayed,lg)),aRpg=num(A.runsPerGame,safeDiv(A.runs,A.gamesPlayed,lg)); const hEra=num(HP.era,4.35),aEra=num(AP.era,4.35); const hspEra=num(HSP.era,hEra),aspEra=num(ASP.era,aEra);
  const hOps=num(H.ops,.720),aOps=num(A.ops,.720),hLineOps=num(lineups.homeOps,hOps),aLineOps=num(lineups.awayOps,aOps); const hRecentOff=clamp(safeDiv(hr.pf,lg,1),.86,1.14),aRecentOff=clamp(safeDiv(ar.pf,lg,1),.86,1.14); const hLineAdj=lineups.confirmed?clamp(safeDiv(hLineOps,hOps,1),.92,1.08):1,aLineAdj=lineups.confirmed?clamp(safeDiv(aLineOps,aOps,1),.92,1.08):1; const hOff=(.43*safeDiv(hRpg,lg,1)+.35*safeDiv(hOps,.720,1)+.14*hRecentOff+.08*hLineAdj); const aOff=(.43*safeDiv(aRpg,lg,1)+.35*safeDiv(aOps,.720,1)+.14*aRecentOff+.08*aLineAdj);
  const hReg=starterRegression(HSP,hEra),aReg=starterRegression(ASP,aEra),hspSkill=starterSkill(HSP,hEra),aspSkill=starterSkill(ASP,aEra),hExpIP=starterExpectedIP(HSP,hWork),aExpIP=starterExpectedIP(ASP,aWork); const hSpShare=hExpIP/9,aSpShare=aExpIP/9; const homePitch=hSpShare*hspSkill+(1-hSpShare)*safeDiv(hEra,4.35,1); const awayPitch=aSpShare*aspSkill+(1-aSpShare)*safeDiv(aEra,4.35,1);
  const hBullAdj=bullpenRunAdjustment(hBull),aBullAdj=bullpenRunAdjustment(aBull); const wAdj=weatherTotalAdjustment('baseball_mlb',weather,false); let awayRuns=lg*aOff*homePitch+hBullAdj+0.5*wAdj; let homeRuns=lg*hOff*awayPitch+aBullAdj+0.18+0.5*wAdj; awayRuns=clamp(awayRuns,1.7,8.3);homeRuns=clamp(homeRuns,1.7,8.6);
  const margin=homeRuns-awayRuns,total=homeRuns+awayRuns; const homeProb=clamp01(normCdf(margin/2.85));
  const hK9=num(HSP.strikeoutsPer9Inn,num(HSP.strikeoutsPer9,8.5)),aK9=num(ASP.strikeoutsPer9Inn,num(ASP.strikeoutsPer9,8.5)),hBB9=num(HSP.walksPer9Inn,num(HSP.walksPer9,3.0)),aBB9=num(ASP.walksPer9Inn,num(ASP.walksPer9,3.0));
  const mods=[
    modelModule('Starting pitcher quality', (aspSkill-hspSkill)*1.45,aspSkill>hspSkill?'home':'away',`${hp?.fullName||'Home SP'} raw ERA ${hReg.rawEra.toFixed(2)} → reg ${hReg.era.toFixed(2)}, raw FIP ${hReg.rawFip.toFixed(2)} → reg ${hReg.fip.toFixed(2)}, MLB IP ${hReg.ip.toFixed(1)} vs ${ap?.fullName||'Away SP'} raw ERA ${aReg.rawEra.toFixed(2)} → reg ${aReg.era.toFixed(2)}, raw FIP ${aReg.rawFip.toFixed(2)} → reg ${aReg.fip.toFixed(2)}, MLB IP ${aReg.ip.toFixed(1)}. Small MLB samples are shrunk toward team/league priors; command stabilizes faster than ERA/HR outcomes.`,hp&&ap?Math.round(clamp(60+.30*Math.min(hReg.sampleConfidence,aReg.sampleConfidence),60,88)):45),
    modelModule('Starter workload', (hExpIP-aExpIP)/2.5,hExpIP>=aExpIP?'home':'away',`Expected innings: home ${hExpIP.toFixed(1)}, away ${aExpIP.toFixed(1)}; recent avg pitches home ${num(hWork.avgPitches,0).toFixed(0)}, away ${num(aWork.avgPitches,0).toFixed(0)}.`,hp&&ap?78:40),
    modelModule('Offense / run support', (hOff-aOff)*1.55,hOff>aOff?'home':'away',`Season + regressed recent offense: home R/G ${hRpg.toFixed(2)}, OPS ${hOps.toFixed(3)}, recent R/G ${num(hr.pf,hRpg).toFixed(2)}; away R/G ${aRpg.toFixed(2)}, OPS ${aOps.toFixed(3)}, recent R/G ${num(ar.pf,aRpg).toFixed(2)}.`,84),
    modelModule('Bullpen availability',(hBull.availability-aBull.availability)/45,hBull.availability>=aBull.availability?'home':'away',`Verified recent bullpen workload: home availability ${hBull.availability.toFixed(0)}/100 (${hBull.heavyCount} heavy arms), away ${aBull.availability.toFixed(0)}/100 (${aBull.heavyCount} heavy arms).`,hBull.verified&&aBull.verified?82:45),
    modelModule('Staff pitching',(aEra-hEra)/3.1,aEra>hEra?'home':'away',`Home staff ERA ${hEra.toFixed(2)} vs away ${aEra.toFixed(2)}.`,72),
    modelModule('Recent form (capped)',clamp(((hr.margin||0)-(ar.margin||0))/5,-.65,.65),(hr.margin||0)>(ar.margin||0)?'home':'away',`Last ~10 run margin: home ${(hr.margin??0).toFixed(2)}, away ${(ar.margin??0).toFixed(2)}. Weight capped to avoid recency overreaction.`,58),
    modelModule('Home field',.07,'home','Home-field batting/last-at-bat adjustment.',70),
    modelModule('Lineup confirmation',0,'neutral',lineups.confirmed?`Both batting orders posted (${lineups.awayCount}/${lineups.homeCount}); lineup OPS proxy home ${hLineOps.toFixed(3)}, away ${aLineOps.toFixed(3)}.`:`Batting orders not yet fully posted (${lineups.awayCount||0}/${lineups.homeCount||0}).`,lineups.confirmed?92:28)
  ];
  if(weather)mods.push(modelModule('Environment',wAdj/3,wAdj>=0?'over':'under',`${weatherSummary(weather)}. Temperature is used modestly; wind direction is not known, so wind speed alone does not create a run boost.`,65));
  const totalDrivers=[
    modelModule('Combined offense environment',(((hOff+aOff)/2)-1)*2.4,((hOff+aOff)/2)>=1?'over':'under',`Combined regressed offense index ${(((hOff+aOff)/2)*100).toFixed(0)} (100 = league average).`,82),
    modelModule('Starting-pitcher run environment',(((hspSkill+aspSkill)/2)-1)*2.1,((hspSkill+aspSkill)/2)>=1?'over':'under',`Starter run factors: home ${hspSkill.toFixed(2)}, away ${aspSkill.toFixed(2)} (above 1.00 = more runs allowed).`,hp&&ap?84:42),
    modelModule('Staff run environment',(((hEra+aEra)/(2*4.35))-1)*2.0,(hEra+aEra)>=8.7?'over':'under',`Combined staff ERA ${(hEra+aEra).toFixed(2)} vs neutral 8.70.`,72),
    modelModule('Bullpen fatigue environment',(((100-hBull.availability)+(100-aBull.availability)-50)/70),((100-hBull.availability)+(100-aBull.availability))>=50?'over':'under',`Combined bullpen fatigue load ${(200-hBull.availability-aBull.availability).toFixed(0)}; availability home ${hBull.availability.toFixed(0)}, away ${aBull.availability.toFixed(0)}.`,hBull.verified&&aBull.verified?80:42)
  ];
  if(weather)totalDrivers.push(modelModule('Weather run environment',wAdj/0.8,wAdj>=0?'over':'under',`${weatherSummary(weather)}; weather adjustment ${wAdj>=0?'+':''}${wAdj.toFixed(2)} runs.`,62));
  const starterSampleMinIp=hp&&ap?Math.min(hReg.ip,aReg.ip):0,starterSamplePenalty=hp&&ap?(starterSampleMinIp<10?6:starterSampleMinIp<30?3:0):0; const criticalPenalty=(hp&&ap?0:12)+(lineups.confirmed?0:7)+(hBull.verified&&aBull.verified?0:8)+starterSamplePenalty; let dq=38+(hh&&ah?14:0)+(hpStaff&&apStaff?10:0)+(hp&&ap&&hsp&&asp?16:0)+(hlog&&alog?8:0)+(recent?6:0)+(hBull.verified&&aBull.verified?9:0)+(weather?3:0)+(lineups.confirmed?9:0); dq=Math.min(dq,lineups.confirmed?94:85); dq=clamp(dq-criticalPenalty/2,30,96); const uncertainty=clamp(100-dq+(hp&&ap?0:12)+(lineups.confirmed?0:hoursUntil(event.commence_time)<4?7:2)+(hBull.verified&&aBull.verified?0:5)+(starterSamplePenalty?4:0)); const rawAgr=agreement(mods),coverage=coverageScore(mods,'baseball_mlb',criticalPenalty),effAgr=effectiveAgreement(rawAgr,coverage,dq); const ec=edgeCount(mods,homeProb>=.5);
  const periodProjection=(inn)=>{const firstBoost=inn===1?1.07:1,away=clamp((lg*aOff*hspSkill)*(inn/9)*firstBoost,.08,inn*1.18),home=clamp((lg*hOff*aspSkill)*(inn/9)*firstBoost+(inn/9)*.18,.08,inn*1.22),tot=away+home,tie=inn===1?Math.exp(-tot):clamp(.28-.018*(tot-2.5)-.012*inn,.10,.32);return {projected_score:{away:+away.toFixed(2),home:+home.toFixed(2)},projected_total:+tot.toFixed(2),projected_margin_home:+(home-away).toFixed(2),tie_risk:tie};}; const f1=periodProjection(1),f3=periodProjection(3),f5=periodProjection(5);
  const risks=[]; if(hp&&ap&&(hReg.active||aReg.active))risks.push(`Small-sample starter regression active: minimum MLB workload ${starterSampleMinIp.toFixed(1)} IP; volatile ERA/FIP/WHIP/HR inputs were shrunk toward team/league priors.`); if(!hp||!ap)risks.push('One or both probable starters are not confirmed.'); if(!lineups.confirmed)risks.push('Starting lineups are not confirmed yet; AEGIS will not release a Core MLB bet close to first pitch without them.'); if(!(hBull.verified&&aBull.verified))risks.push('Recent bullpen workload could not be fully verified.'); else if(hBull.heavyCount||aBull.heavyCount)risks.push(`Bullpen fatigue exists: home ${hBull.heavyCount} heavy-use arm(s), away ${aBull.heavyCount}.`); if(weather?.precip_probability>=60)risks.push('Elevated precipitation risk can alter pitcher usage or game timing.');
  return {event_id:event.id,sport:event.sport_key,away_team:event.away_team,home_team:event.home_team,projected_score:{away:+awayRuns.toFixed(1),home:+homeRuns.toFixed(1)},projected_total:+total.toFixed(1),projected_margin_home:+margin.toFixed(1),home_win_probability:homeProb,data_quality:dq,uncertainty,model_agreement:rawAgr,coverage_score:coverage,effective_agreement:effAgr,independent_edge_count:ec,probable_starters_confirmed:!!(hp&&ap),lineups_confirmed:!!lineups.confirmed,bullpen_verified:!!(hBull.verified&&aBull.verified),starter_regression_active:!!(hp&&ap&&(hReg.active||aReg.active)),starter_sample_min_ip:+starterSampleMinIp.toFixed(1),starter_regression:{home:hReg,away:aReg},total_drivers:totalDrivers,f1,f3,f5,modules:mods,risks,weather,notes:[`Probable starters: ${ap?.fullName||'TBD'} vs ${hp?.fullName||'TBD'}`,lineups.confirmed?'Lineups confirmed by MLB feed.':'Lineups not yet confirmed.',`Bullpen availability: away ${aBull.availability.toFixed(0)}/100, home ${hBull.availability.toFixed(0)}/100.`,`F5 projection ${event.away_team} ${f5.projected_score.away} – ${event.home_team} ${f5.projected_score.home}; estimated tie risk ${(f5.tie_risk*100).toFixed(0)}%.`],sources};
}

function lowInfoProjection(event,note,dq=45,risks=[]){ return {event_id:event.id,sport:event.sport_key,away_team:event.away_team,home_team:event.home_team,projected_score:{away:null,home:null},projected_total:null,projected_margin_home:0,home_win_probability:.5,data_quality:dq,uncertainty:100-dq,model_agreement:50,coverage_score:Math.max(20,dq-10),effective_agreement:50,independent_edge_count:0,modules:[],risks:[note,...risks],weather:null,notes:[note],sources:[]}; }

async function analyzeESPN(event){
  const cfg=ESPN[event.sport_key]; if(!cfg)return lowInfoProjection(event,'No free structured provider configured.',35);
  let board; try{board=await espnBoard(cfg,event.commence_time);}catch{return lowInfoProjection(event,'Free ESPN scoreboard endpoint was unavailable for this league.',35,['This provider is undocumented and can change without notice.']);}
  const ee=espnEventMatch(board,event); if(!ee)return lowInfoProjection(event,'Could not match the event to the free ESPN structured feed.',40,['The model will not use market prices as a substitute for missing independent data.']);
  const h=extractEspnTeam(ee,'home'),a=extractEspnTeam(ee,'away'),year=seasonYear(event.commence_time),venue=espnVenue(ee); const sources=[{name:'ESPN structured scoreboard/schedule feed',url:`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard`}];
  const [hs,as,summary,news,nflGames,cfbd]=await Promise.all([
    espnTeamSchedule(cfg,h?.id,year),espnTeamSchedule(cfg,a?.id,year),espnSummary(cfg,ee.id),espnNews(cfg),event.sport_key.startsWith('americanfootball_nfl')?nflverseGames():Promise.resolve([]),event.sport_key==='americanfootball_ncaaf'?cfbdAll(year):Promise.resolve(null)
  ]);
  let hm=scheduleMetrics(hs,h?.id,event.commence_time),am=scheduleMetrics(as,a?.id,event.commence_time);
  if(event.sport_key==='americanfootball_nfl' || event.sport_key==='americanfootball_nfl_preseason'){
    const nh=nflverseMetrics(nflGames,event.home_team,event.commence_time,event.sport_key==='americanfootball_nfl_preseason'); const na=nflverseMetrics(nflGames,event.away_team,event.commence_time,event.sport_key==='americanfootball_nfl_preseason'); if(nh?.games)hm=nh;if(na?.games)am=na; if(nflGames.length)sources.push({name:'nflverse / nfldata',url:'https://github.com/nflverse/nfldata'});
  }
  const hn=teamNews(event.home_team,news),an=teamNews(event.away_team,news),hsRisk=summaryRisk(summary,event.home_team),asRisk=summaryRisk(summary,event.away_team);
  const geo=venue.indoor?null:await openMeteoGeo(venue.city,venue.state),weather=geo?await openMeteo(geo.lat,geo.lon,event.commence_time):null; if(weather)sources.push({name:'Open-Meteo',url:'https://open-meteo.com/'});
  const avg=cfg.avgPoints; const hpf=hm.pf??avg,hpa=hm.pa??avg,apf=am.pf??avg,apa=am.pa??avg; let homeScore=(hpf+apa)/2+cfg.homeAdv/2,awayScore=(apf+hpa)/2-cfg.homeAdv/2;
  const mods=[]; let ratingMargin=null,advanced=false,ncaafMeta=null;
  if(event.sport_key==='americanfootball_ncaaf'&&cfbd){
    const homeRatingName=h?.location||event.home_team,awayRatingName=a?.location||event.away_team;
    const hmSp=findRatingMatch(cfbd.sp,homeRatingName),amSp=findRatingMatch(cfbd.sp,awayRatingName),hsp=hmSp.row,asp=amSp.row;
    const hmPrev=findRatingMatch(cfbd.priorSp,homeRatingName),amPrev=findRatingMatch(cfbd.priorSp,awayRatingName),hPrev=hmPrev.row,aPrev=amPrev.row;
    const hClassMatch=classificationMatch(cfbd.records,homeRatingName),aClassMatch=classificationMatch(cfbd.records,awayRatingName),gameClass=cfbdGameMatch(cfbd.games,event);
    const hc=findRating(cfbd.core,homeRatingName),ac=findRating(cfbd.core,awayRatingName),he=findRating(cfbd.elo,homeRatingName),ae=findRating(cfbd.elo,awayRatingName);
    const hpCore=findRating(cfbd.priorCore,homeRatingName),apCore=findRating(cfbd.priorCore,awayRatingName),hpElo=findRating(cfbd.priorElo,homeRatingName),apElo=findRating(cfbd.priorElo,awayRatingName);
    const minGames=Math.min(hm.games||0,am.games||0),currentWeight=ncaafCurrentWeight(minGames),scheduleWeight=ncaafScheduleWeight(minGames);
    const gameHomeClass=normalizeClassification(gameClass?.homeClassification),gameAwayClass=normalizeClassification(gameClass?.awayClassification);
    const homeClass=gameHomeClass!=='unknown'?gameHomeClass:resolvedNcaafClass(hClassMatch,hsp||hPrev),awayClass=gameAwayClass!=='unknown'?gameAwayClass:resolvedNcaafClass(aClassMatch,asp||aPrev);
    const crossClass=homeClass!==awayClass&&homeClass!=='unknown'&&awayClass!=='unknown';
    const mappingCollision=!!((hsp&&asp&&normalizeTeam(hsp.team)===normalizeTeam(asp.team))||(hPrev&&aPrev&&normalizeTeam(hPrev.team)===normalizeTeam(aPrev.team)));
    const currentDiff=(hsp&&asp&&!mappingCollision)?clamp(num(hsp.rating)-num(asp.rating),-28,28):null,priorDiff=(hPrev&&aPrev&&!mappingCollision)?clamp(num(hPrev.rating)-num(aPrev.rating),-28,28):null;
    let classBaseline=0,crossClassScaleGuard=false,blendedSp=null;
    const classificationSource=(gameHomeClass!=='unknown'&&gameAwayClass!=='unknown')?'CFBD scheduled game':(hClassMatch.class!=='unknown'&&aClassMatch.class!=='unknown')?'CFBD records':'conference fallback';

    if(crossClass){
      classBaseline=ncaafCrossClassBaseline(homeClass,awayClass);
      blendedSp=classBaseline;
      ratingMargin=classBaseline+cfg.homeAdv;
      crossClassScaleGuard=true;
      advanced=true;
      ncaafMeta={minGames,currentWeight,scheduleWeight,currentDiff,priorDiff,blendedSp,homeClass,awayClass,crossClass,classBaseline,crossClassScaleGuard,homeMatch:hmSp,awayMatch:amSp,homePriorMatch:hmPrev,awayPriorMatch:amPrev,homeClassMatch:hClassMatch,awayClassMatch:aClassMatch,classificationSource,cfbdGameId:gameClass?.id||null,priorMissing:priorDiff==null};
      const homeMatched=hsp?.team||hPrev?.team||event.home_team,awayMatched=asp?.team||aPrev?.team||event.away_team;
      mods.push(modelModule('SP+ / true strength prior blend',classBaseline/12,classBaseline>=0?'home':'away',`Cross-class scale guard active. Raw SP+ differences (${currentDiff==null?'current unavailable':currentDiff.toFixed(1)+' current diff'}; ${priorDiff==null?'prior unavailable':priorDiff.toFixed(1)+' prior diff'}) are diagnostic only. Structural class prior ${classBaseline>=0?'+':''}${classBaseline.toFixed(1)} before home field. Current matches: ${homeMatched} vs ${awayMatched}.`,82));
      mods.push(modelModule('FBS/FCS classification prior',classBaseline/12,classBaseline>=0?'home':'away',`Exact scheduled-game classification: home ${homeClass}, away ${awayClass}. A ${Math.abs(classBaseline).toFixed(1)}-point neutral-field structural prior replaces raw cross-class rating subtraction. Classification source: ${classificationSource}.`,92));
      mods.push(modelModule('Cross-class component quarantine',0,'neutral','SP+ offense/defense/special-teams, CORE and Elo differentials are not used directionally across FBS/FCS classes. Schedule-result influence is also capped until comparable current-season evidence exists.',100));
    } else if(!mappingCollision&&((hsp&&asp)||(hPrev&&aPrev))){
      blendedSp=blendPriorCurrent(currentDiff,priorDiff,currentWeight);
      if(blendedSp!=null){ratingMargin=blendedSp+cfg.homeAdv;advanced=true;}
      ncaafMeta={minGames,currentWeight,scheduleWeight,currentDiff,priorDiff,blendedSp,homeClass,awayClass,crossClass:false,classBaseline:0,crossClassScaleGuard:false,homeMatch:hmSp,awayMatch:amSp,homePriorMatch:hmPrev,awayPriorMatch:amPrev,homeClassMatch:hClassMatch,awayClassMatch:aClassMatch,classificationSource,cfbdGameId:gameClass?.id||null,priorMissing:priorDiff==null};
      const dir=(blendedSp||0)>=0?'home':'away';
      mods.push(modelModule('SP+ / true strength prior blend',(blendedSp||0)/12,dir,`Current SP+ diff ${currentDiff==null?'unavailable':currentDiff.toFixed(1)}; prior-year diff ${priorDiff==null?'unavailable (current rating shrunk toward neutral)':priorDiff.toFixed(1)}; current-season weight ${(currentWeight*100).toFixed(0)}%. Current matches: ${hsp?.team||'none'} vs ${asp?.team||'none'}. Prior matches: ${hPrev?.team||'none'} vs ${aPrev?.team||'none'}.`,minGames<3?74:88));
      if(hsp?.offense&&asp?.offense){const d=num(hsp.offense.rating)-num(asp.offense.rating);mods.push(modelModule('Offense / success / explosiveness',d/18,d>=0?'home':'away',`Current SP+ offense rating ${num(hsp.offense.rating).toFixed(1)} vs ${num(asp.offense.rating).toFixed(1)}; early-season confidence is reduced until sample grows.`,minGames<3?62:82));}
      if(hsp?.defense&&asp?.defense){const d=num(asp.defense.rating)-num(hsp.defense.rating);mods.push(modelModule('Defense / havoc',d/18,d>=0?'home':'away',`Current SP+ defense rating ${num(hsp.defense.rating).toFixed(1)} vs ${num(asp.defense.rating).toFixed(1)}; lower defense rating is treated as better.`,minGames<3?62:82));}
      if(hsp?.specialTeams&&asp?.specialTeams){const d=num(hsp.specialTeams.rating)-num(asp.specialTeams.rating);mods.push(modelModule('Special teams',d/5,d>=0?'home':'away','CFBD SP+ special-teams component; weight remains modest.',70));}
    } else {
      ncaafMeta={minGames,currentWeight,scheduleWeight,currentDiff:null,priorDiff:null,blendedSp:null,homeClass,awayClass,crossClass:false,classBaseline:0,crossClassScaleGuard:false,homeMatch:hmSp,awayMatch:amSp,homePriorMatch:hmPrev,awayPriorMatch:amPrev,homeClassMatch:hClassMatch,awayClassMatch:aClassMatch,classificationSource,cfbdGameId:gameClass?.id||null,priorMissing:true};
    }

    if(!crossClass&&hc&&ac){const cur=num(hc.overall)-num(ac.overall),prev=(hpCore&&apCore)?num(hpCore.overall)-num(apCore.overall):null,bd=blendPriorCurrent(cur,prev,currentWeight);mods.push(modelModule('CORE efficiency prior blend',bd/15,bd>=0?'home':'away',`CORE overall diff current ${cur.toFixed(1)}; prior ${prev==null?'unavailable':prev.toFixed(1)}. Early-season CORE is explicitly shrunk because its sample is smaller.`,minGames<3?60:80));}
    if(!crossClass&&he&&ae){const cur=num(he.elo)-num(ae.elo),prev=(hpElo&&apElo)?num(hpElo.elo)-num(apElo.elo):null,bd=blendPriorCurrent(cur,prev,currentWeight);mods.push(modelModule('Elo prior blend',bd/250,bd>=0?'home':'away',`Elo diff current ${cur.toFixed(0)}; prior ${prev==null?'unavailable':prev.toFixed(0)}.`,minGames<3?64:74));}
    if(hmSp.ambiguous||amSp.ambiguous)mods.push(modelModule('CFBD team mapping integrity',0,'neutral','At least one current-year CFBD team-name match was ambiguous, so the uncertain rating match was rejected.',95));
    if((hmPrev.matched&&!hPrev)||(amPrev.matched&&!aPrev))mods.push(modelModule('CFBD prior mapping integrity',0,'neutral',`A prior-year candidate was rejected as too generic/ambiguous (${hmPrev.matched||'none'} / ${amPrev.matched||'none'}). No false prior is substituted.`,100));
    if(mappingCollision)mods.push(modelModule('CFBD team mapping integrity',0,'neutral','Home and away resolved to the same CFBD team; advanced directional ratings were discarded for this game.',100));
    sources.push({name:'CollegeFootballData free API',url:'https://api.collegefootballdata.com/'});
  }
  const schedMargin=(hm.margin??0)-(am.margin??0); if(ratingMargin!=null){ const sw=ncaafMeta?.scheduleWeight??.28; let blended=(1-sw)*ratingMargin+sw*(schedMargin/2+cfg.homeAdv); if(ncaafMeta?.crossClass&&ncaafMeta.minGames<3){ const againstFbs=(ncaafMeta.homeClass==='fbs'&&blended<-6)||(ncaafMeta.awayClass==='fbs'&&blended>6); if(againstFbs)blended=clamp(blended,-6,6); } const totalBase=homeScore+awayScore; homeScore=totalBase/2+blended/2;awayScore=totalBase/2-blended/2; }
  mods.push(modelModule('Season scoring / efficiency proxy',schedMargin/(event.sport_key==='basketball_wnba'?16:12),schedMargin>=0?'home':'away',`Home PF/PA ${hpf.toFixed(1)}/${hpa.toFixed(1)}; away PF/PA ${apf.toFixed(1)}/${apa.toFixed(1)}`,hm.games>=3&&am.games>=3?78:45));
  const recentDiff=(hm.recentMargin??hm.margin??0)-(am.recentMargin??am.margin??0); mods.push(modelModule('Current form (capped)',recentDiff/(event.sport_key==='basketball_wnba'?18:15),recentDiff>=0?'home':'away',`Recent margin trend: home ${(hm.recentMargin??0).toFixed(1)}, away ${(am.recentMargin??0).toFixed(1)}`,Math.min(65,40+(hm.games+am.games)*2)));
  mods.push(modelModule('Home field / court',cfg.homeAdv/(event.sport_key==='basketball_wnba'?5:7),'home',`Home adjustment ${cfg.homeAdv.toFixed(1)} points.`,70));
  if(hn.some(x=>x.critical)||an.some(x=>x.critical)||hsRisk.injuryHits||asRisk.injuryHits)mods.push(modelModule('Availability / injury signal',0,'neutral','Free structured/news feed contains availability-related language; exact impact may be unresolved.',52));
  const wAdj=weatherTotalAdjustment(event.sport_key,weather,venue.indoor); if(weather&&!venue.indoor)mods.push(modelModule('Weather',wAdj/5,wAdj>=0?'over':'under',weatherSummary(weather),65)); homeScore+=wAdj/2;awayScore+=wAdj/2;
  let margin=homeScore-awayScore,total=homeScore+awayScore; if(event.sport_key==='baseball_kbo'||event.sport_key==='baseball_npb'){homeScore=Math.max(1.4,homeScore);awayScore=Math.max(1.4,awayScore);margin=homeScore-awayScore;total=homeScore+awayScore;}
  const totalDrivers=[
    modelModule('Scoring environment',(((hpf+apf)/(2*avg))-1)*2,(hpf+apf)>=2*avg?'over':'under',`Combined scoring ${hpf.toFixed(1)} + ${apf.toFixed(1)} vs neutral ${(2*avg).toFixed(1)}.`,hm.games>=3&&am.games>=3?74:42),
    modelModule('Points/runs allowed environment',(((hpa+apa)/(2*avg))-1)*2,(hpa+apa)>=2*avg?'over':'under',`Combined points/runs allowed ${hpa.toFixed(1)} + ${apa.toFixed(1)} vs neutral ${(2*avg).toFixed(1)}.`,hm.games>=3&&am.games>=3?72:42)
  ];
  if(Number.isFinite(hm.recentPF)&&Number.isFinite(am.recentPF))totalDrivers.push(modelModule('Recent scoring environment',(((hm.recentPF+am.recentPF)/(2*avg))-1)*1.2,(hm.recentPF+am.recentPF)>=2*avg?'over':'under',`Recent scoring: home ${hm.recentPF.toFixed(1)}, away ${am.recentPF.toFixed(1)}. Weight capped.`,56));
  if(weather&&!venue.indoor)totalDrivers.push(modelModule('Weather total pressure',wAdj/(event.sport_key.startsWith('americanfootball')?4:2),wAdj>=0?'over':'under',weatherSummary(weather),62));
  let dq=35+(hm.games>=3&&am.games>=3?24:hm.games+am.games>0?12:0)+(summary?6:0)+(news?5:0)+(weather||venue.indoor?5:0)+(advanced?18:0); let cap=78;
  if(event.sport_key==='americanfootball_ncaaf'){
    cap=advanced?90:68;
    if(ncaafMeta){ if(ncaafMeta.minGames<2)cap=Math.min(cap,78); else if(ncaafMeta.minGames<4)cap=Math.min(cap,84); if(ncaafMeta.crossClass&&ncaafMeta.minGames<3)cap=Math.min(cap,76); if(ncaafMeta.priorDiff==null&&ncaafMeta.minGames<3)cap=Math.min(cap,72); }
  }
  if(event.sport_key==='americanfootball_nfl_preseason')cap=hn.concat(an).some(x=>/qb2|qb3|rotation|starter|joint practice|play.*quarter|snap/i.test(`${x.headline} ${x.description}`))?68:58;
  if(event.sport_key==='baseball_kbo')cap=62;if(event.sport_key==='baseball_npb')cap=65;if(event.sport_key==='basketball_wnba')cap=78;
  dq=Math.min(cap,dq); const injuryPenalty=Math.min(12,(hn.filter(x=>x.critical).length+an.filter(x=>x.critical).length)*3+Math.min(6,hsRisk.injuryHits+asRisk.injuryHits)); dq=Math.max(30,dq-injuryPenalty); const uncertainty=clamp(100-dq+(event.sport_key==='americanfootball_nfl_preseason'?18:0)); const homeProb=clamp01(normCdf(margin/cfg.marginSd)); const agr=agreement(mods),coverage=coverageScore(mods,event.sport_key,event.sport_key==='americanfootball_nfl_preseason'?15:injuryPenalty/2),effAgr=effectiveAgreement(agr,coverage,dq),ec=edgeCount(mods,homeProb>=.5); const risks=[];
  if((hm.games||0)<3||(am.games||0)<3){ if(event.sport_key==='americanfootball_ncaaf')risks.push(`Early-season NCAAF sample: current results are intentionally downweighted (${Math.round((ncaafMeta?.currentWeight??.18)*100)}% current / ${100-Math.round((ncaafMeta?.currentWeight??.18)*100)}% prior when prior ratings exist).`); else risks.push('Small current-season sample in the free schedule feed.'); }
  if(event.sport_key==='americanfootball_ncaaf'&&ncaafMeta?.crossClass)risks.push(`FBS/FCS crossover uncertainty: ${ncaafMeta.homeClass} home vs ${ncaafMeta.awayClass} away; explicit classification source ${ncaafMeta.classificationSource||'fallback'}, raw cross-class SP+/CORE/Elo components are quarantined, a structural class prior is used, and stricter release limits are active.`);
  if(event.sport_key==='americanfootball_ncaaf'&&(ncaafMeta?.homeMatch?.ambiguous||ncaafMeta?.awayMatch?.ambiguous))risks.push('CFBD current-year team-name mapping was ambiguous for at least one team; the uncertain advanced rating was rejected.');
  if(event.sport_key==='americanfootball_ncaaf'&&ncaafMeta?.priorMissing&&ncaafMeta?.minGames<3)risks.push('No valid prior-year SP+ pair was available; current-year SP+ is heavily shrunk toward neutral rather than given a minimum floor.');
  if(injuryPenalty>0)risks.push('Availability-related news exists but the deterministic engine cannot fully interpret every player impact.'); if(event.sport_key==='americanfootball_nfl_preseason')risks.push('Free structured feeds do not reliably confirm full QB2/QB3 snap plans; large-favorite/Core gates are intentionally strict.'); if((event.sport_key==='baseball_kbo'||event.sport_key==='baseball_npb')&&!hm.games)risks.push('Foreign-league structured data coverage is thin; AEGIS will usually PASS instead of anchoring to the market.');
  return {event_id:event.id,sport:event.sport_key,away_team:event.away_team,home_team:event.home_team,projected_score:{away:+awayScore.toFixed(1),home:+homeScore.toFixed(1)},projected_total:+total.toFixed(1),projected_margin_home:+margin.toFixed(1),home_win_probability:homeProb,data_quality:dq,uncertainty,model_agreement:agr,coverage_score:coverage,effective_agreement:effAgr,independent_edge_count:ec,total_drivers:totalDrivers,modules:mods,risks,weather,ncaaf_integrity:ncaafMeta,notes:[venue.name?`Venue: ${venue.name}`:'Venue unavailable',advanced?'CFBD advanced ratings active with strict team mapping + early-season prior blending.':'CFBD advanced ratings not active.',...(ncaafMeta?[`NCAAF current-season weight ${(ncaafMeta.currentWeight*100).toFixed(0)}%; schedule-result weight ${(ncaafMeta.scheduleWeight*100).toFixed(0)}%.`,ncaafMeta.crossClass?`Cross-classification shrink active (${ncaafMeta.homeClass} vs ${ncaafMeta.awayClass}).`:'Same classification / no crossover shrink.']:[])],news:[...hn.map(x=>({team:event.home_team,...x})),...an.map(x=>({team:event.away_team,...x}))].slice(0,10),sources};
}

async function analyzeEvent(event){ if(event.sport_key==='baseball_mlb')return analyzeMLB(event); return analyzeESPN(event); }

function marketCushion(sport,market,proj){ const base=marketBase(market),inn=mlbPeriodInnings(market),period=inn!=null; let c=base==='h2h'?.025:base==='spreads'?.03:.035; if(sport==='baseball_mlb'&&base==='spreads')c=.04; if(sport==='baseball_mlb'&&period){const pp=proj?.[`f${inn}`];c=Math.max(c,base==='h2h'?.035:.04)+(Number(pp?.tie_risk)||0)*.025+(inn<=3?.006:0);}  if(sport==='baseball_npb'&&base==='totals'&&proj.projected_total!=null&&proj.projected_total<=6.5)c=.055; if(sport==='americanfootball_nfl_preseason')c+=.015; if(proj.data_quality<70)c+=.01; return c; }
function uncertaintyShrink(prob,proj){ const q=clamp(proj.data_quality)/100,unc=clamp(proj.uncertainty)/100,rel=Math.max(.18,Math.min(.95,q*(1-.45*unc))); return .5+(prob-.5)*rel; }
function ncaafEvidenceCompression(prob,proj,support,coverage){
  if(proj?.sport!=='americanfootball_ncaaf')return {prob,active:false,factor:1};
  const ni=proj.ncaaf_integrity||{},g=Math.max(0,Number(ni.minGames)||0);
  const gameFactor=g<=1?.42:g===2?.52:g===3?.64:g===4?.75:g===5?.84:g===6?.90:.95;
  const supportFactor=Math.max(.22,Math.min(1,(Number(support)||0)/70));
  const coverageFactor=Math.max(.35,Math.min(1,(Number(coverage)||0)/82));
  let integrityFactor=1;
  if(ni.crossClass)integrityFactor*=.82;
  if(ni.priorMissing)integrityFactor*=.78;
  if(ni.homeClass==='unknown'||ni.awayClass==='unknown')integrityFactor*=.82;
  const factor=Math.max(.16,Math.min(.95,gameFactor*(.55+.45*supportFactor)*(.65+.35*coverageFactor)*integrityFactor));
  return {prob:.5+(Number(prob)-.5)*factor,active:factor<.94,factor};
}
function getPairOutcome(pair,name){ return pair.outcomes.find(o=>sameTeam(o.name,name)||String(o.name).toLowerCase()===String(name).toLowerCase()); }
function probToAmerican(p){p=clamp01(p);if(p<=0||p>=1)return null;return p>=.5?Math.round(-100*p/(1-p)):Math.round(100*(1-p)/p);}
function executionBands(fair,cushion){
  const f=clamp01(fair),c=Math.max(0,Number(cushion)||0);
  return {
    play_to:probToAmerican(clamp01(f-c)),
    downgrade_at:probToAmerican(clamp01(f-c*.72)),
    pass_at:probToAmerican(f),
    core_required_probability:clamp01(f-c),
    secondary_required_probability:clamp01(f-c*.72),
    break_even_probability:f
  };
}
function dataFreshnessGrade(event,proj,c){
  const hrs=hoursUntil(event.commence_time),quoteAge=c.last_update?Math.max(0,Math.abs(Date.now()-new Date(c.last_update).getTime())/60000):null;
  const critical=[],nonCritical=[];
  if(quoteAge==null)nonCritical.push('sportsbook quote timestamp unavailable');
  else if(quoteAge>60)critical.push(`sportsbook quote is ${Math.round(quoteAge)} minutes old`);
  else if(quoteAge>20)nonCritical.push(`sportsbook quote is ${Math.round(quoteAge)} minutes old`);
  if(Number(proj.data_quality||0)<60)critical.push(`structured data quality ${Math.round(proj.data_quality||0)}/100`);
  else if(Number(proj.data_quality||0)<80)nonCritical.push(`structured data quality ${Math.round(proj.data_quality||0)}/100`);
  if(Number(c.market_coverage||0)<55)critical.push(`market/model coverage ${Math.round(c.market_coverage||0)}/100`);
  else if(Number(c.market_coverage||0)<75)nonCritical.push(`market/model coverage ${Math.round(c.market_coverage||0)}/100`);
  if(c.market_consensus_books<2)nonCritical.push('multi-book consensus is limited');
  if(event.sport_key==='baseball_mlb'){
    if(!proj.probable_starters_confirmed)critical.push('one or both probable starters are unconfirmed');
    if(proj.starter_regression_active)nonCritical.push(`limited MLB starter sample (${Number(proj.starter_sample_min_ip||0).toFixed(1)} IP minimum); pitcher rates are regressed toward priors`);
    if(hrs<=4&&!proj.lineups_confirmed)critical.push('starting lineups are not fully confirmed close to first pitch');
    else if(!proj.lineups_confirmed)nonCritical.push('starting lineups are not posted yet');
    if(!proj.bullpen_verified)nonCritical.push('recent bullpen workload is not fully verified');
  }
  if(event.sport_key==='americanfootball_ncaaf'){
    const ni=proj.ncaaf_integrity||{};
    if(ni.crossClass&&(ni.homeClass==='unknown'||ni.awayClass==='unknown'))critical.push('FBS/FCS classification is unresolved');
    if((ni.homeMatch?.ambiguous||ni.awayMatch?.ambiguous))critical.push('CFBD team identity mapping is ambiguous');
    if(ni.minGames<2)nonCritical.push('early-season current sample is small');
  }
  const meaningful=critical.length>0||nonCritical.length>1;
  const grade=critical.length?'C':nonCritical.length===0?'A':nonCritical.length===1?'B':meaningful?'C':'B';
  return {grade,quote_age_minutes:quoteAge==null?null:+quoteAge.toFixed(1),critical,non_critical:nonCritical,checked_at:new Date().toISOString()};
}
function marketCandidate(event,proj,pair,market){
  const home=event.home_team,away=event.away_team,base=marketBase(market),inn=mlbPeriodInnings(market),period=inn!=null,periodName=inn===1?'1st inning':`F${inn}`; let sideName,oppName,fairRaw,point=null,fit=0,thesis='',pushProbability=0;
  const pp=period?proj?.[`f${inn}`]:null,scoreProj=period?pp?.projected_score:proj.projected_score, totalProj=period?pp?.projected_total:proj.projected_total, marginProj=period?pp?.projected_margin_home:proj.projected_margin_home;
  if(period&&(!scoreProj||scoreProj.home==null||scoreProj.away==null))return null;
  if(base==='h2h'){
    if(period){ const first=mlbDiscreteScores(scoreProj.home,scoreProj.away,'h2h',home,null,home,away); if(!first)return null; const homeLean=first.prob>=.5;sideName=homeLean?home:away;oppName=homeLean?away:home;const d=mlbDiscreteScores(scoreProj.home,scoreProj.away,'h2h',sideName,null,home,away);fairRaw=d.prob;pushProbability=d.push||0;fit=Math.abs(fairRaw-.5);thesis=`${sideName} ${periodName} moneyline`; }
    else { const homeLean=proj.home_win_probability>=.5; sideName=homeLean?home:away;oppName=homeLean?away:home;fairRaw=homeLean?proj.home_win_probability:1-proj.home_win_probability; fit=Math.abs(fairRaw-.5); thesis=`${sideName} moneyline`; }
  }
  else if(base==='spreads'){
    const ho=getPairOutcome(pair,home),ao=getPairOutcome(pair,away); if(!ho||!ao||ho.point==null||ao.point==null)return null; let homeCover;
    if(period){ const d=mlbDiscreteScores(scoreProj.home,scoreProj.away,'spreads',home,ho.point,home,away); if(!d)return null; homeCover=d.prob; }
    else { const sd=event.sport_key==='baseball_mlb'?2.85:(ESPN[event.sport_key]?.marginSd||12); homeCover=normCdf((marginProj+Number(ho.point))/sd); }
    const homeLean=homeCover>=.5; sideName=homeLean?home:away;oppName=homeLean?away:home; const so=homeLean?ho:ao;point=so.point;
    if(period){const d=mlbDiscreteScores(scoreProj.home,scoreProj.away,'spreads',sideName,point,home,away);fairRaw=d.prob;pushProbability=d.push||0;}else fairRaw=homeLean?homeCover:1-homeCover;
    fit=Math.abs((Number(marginProj)||0)+(homeLean?Number(ho.point):-Number(ao.point)))/(period?(inn<=3?.9:1.25):(event.sport_key==='baseball_mlb'?1.7:5)); thesis=`${sideName} ${period?periodName+' ':''}${point>0?'+':''}${point}`;
  } else if(base==='totals'){
    if(totalProj==null)return null; const over=pair.outcomes.find(o=>String(o.name).toLowerCase()==='over'),under=pair.outcomes.find(o=>String(o.name).toLowerCase()==='under'); if(!over||!under||over.point==null)return null; let overProb;
    if(period){const d=mlbDiscreteScores(scoreProj.home,scoreProj.away,'totals','Over',over.point,home,away);if(!d)return null;overProb=d.prob;}
    else {const sd=event.sport_key==='baseball_mlb'?2.9:event.sport_key==='basketball_wnba'?12:event.sport_key.startsWith('americanfootball')?14:3;overProb=normCdf((totalProj-Number(over.point))/sd);}
    const overLean=overProb>=.5; sideName=overLean?'Over':'Under';oppName=overLean?'Under':'Over'; const so=overLean?over:under; point=so.point;
    if(period){const d=mlbDiscreteScores(scoreProj.home,scoreProj.away,'totals',sideName,point,home,away);fairRaw=d.prob;pushProbability=d.push||0;}else fairRaw=overLean?overProb:1-overProb;
    fit=Math.abs(totalProj-Number(point))/(period?(inn<=3?.9:1.25):(event.sport_key==='baseball_mlb'?1.7:6));thesis=`${sideName} ${period?periodName+' ':''}${point}`;
  }
  const so=getPairOutcome(pair,sideName),oo=getPairOutcome(pair,oppName); if(!so||!oo)return null; if(event.sport_key==='baseball_mlb'&&!period&&(base==='spreads'||base==='totals')){ const discrete=mlbDiscreteMarket(proj,base,sideName,point,home,away); if(discrete){fairRaw=discrete.prob;pushProbability=discrete.push||0;} } const [bookSp]=fairTwoWay(so.price,oo.price); if(bookSp==null)return null; const consensus=marketConsensus(event,market,sideName,oppName,point),sp=consensus.prob??bookSp; const dq=clamp(proj.data_quality); let cov=clamp(proj.coverage_score??dq),eff=clamp(proj.effective_agreement??proj.model_agreement),rawAgree=clamp(proj.model_agreement),marketEdgeN=proj.independent_edge_count,marketSupport=0; 
  if(base==='totals'){let td=proj.total_drivers||[];if(period)td=td.filter(m=>!/Bullpen|Staff run environment/i.test(m.name));const overLean=String(sideName).toLowerCase()==='over';rawAgree=agreement(td);cov=driverCoverage(td,event.sport_key==='baseball_mlb'?(period?3:4):3);eff=effectiveAgreement(rawAgree,cov,dq);marketEdgeN=edgeCount(td,overLean);marketSupport=supportStrength(td,overLean);}
  else {const selectedHome=sameTeam(sideName,home);let sideMods=proj.modules||[];if(period)sideMods=sideMods.filter(m=>!/Bullpen availability|Staff pitching/i.test(m.name));marketSupport=supportStrength(sideMods,selectedHome);rawAgree=period?agreement(sideMods):rawAgree;cov=period?driverCoverage(sideMods,5):cov;eff=period?effectiveAgreement(rawAgree,cov,dq):eff;marketEdgeN=period?edgeCount(sideMods,selectedHome):marketEdgeN;} const uncertaintyAdjusted=uncertaintyShrink(fairRaw,proj); const ncaafCompressed=ncaafEvidenceCompression(uncertaintyAdjusted,proj,marketSupport,cov); const independentFair=ncaafCompressed.prob; const trust=Math.max(.32,Math.min(.72,.32+.42*(dq/100)*(cov/100)*(eff/100))); const fair=clamp01(sp+(independentFair-sp)*trust); const signedDivergence=independentFair-sp,divergence=Math.abs(signedDivergence),rawDivergence=Math.abs(fairRaw-sp); const bandW=uncertaintyWidth(proj,market); const fairLow=clamp01(fair-bandW),fairHigh=clamp01(fair+bandW); const marketInsideFairRange=sp>=fairLow&&sp<=fairHigh;
  let cushion=marketCushion(event.sport_key,market,proj); let edge=fair-sp; const ev=evFromAmericanPush(fair,so.price,pushProbability); const selectedAway=base!=='totals'&&sameTeam(sideName,away); if(selectedAway&&Number(so.price)<0)cushion+=.007; if(Number(so.price)<=-220)cushion+=.008; if(base==='totals'&&dq<76)cushion+=.01; if(consensus.dispersion>.02)cushion+=.005; const sanityFlags=[]; if(ncaafCompressed?.active)sanityFlags.push(`NCAAF evidence compression active: early-season/limited-evidence independent probability is compressed ${(100*(1-ncaafCompressed.factor)).toFixed(0)}% toward neutral before market calibration.`); if(divergence>=.12)sanityFlags.push('Extreme market disagreement: independent fair differs from consensus by at least 12 percentage points.'); else if(divergence>=.08)sanityFlags.push('Elevated market disagreement: independent fair differs from consensus by at least 8 percentage points.'); if(consensus.books<2)sanityFlags.push('Market challenger has limited multi-book consensus coverage.');
  let gate='PASS'; const edgeN=marketEdgeN;
  if(dq>=80&&cov>=76&&eff>=69&&rawAgree>=64&&edgeN>=2&&marketSupport>=55&&edge>=cushion&&ev>=.02)gate='CORE'; else if(dq>=66&&cov>=60&&eff>=59&&rawAgree>=56&&edgeN>=2&&marketSupport>=42&&edge>=cushion*.72&&ev>=.005)gate='SECONDARY'; else if(edge>0&&dq>=50)gate='WATCH';
  if(divergence>=.12&&gate!=='PASS')gate='WATCH'; else if(divergence>=.08&&gate==='CORE')gate=(dq>=88&&cov>=82&&eff>=75&&consensus.books>=3)?'SECONDARY':'WATCH';
  if(marketInsideFairRange){sanityFlags.push('Uncertainty-band overlap: the market challenger sits inside the calibrated fair-probability range.'); if(gate==='CORE')gate='SECONDARY'; else if(gate==='SECONDARY'&&edge<cushion*1.25)gate='WATCH';}
  if(event.sport_key==='baseball_mlb'){
    const hrs=hoursUntil(event.commence_time);
    // MLB Confirmation Integrity: weak structured support is not a betting thesis.
    if(marketSupport<45){gate='PASS';sanityFlags.push('MLB support gate: support below 45/100 is an automatic CUT; the structured evidence is too weak for WATCH status.');}
    else if(marketSupport<60&&['CORE','SECONDARY'].includes(gate)){gate='WATCH';sanityFlags.push('MLB support gate: support below 60/100 cannot be released as Core or Secondary.');}
    else if(marketSupport<70&&gate==='CORE'){gate='SECONDARY';sanityFlags.push('MLB Core support gate: Core requires at least 70/100 market-specific support.');}
    // Full-game totals are fragile when the starting pitching identity is not verified.
    if(base==='totals'&&!proj.probable_starters_confirmed){gate='PASS';sanityFlags.push(`MLB probable-starter gate: a ${period?periodName:'full-game'} total with one or both probable starters unconfirmed is an automatic CUT.`);}
    if(hrs<=4&&!proj.lineups_confirmed&&['CORE','SECONDARY'].includes(gate)){gate='WATCH';sanityFlags.push('MLB lineup confirmation gate: batting orders are not fully posted close to first pitch.');}
    if(!period&&!proj.bullpen_verified&&gate==='CORE'){gate='SECONDARY';sanityFlags.push('MLB bullpen verification gate: recent reliever workload is incomplete.');}
    if(!period&&base==='totals'&&(!proj.bullpen_verified||!proj.lineups_confirmed)&&gate==='CORE'){gate='SECONDARY';sanityFlags.push('Fragile Totals Guard: bullpen/lineup uncertainty prevents a Core total.');}
  }
  if(event.sport_key==='americanfootball_ncaaf'){
    const ni=proj.ncaaf_integrity||{};
    const limitedComparable=!!(ni.crossClass||ni.priorMissing||ni.homeClass==='unknown'||ni.awayClass==='unknown');
    // Evidence Integrity: a numerical lean with no independent support is not a thesis.
    if(marketSupport<25){gate='PASS';sanityFlags.push('NCAAF no-support gate: support below 25/100 is an automatic CUT; the numerical lean is not independently evidenced.');}
    else if(marketSupport<60&&['CORE','SECONDARY'].includes(gate)){gate='WATCH';sanityFlags.push('NCAAF support gate: support below 60/100 cannot be released as Core or Secondary.');}
    else if(marketSupport<70&&gate==='CORE'){gate='SECONDARY';sanityFlags.push('NCAAF Core support gate: Core requires at least 70/100 market-specific support.');}
    if(ni.minGames<2&&gate==='CORE'){gate='SECONDARY';sanityFlags.push('NCAAF early-season prior gate: fewer than two current-season games prevents Core release.');}
    if(limitedComparable&&(marketSupport<55||cov<75||edgeN<2)){gate='PASS';sanityFlags.push('NCAAF comparable-data gate: FCS/transition/missing-prior profiles require support ≥55, coverage ≥75 and at least two independent market edges even for HOLD consideration.');}
    else if(limitedComparable&&ni.minGames<3&&['CORE','SECONDARY'].includes(gate)){gate='WATCH';sanityFlags.push('NCAAF limited-comparability gate: early-season FCS/transition/missing-prior profiles are capped at WATCH until the sample matures.');}
    if(ni.crossClass&&ni.minGames<3&&['CORE','SECONDARY'].includes(gate)){gate='WATCH';sanityFlags.push('FBS/FCS crossover gate: early-season cross-classification projections require stronger confirmation.');}
    if(ni.crossClass&&ni.minGames<3&&divergence>=.10&&gate!=='PASS'){gate='PASS';sanityFlags.push('FBS/FCS market-sanity gate: an early cross-class projection that disagrees with multi-book consensus by 10+ percentage points is an automatic CUT until stronger comparable evidence exists.');}
    if((ni.homeMatch?.ambiguous||ni.awayMatch?.ambiguous)&&gate!=='PASS'){gate='WATCH';sanityFlags.push('CFBD mapping-integrity gate: ambiguous team mapping prevents release.');}
  }
  if(event.sport_key==='americanfootball_nfl_preseason'&&gate==='CORE')gate='SECONDARY';
  if(event.sport_key==='americanfootball_nfl_preseason'&&market==='spreads'&&Math.abs(Number(point)||0)>3.5&&dq<68)gate='PASS';

  // EV & Cushion Integrity: WATCH is still a bankroll-candidate tier, so the price must
  // survive calibration. A positive raw lean is not enough if the calibrated EV is
  // non-positive or the adjusted edge fails the market-specific release cushion.
  if(ev<=0){
    gate='PASS';
    sanityFlags.push(`EV integrity gate: calibrated estimated EV is ${(ev*100).toFixed(1)}%; non-positive EV is an automatic CUT.`);
  } else if(edge<cushion){
    gate='PASS';
    sanityFlags.push(`Cushion integrity gate: adjusted edge ${(edge*100).toFixed(1)}% is below the required ${(cushion*100).toFixed(1)}% market-specific cushion; automatic CUT.`);
  }
  // Intelligence Suite diagnostics. These are quality/readiness diagnostics, not win probabilities.
  const marketQuality=clamp(38+Math.min(5,consensus.books)*9+(pair.hard_rock?8:0)-Math.min(28,(consensus.dispersion||0)*700),15,100);
  const edgeScore=clamp(50+((edge-cushion)*700),0,100);
  const evScore=clamp(50+ev*420,0,100);
  let decisionQuality=clamp(.17*dq+.15*cov+.14*eff+.19*marketSupport+.10*(100-clamp(proj.uncertainty||50))+.10*marketQuality+.08*edgeScore+.07*evScore,0,100);
  if(marketInsideFairRange)decisionQuality-=5;if(divergence>=.12)decisionQuality-=8;else if(divergence>=.08)decisionQuality-=4;if(!pair.hard_rock)decisionQuality-=3;
  const cap={CORE:100,SECONDARY:88,WATCH:74,PASS:49}[gate]||49;decisionQuality=clamp(Math.min(cap,decisionQuality),0,100);
  const decisionGrade=decisionQuality>=85?'ELITE':decisionQuality>=75?'STRONG':decisionQuality>=65?'SOLID':decisionQuality>=55?'FRAGILE':'LOW';
  const hist=marketHistoryFor(event.id,pair.book_key,market,sideName,point),openPrice=hist.length?hist[0].price:null,priceMove=openPrice==null?null:Number(so.price)-Number(openPrice);
  const bands=executionBands(fair,cushion); const freshness=dataFreshnessGrade(event,proj,{last_update:pair.last_update,market_coverage:cov,market_consensus_books:consensus.books});
  if(freshness.grade==='C'&&['CORE','SECONDARY'].includes(gate)){gate='WATCH';sanityFlags.push('Data Freshness Gate: C-level information quality cannot be released as Core or Secondary.');}
  const finalDecisionQuality=Math.min(decisionQuality,({CORE:100,SECONDARY:88,WATCH:74,PASS:49}[gate]||49)); const finalDecisionGrade=finalDecisionQuality>=85?'ELITE':finalDecisionQuality>=75?'STRONG':finalDecisionQuality>=65?'SOLID':finalDecisionQuality>=55?'FRAGILE':'LOW';
  return {event_id:event.id,market,selection:sideName,point,price:Number(so.price),book:pair.book,book_key:pair.book_key,hard_rock:pair.hard_rock,last_update:pair.last_update,open_price:openPrice,price_move:priceMove,market_period_innings:inn,market_projection_score:scoreProj,market_projection_total:totalProj,market_projection_margin_home:marginProj,market_probability:sp,book_market_probability:bookSp,market_consensus_books:consensus.books,market_dispersion:consensus.dispersion,market_quality_score:marketQuality,decision_quality:finalDecisionQuality,decision_grade:finalDecisionGrade,fair_probability:fair,fair_independent:independentFair,fair_raw:fairRaw,fair_probability_low:fairLow,fair_probability_high:fairHigh,market_prior_trust:trust,ncaaf_evidence_compression_factor:ncaafCompressed?.factor??1,ncaaf_evidence_compression_active:!!ncaafCompressed?.active,independent_disagreement:divergence,independent_disagreement_signed:signedDivergence,raw_market_gap:rawDivergence,market_inside_fair_range:marketInsideFairRange,push_probability:pushProbability,market_coverage:cov,market_model_agreement:rawAgree,market_effective_agreement:eff,market_edge_count:marketEdgeN,market_support_strength:marketSupport,adjusted_edge:edge,estimated_ev:ev,cushion,fit,thesis,tier:gate,sanity_flags:sanityFlags,data_quality_grade:freshness.grade,data_freshness:freshness,play_to:bands.play_to,downgrade_at:bands.downgrade_at,pass_at:bands.pass_at,execution_bands:bands};
}

function candidateRank(c){ return decision.selectionScore(c); }
function chooseMarket(event,proj){
  const all=[];
  const keys=['h2h','spreads','totals',...(event.sport_key==='baseball_mlb'?['h2h_1st_1_innings','totals_1st_1_innings','h2h_1st_3_innings','spreads_1st_3_innings','totals_1st_3_innings','h2h_1st_5_innings','spreads_1st_5_innings','totals_1st_5_innings']:[])];
  for(const k of keys)for(const p of quotePairs(event,k)){
    const c=marketCandidate(event,proj,p,k);
    if(c)all.push(c);
  }
  if(!all.length)return {best:null,all:[]};
  const enriched=all.map(c=>decision.enrichCandidate(c,proj,event));
  const hardRock=enriched.filter(c=>c.hard_rock&&c.tier!=='PASS');
  const nonPass=enriched.filter(c=>c.tier!=='PASS');
  const pool=(hardRock.length?hardRock:(nonPass.length?nonPass:enriched)).slice().sort((a,b)=>candidateRank(b)-candidateRank(a));
  const best=decision.chooseBestExpression(pool,event,proj)||pool[0]||null;
  return {best,all:enriched.slice().sort((a,b)=>candidateRank(b)-candidateRank(a))};
}
function buildWhy(proj,c){
  let good=[];
  if(marketBase(c.market)==='totals'){
    good=proj.modules.filter(m=>/offense|starting pitcher|staff pitching|bullpen|environment/i.test(m.name)).sort((a,b)=>b.confidence-a.confidence).slice(0,4);
  }else{
    const wantHome=sameTeam(c.selection,proj.home_team);
    good=proj.modules.filter(m=>wantHome?m.value>0:m.value<0).sort((a,b)=>Math.abs(b.value)*b.confidence-Math.abs(a.value)*a.confidence).slice(0,3);
  }
  const ps=c.market_projection_score||proj.projected_score||{};
  const scope=c.market_period_innings?`F${c.market_period_innings} `:'';
  const stress=c.stress_test;
  const stressText=stress?` Stress test: ${stress.secondary_survivals}/4 adverse scenarios retained Secondary-level economics; score ${stress.score}/100.`:'';
  const selectionText=c.market_selection_note?` Market selection: ${c.market_selection_note}`:'';
  return `${c.thesis}. ${scope}independent projection ${proj.away_team} ${ps.away??'—'} – ${proj.home_team} ${ps.home??'—'}. Primary supporting modules: ${good.map(m=>`${m.name} (${m.evidence})`).join(' | ')||'limited structured evidence'}.${stressText}${selectionText}`;
}
function fmtAmericanPrice(x){x=Number(x);return Number.isFinite(x)?`${x>0?'+':''}${Math.round(x)}`:'—';}
function timing(event,c,proj){
  const hrs=hoursUntil(event.commence_time),fresh=c.last_update?Math.abs(Date.now()-new Date(c.last_update).getTime())/60000:null;
  if(c.data_quality_grade==='C')return 'WAIT / PASS — information quality is C';
  if(c.execution_state==='WAIT_TARGET_BOOK')return 'WAIT — Hard Rock Florida price is not verified';
  if(c.execution_state==='PASS_PRICE')return `PASS — current Hard Rock price is beyond ${fmtAmericanPrice(c.pass_at)}`;
  if(c.execution_state==='WATCH_BAND')return `WAIT — current Hard Rock price is outside the Secondary band; need ${fmtAmericanPrice(c.downgrade_at)} or better`;
  if(c.execution_state==='WAIT_PRICE_BANDS')return 'WAIT — executable price bands are not fully resolved';
  if(proj.data_quality<65||(proj.coverage_score??0)<58)return 'WAIT / PASS FOR CONFIRMATION';
  if(event.sport_key==='baseball_mlb'&&hrs<=4&&!proj.lineups_confirmed)return 'WAIT — starting lineups are not fully confirmed';
  if(c.sanity_flags?.length&&c.independent_disagreement>=.08)return 'WAIT — market disagreement requires stronger confirmation';
  if(hrs>12)return 'WAIT — scheduled verification will re-check closer to game';
  if(fresh!=null&&fresh>45)return 'WAIT — quote may be stale';
  const band=c.play_to!=null?` • play to ${fmtAmericanPrice(c.play_to)} • downgrade ${fmtAmericanPrice(c.downgrade_at)} • pass ${fmtAmericanPrice(c.pass_at)}`:'';
  return `BET NOW if target-book line still matches${band}`;
}
function finalVerification(proj,c){ const flags=[]; if(c.data_quality_grade==='C')flags.push('Data Freshness Gate is C'); if((c.estimated_ev??0)<=0)flags.push('calibrated estimated EV is non-positive'); if((c.adjusted_edge??0)<(c.cushion??0))flags.push('adjusted edge is below the market-specific required cushion'); if(proj.data_quality<80)flags.push('data quality below Core threshold'); if((c.market_coverage??proj.coverage_score??0)<76)flags.push('market-specific model coverage below Core threshold'); if((c.market_edge_count??proj.independent_edge_count)<2)flags.push('fewer than two market-specific independent edges'); if((c.market_support_strength??0)<42)flags.push('market-specific support strength is below the Secondary threshold'); if((c.market_effective_agreement??proj.effective_agreement??proj.model_agreement)<69)flags.push('market-specific effective agreement below Core threshold'); if(c.market_inside_fair_range)flags.push('market price remains inside the calibrated uncertainty band'); if(!c.hard_rock)flags.push('Hard Rock price not verified'); if(c.sanity_flags?.length)flags.push(c.sanity_flags[0]); if(proj.risks.length)flags.push(proj.risks[0]); const stress=c.stress_test?` Stress ${c.stress_test.score}/100 (${c.stress_test.secondary_survivals}/4 adverse scenarios retain Secondary economics).`:''; const exec=`Execution: play-to ${fmtAmericanPrice(c.play_to)}, downgrade ${fmtAmericanPrice(c.downgrade_at)}, pass ${fmtAmericanPrice(c.pass_at)}; state ${c.execution_state||'—'}; freshness ${c.data_quality_grade||'—'}.${stress}`; return flags.length?`Caution: ${[...new Set(flags)].join('; ')}. ${exec}`:`Core release gates checked: data quality, coverage, effective agreement, two-edge gate, uncertainty-band separation, market sanity, price cushion, target book, and failure paths. ${exec}`; }


function settledBetOutcome(record,score){
  if(!score||!score.final)return null;
  const hs=Number(score.home_score),as=Number(score.away_score); if(!Number.isFinite(hs)||!Number.isFinite(as))return null;
  const market=record.market,sel=String(record.selection||''),point=Number(record.point),inn=mlbPeriodInnings(market),base=marketBase(market);
  const usePeriod=inn!=null&&score.period_scores&&score.period_scores[inn],pScore=usePeriod?score.period_scores[inn]:null; const H=usePeriod?Number(pScore.home):hs,A=usePeriod?Number(pScore.away):as;
  let z=0;
  if(base==='h2h'){
    const homeSel=sameTeam(sel,record.home_team),awaySel=sameTeam(sel,record.away_team);
    if(!homeSel&&!awaySel)return null;
    z=homeSel?H-A:A-H;
  } else if(base==='spreads'){
    const homeSel=sameTeam(sel,record.home_team),awaySel=sameTeam(sel,record.away_team);
    if((!homeSel&&!awaySel)||!Number.isFinite(point))return null;
    z=(homeSel?H-A:A-H)+point;
  } else if(base==='totals'){
    if(!Number.isFinite(point))return null;
    z=H+A-point;
    if(sel.toLowerCase()==='under')z=-z;
  } else return null;
  return z>1e-9?'WIN':z<-1e-9?'LOSS':'PUSH';
}
async function resolveFinalScore(record){
  try{
    if(record.sport_key==='baseball_mlb'){
      const data=await mlbSchedule(record.commence_time);
      const g=mlbGameMatch(data,{home_team:record.home_team,away_team:record.away_team});
      if(!g)return {final:false,status:'NOT_FOUND'};
      const final=g.status?.abstractGameState==='Final'||g.status?.detailedState==='Final'; let period_scores={};
      if(final&&g.gamePk){try{const feed=await cachedJson(`https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`,24*3600*1000),innings=feed.liveData?.linescore?.innings||[];let hh=0,aa=0;for(let i=0;i<Math.min(7,innings.length);i++){hh+=num(innings[i]?.home?.runs,0);aa+=num(innings[i]?.away?.runs,0);if([1,3,5,7].includes(i+1))period_scores[i+1]={home:hh,away:aa};}}catch{}}
      return {final, status:g.status?.detailedState||g.status?.abstractGameState||'', home_score:num(g.teams?.home?.score), away_score:num(g.teams?.away?.score), period_scores, source:'MLB Stats API'};
    }
    const cfg=ESPN[record.sport_key]; if(!cfg)return {final:false,status:'NO_FREE_RESULT_PROVIDER'};
    const board=await espnBoard(cfg,record.commence_time);
    const e=espnEventMatch(board,{home_team:record.home_team,away_team:record.away_team});
    if(!e)return {final:false,status:'NOT_FOUND'};
    const c=e.competitions?.[0],st=c?.status?.type||e.status?.type||{};
    const h=(c?.competitors||[]).find(x=>x.homeAway==='home'),a=(c?.competitors||[]).find(x=>x.homeAway==='away');
    const final=!!(st.completed||st.name==='STATUS_FINAL');
    return {final,status:st.description||st.detail||st.name||'',home_score:num(h?.score),away_score:num(a?.score),source:'ESPN structured scoreboard'};
  }catch(err){ return {final:false,status:'ERROR',error:err.message}; }
}

async function scanSlate(events,opts={}){
  const allowDeepMarkets=opts.allowDeepMarkets!==false, deepCreditCap=Math.max(0,Math.min(MAX_DEEP_MARKET_CREDITS,Number(opts.deepCreditCap??MAX_DEEP_MARKET_CREDITS))), deepGameCap=Math.max(0,Math.min(MAX_DEEP_MARKET_GAMES,Number(opts.deepGameCap??MAX_DEEP_MARKET_GAMES)));
  const capped=pregameOnly(events).slice(0,MAX_SCAN_GAMES), prelim=[];
  for(const e of capped){ try{const proj=await analyzeEvent(e); prelim.push({event:sanitizeEvent(e),projection:proj});}catch(err){prelim.push({event:sanitizeEvent(e),projection:lowInfoProjection(e,err.message,30)});} }
  let deepMeta={enabled:false,games:0,markets:[],quota_remaining:LAST_ODDS_META?.remaining??null,note:'Featured markets only.'};
  if(allowDeepMarkets&&deepCreditCap>0&&deepGameCap>0&&capped.some(e=>e.sport_key==='baseball_mlb')&&ODDS_KEY){
    const maxN=Math.min(deepGameCount(),deepGameCap), candidates=prelim.filter(a=>a.event.sport_key==='baseball_mlb'&&a.projection?.f5).map(a=>({...a,research_priority:mlbDeepPriority(a.projection)})).sort((a,b)=>b.research_priority-a.research_priority);
    const ranked=candidates.filter((a,i)=>i<1||a.research_priority>=2.15).slice(0,maxN); let credits=0,got=0; const marketsUsed=new Set();
    for(let i=0;i<ranked.length;i++){const a=ranked[i],sets=[['h2h_1st_5_innings','spreads_1st_5_innings','totals_1st_5_innings']]; if(i===0&&Number(LAST_ODDS_META?.remaining||999)>180)sets.push(['h2h_1st_3_innings','spreads_1st_3_innings','totals_1st_3_innings','totals_1st_1_innings']); for(const ks of sets){if(credits+ks.length>deepCreditCap)continue;try{const ex=await deepEventOdds(a.event,ks.join(','));credits+=ks.length;ks.forEach(k=>marketsUsed.add(k));if(ex?.bookmakers?.length){a.event=mergeEventMarkets(a.event,ex);got++;}}catch(err){a.deep_market_error=err.message;}}}
    // copy enriched events back to prelim by id
    for(const r of ranked){const idx=prelim.findIndex(x=>x.event.id===r.event.id);if(idx>=0)prelim[idx].event=r.event;}
    deepMeta={enabled:true,games:new Set(ranked.filter(r=>(r.event.bookmakers||[]).some(b=>(b.markets||[]).some(m=>isMlbPeriodMarket(m.key)))).map(r=>r.event.id)).size,requested_games:ranked.length,credits_budget:deepCreditCap,credits_attempted:credits,markets:[...marketsUsed],quota_remaining:LAST_ODDS_META?.remaining??null,note:`Research Budget Engine spent up to ${credits}/${deepCreditCap} deep-market credits on ${ranked.length} evidence-priority MLB game(s).`};
  }
  const analyses=prelim.map(a=>({event:a.event,projection:a.projection,market:chooseMarket(a.event,a.projection),deep_market_error:a.deep_market_error||null}));
  const valid=analyses.map(a=>a.market.best).filter(Boolean),extreme=valid.filter(c=>(c.independent_disagreement||0)>=.10); const extremeRatio=extreme.length/Math.max(1,valid.length),isNcaaf=capped.some(e=>e.sport_key==='americanfootball_ncaaf'),isMlb=capped.some(e=>e.sport_key==='baseball_mlb'); const slateSanity={triggered:extreme.length>=3&&extremeRatio>=.30,severe:isNcaaf&&extreme.length>=4&&extremeRatio>=.40,extreme_count:extreme.length,candidate_count:valid.length,ratio:extremeRatio,message:''}; if(slateSanity.triggered){slateSanity.message=slateSanity.severe?`Market Sanity Firewall ESCALATED: ${extreme.length} of ${valid.length} top NCAAF candidates show ≥10-point independent/market disagreement. Extreme low-evidence candidates are CUT; other extreme candidates are capped at WATCH until stronger confirmation.`:`Market Sanity Firewall triggered: ${extreme.length} of ${valid.length} top candidates show ≥10-point independent/market disagreement. Extreme candidates are capped at WATCH until stronger confirmation.`; for(const a of analyses){const c=a.market.best;if(!c)continue; if(slateSanity.severe&&(c.independent_disagreement||0)>=.10&&((c.market_support_strength||0)<60||(c.market_coverage||0)<75||(c.market_edge_count||0)<2)){c.tier='PASS';c.sanity_flags=[...(c.sanity_flags||[]),slateSanity.message,'Slate-level evidence gate: extreme disagreement plus weak support/coverage/edge breadth is an automatic CUT.'];} else if((c.independent_disagreement||0)>=.08&&['CORE','SECONDARY'].includes(c.tier)){c.tier='WATCH';c.sanity_flags=[...(c.sanity_flags||[]),slateSanity.message];}}
    // MLB slate hygiene: when the sanity firewall is active, keep only the three
    // strongest WATCH candidates visible and CUT the rest. This prevents a long
    // watchlist from looking like hidden action when the market/model conflict is broad.
    if(isMlb){
      const watches=analyses.filter(a=>a.market.best&&a.market.best.tier==='WATCH').sort((a,b)=>candidateRank(b.market.best)-candidateRank(a.market.best));
      for(const a of watches.slice(3)){a.market.best.tier='PASS';a.market.best.sanity_flags=[...(a.market.best.sanity_flags||[]),'MLB watchlist-cap gate: Market Sanity Firewall is active, so only the top three WATCH candidates remain visible; this candidate is an automatic CUT for slate hygiene.'];}
      if(watches.length>3)slateSanity.message += ` MLB watchlist cap active: only the top 3 WATCH candidates remain visible; ${watches.length-3} additional HOLD candidates were CUT.`;
    }
  }
  const released=[]; const passes=[]; for(const a of analyses){ const c=a.market.best,p=a.projection; if(!c||c.tier==='PASS'){passes.push({event_id:a.event.id,matchup:`${a.event.away_team} @ ${a.event.home_team}`,reason:!c?'No verified market matched the independent projection.':((c.sanity_flags||[]).find(x=>/automatic CUT|no-support gate|comparable-data gate|Slate-level evidence gate|MLB support gate|MLB probable-starter gate|MLB watchlist-cap gate/i.test(x))||`Release gates failed: DQ ${p.data_quality.toFixed(0)}, market coverage ${(c.market_coverage??p.coverage_score??0).toFixed(0)}, market effective agreement ${(c.market_effective_agreement??p.effective_agreement??p.model_agreement).toFixed(0)}, support ${(c.market_support_strength??0).toFixed(0)}, market-specific edges ${c.market_edge_count??p.independent_edge_count}, adjusted edge ${fmtPct(c.adjusted_edge)} vs cushion ${fmtPct(c.cushion)}.`)});continue;} released.push({event_id:a.event.id,event:a.event,projection:p,...c,why:buildWhy(p,c),how_it_loses:decision.lossPaths(c,p.risks),timing:timing(a.event,c,p),final_verification:finalVerification(p,c),units:c.tier==='CORE'?1:c.tier==='SECONDARY'?.5:0}); }
  decision.applySlateDiscipline(released);
  const parlay=decision.buildParlay(released);
  const decisionIntelligence=decision.summary(released,parlay);
  const grade=released.filter(x=>x.tier==='CORE').length>=2?'A':released.some(x=>x.tier==='CORE')?'B+':released.some(x=>x.tier==='SECONDARY')?'B':'PASS-HEAVY';
  const slateCandidates=analyses.map(a=>a.market?.best).filter(Boolean),slateMetrics={
    games:analyses.length,
    avg_data_quality:mean(analyses.map(a=>a.projection?.data_quality))||0,
    avg_coverage:mean(slateCandidates.map(c=>c.market_coverage))||0,
    avg_support:mean(slateCandidates.map(c=>c.market_support_strength))||0,
    avg_decision_quality:mean(slateCandidates.map(c=>c.decision_quality))||0,
    hard_rock_coverage:safeDiv(slateCandidates.filter(c=>c.hard_rock).length,Math.max(1,slateCandidates.length),0),
    extreme_disagreements:slateCandidates.filter(c=>(c.independent_disagreement||0)>=.10).length
  };
  return {version:VERSION,generated_at:new Date().toISOString(),decision_intelligence:decisionIntelligence,slate_grade:grade,slate_sanity:slateSanity,slate_metrics:slateMetrics,deep_market_scan:deepMeta,plays:released,passes,parlay,analyses}; }

module.exports = {
  VERSION, MODELS, SPORTS,
  config:()=>({oddsReady:!!ODDS_KEY,cfbdReady:!!CFBD_KEY,bookmakers:ODDS_BOOKMAKERS,maxScanGames:MAX_SCAN_GAMES,maxDeepMarketGames:MAX_DEEP_MARKET_GAMES,maxDeepMarketCredits:MAX_DEEP_MARKET_CREDITS,oddsCacheTtlMs:ODDS_CACHE_TTL_MS,minOddsRefreshMs:MIN_ODDS_REFRESH_MS,oddsQuotaReserve:ODDS_QUOTA_RESERVE,lastOddsMeta:LAST_ODDS_META}),
  oddsFetch, oddsQuotaProbe, refreshEventMarkets, pregameOnly, sanitizeEvent, scanSlate, resolveFinalScore, settledBetOutcome,
  sameTeam, teamSimilarity, findRatingMatch, classificationMatch, resolvedNcaafClass, cfbdGameMatch, ncaafCrossClassBaseline, marketBase, mlbPeriodInnings, probToAmerican, executionBands, dataFreshnessGrade, starterRegression, analyzeEvent
};
