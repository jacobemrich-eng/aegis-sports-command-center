const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ODDS_KEY = process.env.ODDS_API_KEY || '';
const CFBD_KEY = process.env.CFBD_API_KEY || '';
const ODDS_BOOKMAKERS = process.env.ODDS_BOOKMAKERS || 'hardrockbet_fl,fanduel,draftkings,bovada,betmgm,espnbet,fanatics';
const MAX_SCAN_GAMES = Math.max(1, Math.min(40, Number(process.env.MAX_SCAN_GAMES || 15)));
const TARGET_BOOK = 'hardrockbet_fl';
const VERSION = '3.0.0-zero-cost';

const MODELS = [
  ['SB101 AEGIS v1.0','governance','Master release/governance layer for calibrated EV decisions.'],
  ['Precision Mode','execution','Bankroll-protection mode with tight Core/Secondary caps.'],
  ['Independent Thesis Model','projection','Locks sports direction before sportsbook price.'],
  ['Model Agreement Score','governance','Penalizes major disagreement across relevant modules.'],
  ['Two-Independent-Edges Gate','governance','Requires multiple independent drivers for Core.'],
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
  ['Daily Results Audit System','audit','Registry-ready for persistent result storage in a later version.'],
  ['Model Calibration / Development','audit','Evidence-based adjustments without single-game overfitting.'],
  ['Chat-First Development Policy','governance','Keeps research logic auditable before production porting.'],
  ['VantageIQ / SBOS Implementation Layer','platform','Production-facing implementation and display layer.']
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
function normalizeTeam(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\b(the|fc|club|university|college)\b/g,' ').replace(/\s+/g,' ').trim(); }
function tokens(s){ return new Set(normalizeTeam(s).split(' ').filter(x=>x.length>1)); }
function teamSimilarity(a,b){ const A=tokens(a),B=tokens(b); if(!A.size||!B.size)return 0; const na=normalizeTeam(a),nb=normalizeTeam(b); if(na===nb)return 1; if(na.includes(nb)||nb.includes(na))return .92; let inter=0; for(const x of A)if(B.has(x))inter++; return inter/Math.max(A.size,B.size); }
function sameTeam(a,b){ return teamSimilarity(a,b)>=0.5; }
function send(res,status,data,type='application/json'){ res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(type.startsWith('application/json')?JSON.stringify(data):data); }
function readBody(req){ return new Promise((resolve,reject)=>{let s='';req.on('data',d=>{s+=d;if(s.length>5e6)req.destroy();});req.on('end',()=>resolve(s));req.on('error',reject);}); }

async function fetchWithTimeout(url,options={},timeout=9000){ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); try{return await fetch(url,{...options,signal:c.signal,headers:{'User-Agent':'SB101-AEGIS-Zero-Cost/3.0','Accept':'application/json,text/plain,*/*',...(options.headers||{})}});}finally{clearTimeout(t);} }
async function cachedJson(url,ttl=300000,options={}){ const k=`json|${url}|${JSON.stringify(options.headers||{})}`; const hit=CACHE.get(k); if(hit&&hit.exp>now())return hit.data; const r=await fetchWithTimeout(url,options); if(!r.ok)throw new Error(`Data source ${r.status}: ${url}`); const d=await r.json(); CACHE.set(k,{exp:now()+ttl,data:d}); return d; }
async function cachedText(url,ttl=3600000,options={}){ const k=`text|${url}`; const hit=CACHE.get(k); if(hit&&hit.exp>now())return hit.data; const r=await fetchWithTimeout(url,options,12000); if(!r.ok)throw new Error(`Data source ${r.status}: ${url}`); const d=await r.text(); CACHE.set(k,{exp:now()+ttl,data:d}); return d; }

async function oddsFetch(endpoint){
  if(!ODDS_KEY)throw new Error('ODDS_API_KEY is not configured.');
  const join=endpoint.includes('?')?'&':'?';
  const url=`https://api.the-odds-api.com/v4/${endpoint}${join}apiKey=${encodeURIComponent(ODDS_KEY)}`;
  const r=await fetchWithTimeout(url,{},10000); const text=await r.text(); let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!r.ok)throw new Error(data.message||data.error||`Odds API ${r.status}`);
  return {data,meta:{remaining:r.headers.get('x-requests-remaining'),used:r.headers.get('x-requests-used'),last:r.headers.get('x-requests-last')}};
}
function isHardRock(book){ return String(book?.key||'').startsWith('hardrockbet'); }
function sanitizeEvent(e){ return {id:e.id,sport_key:e.sport_key,sport_title:e.sport_title,commence_time:e.commence_time,home_team:e.home_team,away_team:e.away_team,bookmakers:e.bookmakers||[]}; }
function pregameOnly(events){ const t=Date.now()+60*1000; return (events||[]).filter(e=>new Date(e.commence_time).getTime()>t); }

function quotePairs(event,marketKey){
  const pairs=[];
  for(const b of event.bookmakers||[]){
    for(const m of b.markets||[]){ if(m.key!==marketKey)continue; const outcomes=m.outcomes||[]; if(outcomes.length<2)continue; pairs.push({book:b.title,book_key:b.key,hard_rock:isHardRock(b),market_key:m.key,last_update:m.last_update||b.last_update||null,outcomes}); }
  }
  return pairs;
}
function fairTwoWay(a,b){ const pa=americanToProb(a),pb=americanToProb(b); if(pa==null||pb==null)return [null,null]; const s=pa+pb; return [pa/s,pb/s]; }
function bestPrice(a,b){ if(a==null)return b;if(b==null)return a; return Number(a)>Number(b)?a:b; }

async function espnBoard(cfg,date){ const url=`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard?dates=${ymd(date)}&limit=1000`; return cachedJson(url,120000); }
function espnEventMatch(board,event){ let best=null,score=0; for(const x of board.events||[]){ const c=x.competitions?.[0]; if(!c)continue; const comps=c.competitors||[]; const h=comps.find(z=>z.homeAway==='home'),a=comps.find(z=>z.homeAway==='away'); if(!h||!a)continue; const s=(teamSimilarity(h.team?.displayName,event.home_team)+teamSimilarity(a.team?.displayName,event.away_team))/2; if(s>score){score=s;best=x;} } return score>=.48?best:null; }
function extractEspnTeam(eventObj,side){ const c=eventObj?.competitions?.[0]; const x=(c?.competitors||[]).find(z=>z.homeAway===side); if(!x)return null; return {id:String(x.team?.id||''),name:x.team?.displayName||'',abbr:x.team?.abbreviation||'',score:num(x.score),records:(x.records||[]).map(r=>({name:r.name,summary:r.summary,type:r.type})),winner:!!x.winner}; }
function espnVenue(eventObj){ const c=eventObj?.competitions?.[0],v=c?.venue||{}; return {name:v.fullName||null,city:v.address?.city||null,state:v.address?.state||null,indoor:!!v.indoor}; }
async function espnTeamSchedule(cfg,teamId,year){ if(!teamId)return null; const url=`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/teams/${encodeURIComponent(teamId)}/schedule?season=${year}`; try{return await cachedJson(url,15*60*1000);}catch{return null;} }
function scheduleMetrics(data,teamId,before){ const rows=[]; for(const e of data?.events||[]){ const c=e.competitions?.[0]; if(!c)continue; if(new Date(e.date||c.date).getTime()>=new Date(before).getTime())continue; const st=c.status?.type||{}; if(!(st.completed||st.name==='STATUS_FINAL'))continue; const me=(c.competitors||[]).find(x=>String(x.team?.id)===String(teamId)); if(!me)continue; const opp=(c.competitors||[]).find(x=>String(x.team?.id)!==String(teamId)); const pf=num(me.score),pa=num(opp?.score); if(pf==null||pa==null)continue; rows.push({date:e.date||c.date,pf,pa,margin:pf-pa,home:me.homeAway==='home',win:pf>pa}); }
  rows.sort((a,b)=>new Date(a.date)-new Date(b.date)); const recent=rows.slice(-5); return {games:rows.length,wins:rows.filter(x=>x.win).length,pf:mean(rows.map(x=>x.pf)),pa:mean(rows.map(x=>x.pa)),margin:mean(rows.map(x=>x.margin)),recentMargin:mean(recent.map(x=>x.margin)),recentPF:mean(recent.map(x=>x.pf)),recentPA:mean(recent.map(x=>x.pa)),volatility:stdev(rows.map(x=>x.margin)),rows}; }
async function espnSummary(cfg,id){ if(!id)return null; const url=`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/summary?event=${encodeURIComponent(id)}`; try{return await cachedJson(url,120000);}catch{return null;} }
async function espnNews(cfg){ const url=`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/news?limit=100`; try{return await cachedJson(url,5*60*1000);}catch{return {articles:[]};} }
function teamNews(team,news){ const name=normalizeTeam(team),tt=[...tokens(team)].filter(x=>x.length>=4); const critical=/injur|ruled out|out for|questionable|doubtful|surgery|suspend|scratch|will not play|won't play|limited|minutes restriction|pitch count|starter|rotation|qb2|qb3|joint practice|rested|illness/i; const rows=[]; for(const a of news?.articles||[]){ const text=[a.headline,a.description,a.story].filter(Boolean).join(' '); const low=normalizeTeam(text); if((name&&low.includes(name))||tt.some(t=>low.includes(t))){ rows.push({headline:a.headline||'News',description:a.description||'',critical:critical.test(text),url:(a.links?.web?.href||a.links?.api?.href||'')}); } } return rows.slice(0,8); }
function summaryRisk(summary,team){ const raw=JSON.stringify(summary||{}); const low=normalizeTeam(raw); const toks=[...tokens(team)].filter(x=>x.length>=4); const mentions=toks.filter(t=>low.includes(t)).length; const injuryHits=(raw.match(/injur|questionable|doubtful|out for|inactive|suspend/gi)||[]).length; return {mentions,injuryHits}; }

async function cfbdAll(year){ if(!CFBD_KEY)return null; const headers={Authorization:`Bearer ${CFBD_KEY}`}; const fetchOne=async(path)=>{try{return await cachedJson(`https://api.collegefootballdata.com${path}`,6*3600*1000,{headers});}catch{return [];}}; const [sp,core,elo]=await Promise.all([fetchOne(`/ratings/sp?year=${year}`),fetchOne(`/ratings/core?year=${year}`),fetchOne(`/ratings/elo?year=${year}`)]); return {sp,core,elo}; }
function findRating(rows,team){ let best=null,s=0; for(const r of rows||[]){ const q=teamSimilarity(r.team,team); if(q>s){s=q;best=r;} } return s>=.45?best:null; }

function parseCsvLine(line){ const out=[]; let cur='',q=false; for(let i=0;i<line.length;i++){const ch=line[i]; if(ch==='"'){ if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;} else if(ch===','&&!q){out.push(cur);cur='';} else cur+=ch;} out.push(cur); return out; }
async function nflverseGames(){ try{ const text=await cachedText('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',6*3600*1000); const lines=text.trim().split(/\r?\n/); const h=parseCsvLine(lines[0]); return lines.slice(1).map(l=>{const a=parseCsvLine(l),o={};h.forEach((k,i)=>o[k]=a[i]);return o;}); }catch{return [];} }
function nflverseMetrics(games,team,before,preseason=false){ const aliases={
  'arizona cardinals':'ARI','atlanta falcons':'ATL','baltimore ravens':'BAL','buffalo bills':'BUF','carolina panthers':'CAR','chicago bears':'CHI','cincinnati bengals':'CIN','cleveland browns':'CLE','dallas cowboys':'DAL','denver broncos':'DEN','detroit lions':'DET','green bay packers':'GB','houston texans':'HOU','indianapolis colts':'IND','jacksonville jaguars':'JAX','kansas city chiefs':'KC','las vegas raiders':'LV','los angeles chargers':'LAC','los angeles rams':'LA','miami dolphins':'MIA','minnesota vikings':'MIN','new england patriots':'NE','new orleans saints':'NO','new york giants':'NYG','new york jets':'NYJ','philadelphia eagles':'PHI','pittsburgh steelers':'PIT','san francisco 49ers':'SF','seattle seahawks':'SEA','tampa bay buccaneers':'TB','tennessee titans':'TEN','washington commanders':'WAS'};
  const code=aliases[normalizeTeam(team)]; if(!code)return null; const rows=[]; for(const g of games){ if(new Date(g.gameday||g.game_date||0).getTime()>=new Date(before).getTime())continue; const gt=String(g.game_type||'').toUpperCase(); if(preseason){ if(!['PRE','PS','PRESEASON'].includes(gt))continue; } else { if(gt&&gt!=='REG'&&gt!=='WC'&&gt!=='DIV'&&gt!=='CON'&&gt!=='SB')continue; }
    const h=g.home_team,a=g.away_team; if(h!==code&&a!==code)continue; const hs=num(g.home_score),as=num(g.away_score); if(hs==null||as==null)continue; const pf=h===code?hs:as,pa=h===code?as:hs; rows.push({date:g.gameday,pf,pa,margin:pf-pa,win:pf>pa}); }
  rows.sort((a,b)=>new Date(a.date)-new Date(b.date)); const recent=rows.slice(-5); return {games:rows.length,wins:rows.filter(x=>x.win).length,pf:mean(rows.map(x=>x.pf)),pa:mean(rows.map(x=>x.pa)),margin:mean(rows.map(x=>x.margin)),recentMargin:mean(recent.map(x=>x.margin)),volatility:stdev(rows.map(x=>x.margin)),rows}; }

async function openMeteoGeo(city,state){ if(!city)return null; const q=encodeURIComponent(`${city}${state?`, ${state}`:''}`); try{const d=await cachedJson(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`,24*3600*1000); const r=d.results?.[0]; return r?{lat:r.latitude,lon:r.longitude,name:r.name}:null;}catch{return null;} }
async function openMeteo(lat,lon,time){ if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(hoursUntil(time))>24*7)return null; const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m&timezone=UTC&forecast_days=7`; try{const d=await cachedJson(url,30*60*1000); const times=d.hourly?.time||[]; if(!times.length)return null; const target=new Date(time).getTime(); let idx=0,best=Infinity; times.forEach((t,i)=>{const z=Math.abs(new Date(t+'Z').getTime()-target);if(z<best){best=z;idx=i;}}); return {temperature_c:num(d.hourly.temperature_2m?.[idx]),precip_probability:num(d.hourly.precipitation_probability?.[idx]),wind_kph:num(d.hourly.wind_speed_10m?.[idx]),gust_kph:num(d.hourly.wind_gusts_10m?.[idx])}; }catch{return null;} }

async function mlbSchedule(date){ const u=`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${isoDate(date)}&hydrate=probablePitcher,team,venue`; return cachedJson(u,120000); }
function mlbGameMatch(data,event){ let best=null,s=0; for(const day of data.dates||[])for(const g of day.games||[]){ const q=(teamSimilarity(g.teams?.home?.team?.name,event.home_team)+teamSimilarity(g.teams?.away?.team?.name,event.away_team))/2; if(q>s){s=q;best=g;} } return s>=.5?best:null; }
async function mlbTeamStats(id,group,year){ if(!id)return null; try{return await cachedJson(`https://statsapi.mlb.com/api/v1/teams/${id}/stats?stats=season&group=${group}&season=${year}`,30*60*1000);}catch{return null;} }
async function mlbPersonStats(id,year){ if(!id)return null; try{return await cachedJson(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=${year}`,30*60*1000);}catch{return null;} }
function statRoot(d){ return d?.stats?.[0]?.splits?.[0]?.stat||{}; }
function baseballInnings(s){ if(s==null)return null; const [a,b='0']=String(s).split('.'); const outs=b==='1'?1:b==='2'?2:0; return num(a,0)+outs/3; }
async function mlbRecentAll(eventTime){ const end=isoDate(addDays(eventTime,-1)),start=isoDate(addDays(eventTime,-16)); try{return await cachedJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}&hydrate=linescore`,10*60*1000);}catch{return null;} }
function mlbRecentMetrics(data,teamId){ const rows=[]; for(const d of data?.dates||[])for(const g of d.games||[]){ if(g.status?.abstractGameState!=='Final')continue; const home=g.teams?.home,away=g.teams?.away; const side=String(home?.team?.id)===String(teamId)?home:String(away?.team?.id)===String(teamId)?away:null; const opp=side===home?away:home; if(!side||side.score==null||opp?.score==null)continue; rows.push({date:g.gameDate,pf:num(side.score),pa:num(opp.score),margin:num(side.score)-num(opp.score),win:num(side.score)>num(opp.score)}); } rows.sort((a,b)=>new Date(a.date)-new Date(b.date)); const recent=rows.slice(-10); return {games:recent.length,wins:recent.filter(x=>x.win).length,pf:mean(recent.map(x=>x.pf)),pa:mean(recent.map(x=>x.pa)),margin:mean(recent.map(x=>x.margin)),volatility:stdev(recent.map(x=>x.margin)),rows:recent}; }
async function mlbLineups(gamePk){ if(!gamePk)return {confirmed:false}; try{const d=await cachedJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,60000); const h=d.liveData?.boxscore?.teams?.home?.battingOrder||[],a=d.liveData?.boxscore?.teams?.away?.battingOrder||[]; return {confirmed:h.length>=9&&a.length>=9,homeCount:h.length,awayCount:a.length};}catch{return {confirmed:false};} }

function module(name,value,side,evidence,confidence=70){ return {name,value:Number(value)||0,side,evidence,confidence:clamp(confidence)}; }
function agreement(mods){ const usable=mods.filter(m=>Math.abs(m.value)>=0.08); if(!usable.length)return 50; const pos=usable.filter(m=>m.value>0).reduce((s,m)=>s+Math.abs(m.value)*m.confidence/100,0); const neg=usable.filter(m=>m.value<0).reduce((s,m)=>s+Math.abs(m.value)*m.confidence/100,0); const total=pos+neg; return total?clamp(50+50*Math.abs(pos-neg)/total):50; }
function edgeCount(mods,homeLean){ return mods.filter(m=>(homeLean?m.value>0:m.value<0)&&Math.abs(m.value)>=0.15&&m.confidence>=55).length; }
function weatherSummary(w){ if(!w)return 'Weather unavailable or not applicable.'; return `${w.temperature_c!=null?`${Math.round(w.temperature_c*9/5+32)}°F`:''}${w.wind_kph!=null?`, wind ${Math.round(w.wind_kph/1.609)} mph`:''}${w.precip_probability!=null?`, precip ${Math.round(w.precip_probability)}%`:''}`; }
function weatherTotalAdjustment(sport,w,indoor){ if(!w||indoor)return 0; const mph=(w.wind_kph||0)/1.609; const f=w.temperature_c!=null?w.temperature_c*9/5+32:null; if(sport.startsWith('americanfootball'))return (mph>=20?-3:mph>=15?-1.5:0)+(w.precip_probability>=60?-1.5:0)+(f!=null&&f<=25?-1:0);
  if(sport==='baseball_mlb')return (f!=null?(f-70)*0.025:0)+(mph>=18?0.3:0); return 0; }

async function analyzeMLB(event){
  const year=seasonYear(event.commence_time),sched=await mlbSchedule(event.commence_time),g=mlbGameMatch(sched,event); const sources=[{name:'MLB Stats API',url:'https://statsapi.mlb.com/api/v1/schedule'}];
  if(!g)return lowInfoProjection(event,'MLB schedule match unavailable',42,['MLB game identity could not be matched to the public Stats API.']);
  const homeId=g.teams.home.team.id,awayId=g.teams.away.team.id; const hp=g.teams.home.probablePitcher,ap=g.teams.away.probablePitcher;
  const [hh,hpStaff,ah,apStaff,hsp,asp,recent,lineups]=await Promise.all([
    mlbTeamStats(homeId,'hitting',year),mlbTeamStats(homeId,'pitching',year),mlbTeamStats(awayId,'hitting',year),mlbTeamStats(awayId,'pitching',year),
    mlbPersonStats(hp?.id,year),mlbPersonStats(ap?.id,year),mlbRecentAll(event.commence_time),hoursUntil(event.commence_time)<=8?mlbLineups(g.gamePk):Promise.resolve({confirmed:false})
  ]);
  const H=statRoot(hh),HP=statRoot(hpStaff),A=statRoot(ah),AP=statRoot(apStaff),HSP=statRoot(hsp),ASP=statRoot(asp);
  const hr=mlbRecentMetrics(recent,homeId),ar=mlbRecentMetrics(recent,awayId);
  let lat=num(g.venue?.location?.defaultCoordinates?.latitude),lon=num(g.venue?.location?.defaultCoordinates?.longitude); if(lat==null||lon==null){ const geo=await openMeteoGeo(g.venue?.location?.city,g.venue?.location?.stateAbbrev); if(geo){lat=geo.lat;lon=geo.lon;} }
  const weather=await openMeteo(lat,lon,event.commence_time); if(weather)sources.push({name:'Open-Meteo',url:'https://open-meteo.com/'});
  const lg=4.35; const hRpg=num(H.runsPerGame,safeDiv(H.runs,H.gamesPlayed,lg)); const aRpg=num(A.runsPerGame,safeDiv(A.runs,A.gamesPlayed,lg)); const hEra=num(HP.era,4.35),aEra=num(AP.era,4.35); const hspEra=num(HSP.era,hEra),aspEra=num(ASP.era,aEra);
  const hOps=num(H.ops,.720),aOps=num(A.ops,.720); const hOff=.55*safeDiv(hRpg,lg,1)+.45*safeDiv(hOps,.720,1); const aOff=.55*safeDiv(aRpg,lg,1)+.45*safeDiv(aOps,.720,1);
  const homePitch=.55*safeDiv(hEra,4.35,1)+.45*safeDiv(hspEra,4.35,1); const awayPitch=.55*safeDiv(aEra,4.35,1)+.45*safeDiv(aspEra,4.35,1);
  const wAdj=weatherTotalAdjustment('baseball_mlb',weather,false); let awayRuns=lg*aOff*homePitch+0.5*wAdj; let homeRuns=(lg*hOff*awayPitch)+0.18+0.5*wAdj; awayRuns=clamp(awayRuns,1.7,8.5);homeRuns=clamp(homeRuns,1.7,8.8);
  const margin=homeRuns-awayRuns,total=homeRuns+awayRuns; const homeProb=clamp01(normCdf(margin/2.65));
  const mods=[
    module('Starting pitcher', (aspEra-hspEra)/2.5, aspEra>hspEra?'home':'away',`${hp?.fullName||'Home SP'} ERA ${hspEra.toFixed(2)} vs ${ap?.fullName||'Away SP'} ERA ${aspEra.toFixed(2)}`,hp&&ap?84:45),
    module('Offense', (hOff-aOff)*1.4,hOff>aOff?'home':'away',`Home R/G ${hRpg.toFixed(2)}, OPS ${hOps.toFixed(3)}; away R/G ${aRpg.toFixed(2)}, OPS ${aOps.toFixed(3)}`,82),
    module('Staff pitching / bullpen proxy',(aEra-hEra)/2.8,aEra>hEra?'home':'away',`Home staff ERA ${hEra.toFixed(2)} vs away ${aEra.toFixed(2)}. Free feed does not isolate leverage-reliever availability.`,62),
    module('Recent form',((hr.margin||0)-(ar.margin||0))/4,(hr.margin||0)>(ar.margin||0)?'home':'away',`Last ~10 margin: home ${(hr.margin??0).toFixed(2)}, away ${(ar.margin??0).toFixed(2)}`,60),
    module('Home field',.08,'home','Home-field batting/last-at-bat adjustment.',70)
  ];
  if(weather)mods.push(module('Environment',wAdj/3,wAdj>=0?'over':'under',weatherSummary(weather),65));
  let dq=35+(hh&&ah?18:0)+(hpStaff&&apStaff?12:0)+(hp&&ap&&hsp&&asp?18:0)+(recent?8:0)+(weather?4:0)+(lineups.confirmed?10:0); dq=Math.min(dq,lineups.confirmed?90:82); const uncertainty=clamp(100-dq+(hp&&ap?0:15)+(lineups.confirmed?0:hoursUntil(event.commence_time)<4?8:2)); const agr=agreement(mods); const ec=edgeCount(mods,homeProb>=.5);
  const risks=[]; if(!hp||!ap)risks.push('One or both probable starters are not confirmed.'); if(!lineups.confirmed)risks.push('Starting lineups are not confirmed in the free feed.'); risks.push('Bullpen leverage availability is approximated from team pitching, not verified reliever-by-reliever.'); if(weather?.precip_probability>=60)risks.push('Elevated precipitation risk can alter pitcher usage or game timing.');
  return {event_id:event.id,sport:event.sport_key,away_team:event.away_team,home_team:event.home_team,projected_score:{away:+awayRuns.toFixed(1),home:+homeRuns.toFixed(1)},projected_total:+total.toFixed(1),projected_margin_home:+margin.toFixed(1),home_win_probability:homeProb,data_quality:dq,uncertainty,model_agreement:agr,independent_edge_count:ec,modules:mods,risks,weather,notes:[`Probable starters: ${ap?.fullName||'TBD'} vs ${hp?.fullName||'TBD'}`,lineups.confirmed?'Lineups confirmed by MLB feed.':'Lineups not yet confirmed.'],sources};
}

function lowInfoProjection(event,note,dq=45,risks=[]){ return {event_id:event.id,sport:event.sport_key,away_team:event.away_team,home_team:event.home_team,projected_score:{away:null,home:null},projected_total:null,projected_margin_home:0,home_win_probability:.5,data_quality:dq,uncertainty:100-dq,model_agreement:50,independent_edge_count:0,modules:[],risks:[note,...risks],weather:null,notes:[note],sources:[]}; }

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
  const mods=[]; let ratingMargin=null,advanced=false;
  if(event.sport_key==='americanfootball_ncaaf'&&cfbd){
    const hsp=findRating(cfbd.sp,event.home_team),asp=findRating(cfbd.sp,event.away_team),hc=findRating(cfbd.core,event.home_team),ac=findRating(cfbd.core,event.away_team),he=findRating(cfbd.elo,event.home_team),ae=findRating(cfbd.elo,event.away_team); if(hsp&&asp){ratingMargin=(num(hsp.rating)-num(asp.rating))+cfg.homeAdv; advanced=true; mods.push(module('SP+ / true strength',(num(hsp.rating)-num(asp.rating))/12,num(hsp.rating)>=num(asp.rating)?'home':'away',`SP+ ${event.home_team} ${num(hsp.rating).toFixed(1)} vs ${event.away_team} ${num(asp.rating).toFixed(1)}`,90)); if(hsp.offense&&asp.offense)mods.push(module('Offense / success / explosiveness',(num(hsp.offense.rating)-num(asp.offense.rating))/18,num(hsp.offense.rating)>=num(asp.offense.rating)?'home':'away',`SP+ offense rating ${num(hsp.offense.rating).toFixed(1)} vs ${num(asp.offense.rating).toFixed(1)}`,85)); if(hsp.defense&&asp.defense)mods.push(module('Defense / havoc',(num(asp.defense.rating)-num(hsp.defense.rating))/18,num(hsp.defense.rating)<=num(asp.defense.rating)?'home':'away',`SP+ defense rating ${num(hsp.defense.rating).toFixed(1)} vs ${num(asp.defense.rating).toFixed(1)}`,85)); if(hsp.specialTeams&&asp.specialTeams)mods.push(module('Special teams',(num(hsp.specialTeams.rating)-num(asp.specialTeams.rating))/5,num(hsp.specialTeams.rating)>=num(asp.specialTeams.rating)?'home':'away','CFBD SP+ special-teams component.',75)); }
    if(hc&&ac)mods.push(module('CORE efficiency',(num(hc.overall)-num(ac.overall))/15,num(hc.overall)>=num(ac.overall)?'home':'away',`CORE overall ${num(hc.overall).toFixed(1)} vs ${num(ac.overall).toFixed(1)}`,82)); if(he&&ae)mods.push(module('Elo',(num(he.elo)-num(ae.elo))/250,num(he.elo)>=num(ae.elo)?'home':'away',`Elo ${he.elo||'—'} vs ${ae.elo||'—'}`,74)); sources.push({name:'CollegeFootballData free API',url:'https://api.collegefootballdata.com/'});
  }
  const schedMargin=(hm.margin??0)-(am.margin??0); if(ratingMargin!=null){ const blended=.72*ratingMargin+.28*(schedMargin/2+cfg.homeAdv); const totalBase=homeScore+awayScore; homeScore=totalBase/2+blended/2;awayScore=totalBase/2-blended/2; }
  mods.push(module('Season scoring / efficiency proxy',schedMargin/(event.sport_key==='basketball_wnba'?16:12),schedMargin>=0?'home':'away',`Home PF/PA ${hpf.toFixed(1)}/${hpa.toFixed(1)}; away PF/PA ${apf.toFixed(1)}/${apa.toFixed(1)}`,hm.games>=3&&am.games>=3?78:45));
  const recentDiff=(hm.recentMargin??hm.margin??0)-(am.recentMargin??am.margin??0); mods.push(module('Current form (capped)',recentDiff/(event.sport_key==='basketball_wnba'?18:15),recentDiff>=0?'home':'away',`Recent margin trend: home ${(hm.recentMargin??0).toFixed(1)}, away ${(am.recentMargin??0).toFixed(1)}`,Math.min(65,40+(hm.games+am.games)*2)));
  mods.push(module('Home field / court',cfg.homeAdv/(event.sport_key==='basketball_wnba'?5:7),'home',`Home adjustment ${cfg.homeAdv.toFixed(1)} points.`,70));
  if(hn.some(x=>x.critical)||an.some(x=>x.critical)||hsRisk.injuryHits||asRisk.injuryHits)mods.push(module('Availability / injury signal',0,'neutral','Free structured/news feed contains availability-related language; exact impact may be unresolved.',52));
  const wAdj=weatherTotalAdjustment(event.sport_key,weather,venue.indoor); if(weather&&!venue.indoor)mods.push(module('Weather',wAdj/5,wAdj>=0?'over':'under',weatherSummary(weather),65)); homeScore+=wAdj/2;awayScore+=wAdj/2;
  let margin=homeScore-awayScore,total=homeScore+awayScore; if(event.sport_key==='baseball_kbo'||event.sport_key==='baseball_npb'){homeScore=Math.max(1.4,homeScore);awayScore=Math.max(1.4,awayScore);margin=homeScore-awayScore;total=homeScore+awayScore;}
  let dq=35+(hm.games>=3&&am.games>=3?24:hm.games+am.games>0?12:0)+(summary?6:0)+(news?5:0)+(weather||venue.indoor?5:0)+(advanced?18:0); let cap=78;
  if(event.sport_key==='americanfootball_ncaaf')cap=advanced?90:68;
  if(event.sport_key==='americanfootball_nfl_preseason')cap=hn.concat(an).some(x=>/qb2|qb3|rotation|starter|joint practice|play.*quarter|snap/i.test(`${x.headline} ${x.description}`))?68:58;
  if(event.sport_key==='baseball_kbo')cap=62;if(event.sport_key==='baseball_npb')cap=65;if(event.sport_key==='basketball_wnba')cap=78;
  dq=Math.min(cap,dq); const injuryPenalty=Math.min(12,(hn.filter(x=>x.critical).length+an.filter(x=>x.critical).length)*3+Math.min(6,hsRisk.injuryHits+asRisk.injuryHits)); dq=Math.max(30,dq-injuryPenalty); const uncertainty=clamp(100-dq+(event.sport_key==='americanfootball_nfl_preseason'?18:0)); const homeProb=clamp01(normCdf(margin/cfg.marginSd)); const agr=agreement(mods),ec=edgeCount(mods,homeProb>=.5); const risks=[];
  if((hm.games||0)<3||(am.games||0)<3)risks.push('Small current-season sample in the free schedule feed.'); if(injuryPenalty>0)risks.push('Availability-related news exists but the deterministic engine cannot fully interpret every player impact.'); if(event.sport_key==='americanfootball_nfl_preseason')risks.push('Free structured feeds do not reliably confirm full QB2/QB3 snap plans; large-favorite/Core gates are intentionally strict.'); if((event.sport_key==='baseball_kbo'||event.sport_key==='baseball_npb')&&!hm.games)risks.push('Foreign-league structured data coverage is thin; AEGIS will usually PASS instead of anchoring to the market.');
  return {event_id:event.id,sport:event.sport_key,away_team:event.away_team,home_team:event.home_team,projected_score:{away:+awayScore.toFixed(1),home:+homeScore.toFixed(1)},projected_total:+total.toFixed(1),projected_margin_home:+margin.toFixed(1),home_win_probability:homeProb,data_quality:dq,uncertainty,model_agreement:agr,independent_edge_count:ec,modules:mods,risks,weather,notes:[venue.name?`Venue: ${venue.name}`:'Venue unavailable',advanced?'CFBD advanced ratings active.':'CFBD advanced ratings not active.'],news:[...hn.map(x=>({team:event.home_team,...x})),...an.map(x=>({team:event.away_team,...x}))].slice(0,10),sources};
}

async function analyzeEvent(event){ if(event.sport_key==='baseball_mlb')return analyzeMLB(event); return analyzeESPN(event); }

function marketCushion(sport,market,proj){ let c=market==='h2h'?.025:market==='spreads'?.03:.035; if(sport==='baseball_mlb'&&market==='spreads')c=.04; if(sport==='baseball_npb'&&market==='totals'&&proj.projected_total!=null&&proj.projected_total<=6.5)c=.055; if(sport==='americanfootball_nfl_preseason')c+=.015; if(proj.data_quality<70)c+=.01; return c; }
function uncertaintyShrink(prob,proj){ const q=clamp(proj.data_quality)/100,unc=clamp(proj.uncertainty)/100,rel=Math.max(.18,Math.min(.95,q*(1-.45*unc))); return .5+(prob-.5)*rel; }
function getPairOutcome(pair,name){ return pair.outcomes.find(o=>sameTeam(o.name,name)||String(o.name).toLowerCase()===String(name).toLowerCase()); }
function marketCandidate(event,proj,pair,market){
  const home=event.home_team,away=event.away_team; let sideName,oppName,fairRaw,point=null,fit=0,thesis='';
  if(market==='h2h'){ const homeLean=proj.home_win_probability>=.5; sideName=homeLean?home:away;oppName=homeLean?away:home;fairRaw=homeLean?proj.home_win_probability:1-proj.home_win_probability; fit=Math.abs(fairRaw-.5); thesis=`${sideName} moneyline`; }
  else if(market==='spreads'){
    const ho=getPairOutcome(pair,home),ao=getPairOutcome(pair,away); if(!ho||!ao||ho.point==null||ao.point==null)return null; const homeCoverMargin=proj.projected_margin_home+Number(ho.point); const homeCover=normCdf(homeCoverMargin/(event.sport_key==='baseball_mlb'?2.5:(ESPN[event.sport_key]?.marginSd||12))); const homeLean=homeCover>=.5; sideName=homeLean?home:away;oppName=homeLean?away:home; const so=homeLean?ho:ao;point=so.point;fairRaw=homeLean?homeCover:1-homeCover;fit=Math.abs(homeCoverMargin)/(event.sport_key==='baseball_mlb'?1.5:5); thesis=`${sideName} ${point>0?'+':''}${point}`;
  } else if(market==='totals'){
    if(proj.projected_total==null)return null; const over=pair.outcomes.find(o=>String(o.name).toLowerCase()==='over'),under=pair.outcomes.find(o=>String(o.name).toLowerCase()==='under'); if(!over||!under||over.point==null)return null; const sd=event.sport_key==='baseball_mlb'?2.6:event.sport_key==='basketball_wnba'?12:event.sport_key.startsWith('americanfootball')?14:3; const overProb=normCdf((proj.projected_total-Number(over.point))/sd); const overLean=overProb>=.5; sideName=overLean?'Over':'Under';oppName=overLean?'Under':'Over'; const so=overLean?over:under; point=so.point;fairRaw=overLean?overProb:1-overProb;fit=Math.abs(proj.projected_total-Number(point))/(event.sport_key==='baseball_mlb'?1.5:6);thesis=`${sideName} ${point}`;
  }
  const so=getPairOutcome(pair,sideName),oo=getPairOutcome(pair,oppName); if(!so||!oo)return null; const [sp,op]=fairTwoWay(so.price,oo.price); if(sp==null)return null; const fair=uncertaintyShrink(fairRaw,proj); let cushion=marketCushion(event.sport_key,market,proj); let edge=fair-sp; const ev=evFromAmerican(fair,so.price); const selectedAway=market!=='totals'&&sameTeam(sideName,away); if(selectedAway&&Number(so.price)<0)cushion+=.007; if(Number(so.price)<=-220)cushion+=.008; if(market==='totals'&&proj.data_quality<72)cushion+=.008; let gate='PASS'; const edgeN=proj.independent_edge_count,agree=proj.model_agreement,dq=proj.data_quality;
  if(dq>=72&&agree>=66&&edgeN>=2&&edge>=cushion&&ev>=.025)gate='CORE'; else if(dq>=60&&agree>=57&&edgeN>=2&&edge>=cushion*.62&&ev>=.005)gate='SECONDARY'; else if(edge>0&&dq>=50)gate='WATCH';
  if(event.sport_key==='americanfootball_nfl_preseason'&&gate==='CORE')gate='SECONDARY';
  if(event.sport_key==='americanfootball_nfl_preseason'&&market==='spreads'&&Math.abs(Number(point)||0)>3.5&&proj.data_quality<68)gate='PASS';
  return {event_id:event.id,market,selection:sideName,point,price:Number(so.price),book:pair.book,book_key:pair.book_key,hard_rock:pair.hard_rock,last_update:pair.last_update,market_probability:sp,fair_probability:fair,fair_raw:fairRaw,adjusted_edge:edge,estimated_ev:ev,cushion,fit,thesis,tier:gate};
}
function candidateRank(c){ const tier={CORE:4,SECONDARY:3,WATCH:2,PASS:1}[c.tier]||0; return tier*100+(c.hard_rock?8:0)+(c.adjusted_edge||0)*100+(c.fit||0); }
function chooseMarket(event,proj){ const all=[]; for(const k of ['h2h','spreads','totals'])for(const p of quotePairs(event,k)){ const c=marketCandidate(event,proj,p,k); if(c)all.push(c); }
  if(!all.length)return {best:null,all:[]}; const hr=all.filter(c=>c.hard_rock&&c.tier!=='PASS'); let pool=hr.length?hr:all; pool=pool.sort((a,b)=>candidateRank(b)-candidateRank(a)); let best=pool[0]; if(!best.hard_rock&&['CORE','SECONDARY'].includes(best.tier)){best={...best,tier:'WATCH',execution_note:'Hard Rock Florida quote not available in the synced board; reference only until target-book price is verified.'};} return {best,all:all.sort((a,b)=>candidateRank(b)-candidateRank(a))}; }
function buildWhy(proj,c){ const good=proj.modules.filter(m=>(proj.home_win_probability>=.5?m.value>0:m.value<0)).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,3); return `${c.thesis}. Independent projection ${proj.away_team} ${proj.projected_score.away??'—'} – ${proj.home_team} ${proj.projected_score.home??'—'}. Primary supporting modules: ${good.map(m=>`${m.name} (${m.evidence})`).join(' | ')||'limited structured evidence'}.`; }
function timing(event,c,proj){ const hrs=hoursUntil(event.commence_time),fresh=c.last_update?Math.abs(Date.now()-new Date(c.last_update).getTime())/60000:null; if(proj.data_quality<65)return 'WAIT / PASS FOR CONFIRMATION'; if(hrs>12)return 'WAIT — re-sync closer to game'; if(fresh!=null&&fresh>45)return 'WAIT — quote may be stale'; return 'BET NOW if target-book line still matches'; }
function finalVerification(proj,c){ const flags=[]; if(proj.data_quality<70)flags.push('data quality below Core threshold'); if(proj.independent_edge_count<2)flags.push('fewer than two independent edges'); if(proj.model_agreement<60)flags.push('model disagreement'); if(!c.hard_rock)flags.push('Hard Rock price not verified'); if(proj.risks.length)flags.push(proj.risks[0]); return flags.length?`Caution: ${flags.join('; ')}.`:'Core release gates checked: data quality, agreement, two-edge gate, price cushion, target book, and failure paths.'; }

async function scanSlate(events){ const capped=pregameOnly(events).slice(0,MAX_SCAN_GAMES); const analyses=[]; for(const e of capped){ try{const proj=await analyzeEvent(e); const market=chooseMarket(e,proj); analyses.push({event:sanitizeEvent(e),projection:proj,market});}catch(err){analyses.push({event:sanitizeEvent(e),projection:lowInfoProjection(e,err.message,30),market:{best:null,all:[]}});} }
  const released=[]; const passes=[]; for(const a of analyses){ const c=a.market.best,p=a.projection; if(!c||c.tier==='PASS'){passes.push({event_id:a.event.id,matchup:`${a.event.away_team} @ ${a.event.home_team}`,reason:!c?'No verified market matched the independent projection.':`Release gates failed: DQ ${p.data_quality.toFixed(0)}, agreement ${p.model_agreement.toFixed(0)}, independent edges ${p.independent_edge_count}, adjusted edge ${fmtPct(c.adjusted_edge)} vs cushion ${fmtPct(c.cushion)}.`});continue;} released.push({event_id:a.event.id,event:a.event,projection:p,...c,why:buildWhy(p,c),how_it_loses:p.risks.slice(0,4),timing:timing(a.event,c,p),final_verification:finalVerification(p,c),units:c.tier==='CORE'?1:c.tier==='SECONDARY'?.5:0}); }
  released.sort((x,y)=>candidateRank(y)-candidateRank(x)); let cores=0; for(const p of released){ if(p.tier==='CORE'){cores++;if(cores>2){p.tier='SECONDARY';p.units=.5;p.final_verification+=' Precision Mode Core cap downgraded this play.';}} }
  const eligible=released.filter(x=>['CORE','SECONDARY'].includes(x.tier)&&x.hard_rock&&x.fair_probability>=.56).slice(0,3); let parlay=null; if(eligible.length>=2){ const legs=eligible.slice(0,2); let dec=1; for(const l of legs)dec*=l.price>0?1+l.price/100:1+100/(-l.price); const american=dec>=2?Math.round((dec-1)*100):Math.round(-100/(dec-1)); parlay={units:.25,legs:legs.map(l=>({event_id:l.event_id,selection:l.selection,point:l.point,price:l.price,book:l.book})),approx_american:american,rationale:'Optional only: both legs independently cleared straight-bet release gates, use distinct games, and have verified Hard Rock quotes.'}; }
  const grade=released.filter(x=>x.tier==='CORE').length>=2?'A':released.some(x=>x.tier==='CORE')?'B+':released.some(x=>x.tier==='SECONDARY')?'B':'PASS-HEAVY'; return {version:VERSION,generated_at:new Date().toISOString(),slate_grade:grade,plays:released,passes,parlay,analyses}; }

const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#06131d"><title>SB101 AEGIS Zero-Cost Engine</title><style>
:root{--bg:#06131d;--panel:#0b1b28;--panel2:#0e2232;--line:#244055;--text:#eef5fb;--muted:#98adbd;--mint:#5ef0b7;--red:#ff6b76;--gold:#ffd36b;--blue:#7ab8ff}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#071825,#06131d);color:var(--text);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1100px;margin:auto;padding:24px 18px 80px}.hero{padding:20px 0 8px}.eyebrow{color:var(--mint);font-weight:800;letter-spacing:.14em}.hero h1{font-size:clamp(34px,7vw,60px);line-height:1;margin:10px 0}.muted{color:var(--muted)}.status{display:inline-flex;gap:10px;align-items:center;border:1px solid var(--mint);border-radius:999px;padding:11px 16px;margin:10px 0;font-size:14px}.tabs{display:flex;gap:10px;overflow:auto;padding:14px 0;position:sticky;top:0;background:#06131df2;z-index:5}.tab,.btn,select{border:1px solid var(--line);background:#0b1b28;color:var(--text);border-radius:14px;padding:14px 16px;font-size:16px}.tab.active{border-color:var(--mint)}.btn{cursor:pointer;font-weight:800}.btn.primary{background:var(--mint);color:#052018;border-color:var(--mint)}.btn.secondary{border-color:var(--blue)}.btn:disabled{opacity:.45}.panel,.game,.result{background:rgba(11,27,40,.92);border:1px solid var(--line);border-radius:22px;padding:18px;margin:16px 0}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.control{min-width:220px;flex:1}.control label{display:block;color:var(--muted);font-size:13px;margin:0 0 7px}.control select{width:100%}.game h3{font-size:20px;margin:6px 0 12px}.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.quote{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px;font-size:14px}.quote.hardrock{border-color:var(--mint)}.quote b{display:block;color:var(--muted);margin-bottom:5px}.progress{display:none;background:#0e2232;border:1px solid var(--blue);border-radius:18px;padding:18px;margin:16px 0}.progress.show{display:block}.bar{height:8px;background:#173247;border-radius:999px;overflow:hidden;margin-top:10px}.bar i{display:block;height:100%;background:var(--mint);width:15%;transition:.3s}.badge{display:inline-block;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;margin-right:6px}.CORE{background:#174d3b;color:#7dffd0}.SECONDARY{background:#3e3415;color:#ffe38a}.WATCH{background:#173650;color:#a9d5ff}.PASS{background:#49242a;color:#ffb1b8}.metricgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.metric{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px}.metric b{display:block;color:var(--muted);font-size:12px}.play{border-left:4px solid var(--mint);padding-left:14px;margin:18px 0}.risk{color:#ffc0c5}.models{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.model{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px}.hidden{display:none}.notice{border:1px solid #45596b;background:#0b1b28;border-radius:14px;padding:12px}.small{font-size:12px}.hr{height:1px;background:var(--line);margin:16px 0}.source{display:inline-block;margin:4px 8px 4px 0;color:#9fd2ff}.module{padding:8px 0;border-bottom:1px solid #183247}.warning{border-color:var(--gold);color:#ffe7a3}@media(max-width:650px){.wrap{padding-left:14px;padding-right:14px}.tab{min-width:130px}.controls{display:block}.control{margin-bottom:12px}.btn{width:100%;margin-top:8px}.hero h1{font-size:42px}}
</style></head><body><div class="wrap"><header class="hero"><div class="eyebrow">SB101 AEGIS v3 • ZERO-COST AUTO ENGINE</div><h1>Sports Command Center</h1><p class="muted">One tap: live odds → free structured sports data → blind projection → market challenger → release gates → disciplined final card.</p><div class="status" id="status">Checking free data engine…</div></header>
<nav class="tabs"><button class="tab active" data-tab="dashboard">Dashboard</button><button class="tab" data-tab="card">Final Card</button><button class="tab" data-tab="models">Model Registry</button></nav>
<section id="dashboard"><div class="panel"><div class="controls"><div class="control"><label>Sport</label><select id="sport"></select></div><div class="control"><label>Markets</label><select id="markets"><option value="h2h,spreads,totals">ML + Spread + Total</option><option value="h2h">Moneyline only</option><option value="spreads">Spread only</option><option value="totals">Total only</option></select></div></div><button class="btn secondary" id="sync">Sync Pregame Board</button><button class="btn primary" id="scan" disabled>RUN FULL AUTOMATIC SLATE SCAN</button><p class="muted small">No model sliders. No OpenAI billing. Pregame only: already-started games are removed before analysis. The engine automatically lowers Data Quality or PASSes when free feeds cannot verify a key input.</p><div id="quota" class="muted small"></div><div id="enhance" class="notice small"></div></div>
<div class="progress" id="progress"><b id="progressTitle">Scanning…</b><p class="muted" id="progressText"></p><div class="bar"><i id="progressBar"></i></div></div><div id="events"></div></section>
<section id="card" class="hidden"><div class="panel" id="cardContent"><h2>No scan yet</h2><p class="muted">Sync a pregame board and run the automatic slate scan.</p></div></section>
<section id="models" class="hidden"><div class="panel"><h2>49-model AEGIS registry</h2><p class="muted">Models activate only when relevant and supported by verified inputs. Missing inputs never become fake neutral scores.</p><div class="models" id="modelGrid"></div></div></section>
</div><script>
let EVENTS=[],LAST=null;const $=q=>document.querySelector(q),$$=q=>[...document.querySelectorAll(q)];const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));const fmtA=n=>{n=Number(n);return Number.isFinite(n)?(n>0?'+'+Math.round(n):Math.round(n)): '—'};const pct=n=>Number.isFinite(Number(n))?(Number(n)*100).toFixed(1)+'%':'—';
async function api(url,opt){const r=await fetch(url,opt),t=await r.text();let d;try{d=JSON.parse(t)}catch{d={error:t}};if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));return d}
function tab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));['dashboard','card','models'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==name))}$$('.tab').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
async function init(){const h=await api('/api/health');$('#status').textContent=(h.odds_ready?'ODDS READY':'ODDS KEY NEEDED')+' • ZERO-COST ENGINE READY • '+h.models+' models';$('#enhance').innerHTML='<b>Free-data status:</b> MLB public Stats API + ESPN structured feeds + Open-Meteo + nflverse are automatic. '+(h.cfbd_ready?'<b>NCAAF advanced CFBD ratings active.</b>':'NCAAF works in basic mode. Optional free CFBD key can raise NCAAF data quality; no credit card required.');const s=await api('/api/sports');$('#sport').innerHTML=s.sports.map(x=>'<option value="'+esc(x.key)+'">'+esc(x.title)+'</option>').join('');const m=await api('/api/models');$('#modelGrid').innerHTML=m.models.map(x=>'<div class="model"><b>'+esc(x[0])+'</b><div class="muted small">'+esc(x[1])+'</div><p>'+esc(x[2])+'</p></div>').join('')}
function renderQuotes(e){let books=[...(e.bookmakers||[])].sort((a,b)=>(b.key.includes('hardrock')?1:0)-(a.key.includes('hardrock')?1:0));return books.flatMap(b=>(b.markets||[]).map(m=>{let txt=(m.outcomes||[]).map(o=>esc(o.name)+(o.point!=null?' '+(o.point>0?'+':'')+esc(o.point):'')+' '+fmtA(o.price)).join('<br>');return '<div class="quote '+(b.key.includes('hardrock')?'hardrock':'')+'"><b>'+esc(b.title)+' • '+esc(m.key)+(b.key.includes('hardrock')?' • TARGET BOOK':'')+'</b>'+txt+'</div>'})).join('')}
function renderEvents(){ $('#events').innerHTML=EVENTS.length?EVENTS.map((e,i)=>'<article class="game"><div class="muted small">'+new Date(e.commence_time).toLocaleString()+'</div><h3>'+esc(e.away_team)+' @ '+esc(e.home_team)+'</h3><div class="quotes">'+renderQuotes(e)+'</div><button class="btn secondary" data-game="'+i+'">AUTO SCAN THIS GAME</button></article>').join(''):'<div class="panel">No upcoming pregame events returned.</div>';$$('[data-game]').forEach(b=>b.onclick=()=>runScan([EVENTS[+b.dataset.game]]));}
$('#sync').onclick=async()=>{try{$('#events').innerHTML='<div class="panel">Syncing upcoming pregame board…</div>';const d=await api('/api/odds?sport='+encodeURIComponent($('#sport').value)+'&markets='+encodeURIComponent($('#markets').value));EVENTS=d.events||[];$('#quota').textContent=d.quota?'Odds API quota • remaining '+(d.quota.remaining??'—')+' • used '+(d.quota.used??'—')+' • last '+(d.quota.last??'—'):'';renderEvents();$('#scan').disabled=!EVENTS.length}catch(e){$('#events').innerHTML='<div class="panel"><b>Live sync error</b><p>'+esc(e.message)+'</p></div>'}}
function progress(p,title,text){$('#progress').classList.add('show');$('#progressBar').style.width=p+'%';$('#progressTitle').textContent=title;$('#progressText').textContent=text;window.scrollTo({top:$('#progress').offsetTop-80,behavior:'smooth'})}
async function runScan(events){try{$('#scan').disabled=true;progress(12,'Stage 1 of 4 • Free independent data','Pulling current public sports statistics, schedules, probable starters, ratings, news signals and weather without using sportsbook prices to set direction.');await new Promise(r=>setTimeout(r,150));progress(38,'Stage 2 of 4 • Sport-specific projection','Running only the modules that apply to this sport and measuring data quality, uncertainty, agreement and failure paths.');const d=await api('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events})});progress(72,'Stage 3 of 4 • Market challenger','De-vigging the current market and comparing it to the independent projection.');await new Promise(r=>setTimeout(r,180));progress(92,'Stage 4 of 4 • Release gates','Applying two-edge gate, market cushion, favorite tax, target-book verification, exposure control and Precision Mode Core cap.');LAST=d;renderCard(d);progress(100,'Zero-cost AEGIS scan complete','Final card is ready. PASS is a successful outcome when free data cannot verify the edge.');setTimeout(()=>tab('card'),300)}catch(e){progress(100,'Scan stopped',e.message);$('#progressBar').style.background='var(--red)'}finally{$('#scan').disabled=!EVENTS.length}}
$('#scan').onclick=()=>runScan(EVENTS);
function modulesHtml(p){return (p.projection?.modules||[]).map(m=>'<div class="module"><b>'+esc(m.name)+'</b> <span class="muted">('+Math.round(m.confidence)+'/100)</span><br><span class="small">'+esc(m.evidence)+'</span></div>').join('')}
function renderCard(d){let h='<div class="muted small">SLATE GRADE</div><h2>'+esc(d.slate_grade||'—')+'</h2><p class="muted">Generated '+new Date(d.generated_at).toLocaleString()+' • deterministic/free-data engine</p>';if(!(d.plays||[]).length)h+='<div class="notice"><b>NO QUALIFIED BETS</b><p class="muted">AEGIS did not release a bet. Missing free-data coverage is treated as uncertainty, not converted into fake confidence.</p></div>';
for(const p of d.plays||[]){h+='<div class="play"><span class="badge '+esc(p.tier)+'">'+esc(p.tier)+'</span><b>'+esc(p.event.away_team)+' @ '+esc(p.event.home_team)+'</b><h3>'+esc(p.selection)+(p.point!=null?' '+(p.point>0?'+':'')+esc(p.point):'')+' '+fmtA(p.price)+' • '+esc(p.book)+'</h3><div class="metricgrid"><div class="metric"><b>Projected score</b>'+esc(p.projection.projected_score.away)+' – '+esc(p.projection.projected_score.home)+'</div><div class="metric"><b>Fair probability</b>'+pct(p.fair_probability)+'</div><div class="metric"><b>Fair price</b>'+fmtA((p.fair_probability>=.5?Math.round(-100*p.fair_probability/(1-p.fair_probability)):Math.round(100*(1-p.fair_probability)/p.fair_probability)))+'</div><div class="metric"><b>Market challenger</b>'+pct(p.market_probability)+'</div><div class="metric"><b>Adjusted edge</b>'+pct(p.adjusted_edge)+'</div><div class="metric"><b>Estimated EV</b>'+pct(p.estimated_ev)+'</div><div class="metric"><b>Model agreement</b>'+Math.round(p.projection.model_agreement)+'/100</div><div class="metric"><b>Data quality</b>'+Math.round(p.projection.data_quality)+'/100</div><div class="metric"><b>Independent edges</b>'+p.projection.independent_edge_count+'</div><div class="metric"><b>Stake</b>'+p.units+'u</div></div><p><b>Why:</b> '+esc(p.why)+'</p><p><b>Timing:</b> '+esc(p.timing)+'</p><p class="risk"><b>How it loses / risk:</b> '+esc((p.how_it_loses||[]).join(' • '))+'</p><p class="muted"><b>Final verification:</b> '+esc(p.final_verification)+'</p><details><summary>Applied models & source evidence</summary>'+modulesHtml(p)+'<div class="hr"></div>'+((p.projection.sources||[]).map(s=>'<a class="source" target="_blank" rel="noopener" href="'+esc(s.url)+'">'+esc(s.name)+'</a>').join('')||'<span class="muted">No external source links available.</span>')+'</details></div>'}
if(d.parlay)h+='<div class="panel"><h3>Optional qualified parlay • '+d.parlay.units+'u • approx '+fmtA(d.parlay.approx_american)+'</h3>'+d.parlay.legs.map(l=>'<div>'+esc(l.selection)+(l.point!=null?' '+(l.point>0?'+':'')+esc(l.point):'')+' '+fmtA(l.price)+' • '+esc(l.book)+'</div>').join('')+'<p>'+esc(d.parlay.rationale)+'</p></div>';
if((d.passes||[]).length){h+='<div class="hr"></div><h3>Pass / Cut</h3>'+d.passes.map(p=>'<p class="muted"><b>'+esc(p.matchup)+'</b> — '+esc(p.reason)+'</p>').join('')}$('#cardContent').innerHTML=h}
init().catch(e=>$('#status').textContent='Setup error: '+e.message);
</script></body></html>`;

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&u.pathname==='/')return send(res,200,HTML,'text/html; charset=utf-8');
    if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,version:VERSION,models:MODELS.length,odds_ready:!!ODDS_KEY,cfbd_ready:!!CFBD_KEY,max_scan_games:MAX_SCAN_GAMES,openai_used:false,cost_layer:'No paid AI calls. Public/free data only.'});
    if(req.method==='GET'&&u.pathname==='/api/models')return send(res,200,{models:MODELS});
    if(req.method==='GET'&&u.pathname==='/api/sports')return send(res,200,{sports:SPORTS});
    if(req.method==='GET'&&u.pathname==='/api/odds'){
      const sport=u.searchParams.get('sport')||'baseball_mlb',markets=u.searchParams.get('markets')||'h2h,spreads,totals';
      const endpoint=`sports/${encodeURIComponent(sport)}/odds?bookmakers=${encodeURIComponent(ODDS_BOOKMAKERS)}&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`;
      const r=await oddsFetch(endpoint),events=pregameOnly(r.data); return send(res,200,{events,filtered_live_count:(r.data||[]).length-events.length,quota:r.meta});
    }
    if(req.method==='POST'&&u.pathname==='/api/scan'){
      const body=JSON.parse(await readBody(req)||'{}'),events=(body.events||[]).map(sanitizeEvent); if(!events.length)return send(res,400,{error:'No upcoming events were supplied.'}); const out=await scanSlate(events); return send(res,200,out);
    }
    return send(res,404,{error:'Not found'});
  }catch(e){console.error(e);return send(res,500,{error:e.message||'Server error'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`AEGIS Zero-Cost v3 running on ${PORT} • ${MODELS.length} models • OpenAI calls disabled`));
