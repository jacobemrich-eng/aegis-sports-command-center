const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ODDS_KEY = process.env.ODDS_API_KEY || '';
const CFBD_KEY = process.env.CFBD_API_KEY || '';
const ODDS_BOOKMAKERS = process.env.ODDS_BOOKMAKERS || 'hardrockbet_fl,fanduel,draftkings,bovada,betmgm,espnbet,fanatics';
const MAX_SCAN_GAMES = Math.max(1, Math.min(40, Number(process.env.MAX_SCAN_GAMES || 15)));
const TARGET_BOOK = 'hardrockbet_fl';
const VERSION = '5.3.1-cfbd-mapping-integrity';

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
  ['Daily Results Audit System','audit','Automatically records pregame model snapshots, grades final outcomes, and measures ROI/calibration without paid services.'],
  ['Model Calibration / Development','audit','Uses minimum-sample performance evidence before any threshold or weight changes; never self-tunes from one game.'],
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
function poissonDist(lambda,max=22){ lambda=Math.max(.05,Number(lambda)||.05); const a=new Array(max+1).fill(0); a[0]=Math.exp(-lambda); let sum=a[0]; for(let k=1;k<=max;k++){a[k]=a[k-1]*lambda/k;sum+=a[k];} if(sum<1)a[max]+=1-sum; return a; }
function mlbDiscreteMarket(proj,market,selection,point,home,away){ const hl=Number(proj.projected_score?.home),al=Number(proj.projected_score?.away); if(!Number.isFinite(hl)||!Number.isFinite(al))return null; const hd=poissonDist(hl),ad=poissonDist(al); let win=0,lose=0,push=0; for(let h=0;h<hd.length;h++)for(let a=0;a<ad.length;a++){const pr=hd[h]*ad[a];let z;if(market==='spreads'){z=(sameTeam(selection,home)?h-a:a-h)+Number(point);}else if(market==='totals'){z=h+a-Number(point); if(String(selection).toLowerCase()==='under')z=-z;}else continue; if(z>1e-9)win+=pr;else if(z<-1e-9)lose+=pr;else push+=pr;} const denom=win+lose; return denom>0?{prob:win/denom,push}:null; }
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

async function fetchWithTimeout(url,options={},timeout=9000){ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); try{return await fetch(url,{...options,signal:c.signal,headers:{'User-Agent':'SB101-AEGIS-Zero-Cost/5.3.1','Accept':'application/json,text/plain,*/*',...(options.headers||{})}});}finally{clearTimeout(t);} }
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
function marketConsensus(event,market,sideName,oppName,point){ const probs=[]; for(const p of quotePairs(event,market)){ const so=getPairOutcome(p,sideName),oo=getPairOutcome(p,oppName); if(!so||!oo)continue; if(market!=='h2h'){ if(so.point==null||point==null||Math.abs(Number(so.point)-Number(point))>.001)continue; if(market==='totals'&&oo.point!=null&&Math.abs(Number(oo.point)-Number(point))>.001)continue; } const [sp]=fairTwoWay(so.price,oo.price); if(sp!=null)probs.push(sp); } return {prob:median(probs),books:probs.length,dispersion:stdev(probs)||0}; }
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

async function cfbdAll(year){
  if(!CFBD_KEY)return null;
  const headers={Authorization:`Bearer ${CFBD_KEY}`};
  const fetchOne=async(path)=>{try{return await cachedJson(`https://api.collegefootballdata.com${path}`,6*3600*1000,{headers});}catch{return [];}};
  const py=year-1;
  const [sp,core,elo,priorSp,priorCore,priorElo]=await Promise.all([
    fetchOne(`/ratings/sp?year=${year}`),fetchOne(`/ratings/core?year=${year}`),fetchOne(`/ratings/elo?year=${year}`),
    fetchOne(`/ratings/sp?year=${py}`),fetchOne(`/ratings/core?year=${py}`),fetchOne(`/ratings/elo?year=${py}`)
  ]);
  return {sp,core,elo,priorSp,priorCore,priorElo,year,priorYear:py};
}
function ratingTeamSimilarity(a,b){
  const na=normalizeTeam(a),nb=normalizeTeam(b),A=[...tokens(a)],B=[...tokens(b)];
  if(!na||!nb||!A.length||!B.length)return 0;
  if(na===nb)return 1;
  let inter=0; for(const x of A)if(B.includes(x))inter++;
  const overlap=inter/Math.max(A.length,B.length);
  // CFBD names commonly omit mascots ("West Georgia" vs "West Georgia Wolves").
  // Reward specific containment, but do NOT let a generic token such as "Georgia"
  // tie the more specific "West Georgia" match.
  if(na.includes(nb)||nb.includes(na)){
    const short=Math.min(A.length,B.length),long=Math.max(A.length,B.length);
    return Math.max(overlap,.75+.20*(short/long));
  }
  return overlap;
}
function findRatingMatch(rows,team){
  let best=null,bestScore=0,second=0;
  for(const r of rows||[]){
    const q=ratingTeamSimilarity(r.team,team);
    if(q>bestScore+1e-9){second=bestScore;bestScore=q;best=r;}
    else if(q>second)second=q;
  }
  // .84 accepts a mascot-omitted two-of-three token match (~.883), while rejecting
  // underspecified one-token matches such as Georgia -> West Georgia Wolves (~.817).
  if(bestScore<.84)return {row:null,score:bestScore,ambiguous:false,matched:best?.team||null};
  const ambiguous=(bestScore-second)<.035;
  return {row:ambiguous?null:best,score:bestScore,ambiguous,matched:best?.team||null};
}
function findRating(rows,team){ return findRatingMatch(rows,team).row; }
const FBS_CONFS=new Set(['acc','american athletic','big 12','big ten','conference usa','c usa','mid american','mountain west','pac 12','sec','sun belt','fbs independents','independent']);
function conferenceClass(conf){ const c=normalizeTeam(conf); if(!c)return 'unknown'; for(const x of FBS_CONFS)if(c===x||c.includes(x))return 'fbs'; return 'non-fbs'; }
function ncaafCurrentWeight(games){ const g=Math.max(0,Number(games)||0); if(g<=1)return .18;if(g===2)return .28;if(g===3)return .42;if(g===4)return .56;if(g===5)return .68;if(g===6)return .78;return .86; }
function ncaafScheduleWeight(games){ const g=Math.max(0,Number(games)||0); if(g<=0)return 0;if(g===1)return .06;if(g===2)return .12;if(g===3)return .20;if(g===4)return .28;if(g===5)return .36;if(g===6)return .42;return .46; }
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
async function mlbPitcherGameLog(id,year){ if(!id)return null; try{return await cachedJson(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=pitching&season=${year}`,10*60*1000);}catch{return null;} }
function pitcherRecentWorkload(d){ const splits=d?.stats?.[0]?.splits||[]; const rows=[]; for(const x of splits){ const st=x.stat||{}; const gs=num(st.gamesStarted,0); const ip=baseballInnings(st.inningsPitched); const pitches=num(st.numberOfPitches); if((gs>0||ip>=2.2)&&ip!=null)rows.push({date:x.date||x.game?.gameDate||'',ip,pitches}); } rows.sort((a,b)=>new Date(a.date)-new Date(b.date)); const r=rows.slice(-5); return {starts:r.length,avgIP:mean(r.map(x=>x.ip)),avgPitches:mean(r.map(x=>x.pitches)),lastPitches:r.length?r[r.length-1].pitches:null,rows:r}; }
async function mlbTeamRecentGames(teamId,eventTime,days=4){ const end=isoDate(addDays(eventTime,-1)),start=isoDate(addDays(eventTime,-days)); try{const d=await cachedJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${end}`,5*60*1000); const rows=[]; for(const day of d.dates||[])for(const g of day.games||[]){if(g.status?.abstractGameState==='Final')rows.push({gamePk:g.gamePk,date:g.gameDate,homeId:g.teams?.home?.team?.id,awayId:g.teams?.away?.team?.id});} rows.sort((a,b)=>new Date(b.date)-new Date(a.date)); return rows.slice(0,3);}catch{return [];} }
async function mlbBoxscore(gamePk){ if(!gamePk)return null; try{return await cachedJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`,15*60*1000);}catch{return null;} }
async function mlbBullpenUsage(teamId,eventTime){ const games=await mlbTeamRecentGames(teamId,eventTime,4); if(!games.length)return {verified:false,availability:55,heavyCount:0,relievers:[],games:0}; const boxes=await Promise.all(games.map(g=>mlbBoxscore(g.gamePk))); const agg=new Map(); let observed=0; for(let i=0;i<games.length;i++){ const b=boxes[i]; if(!b)continue; const g=games[i],home=String(g.homeId)===String(teamId),side=home?b.teams?.home:b.teams?.away; const ids=side?.pitchers||[]; if(ids.length<2)continue; observed++; const relievers=ids.slice(1); const ageH=Math.max(0,(new Date(eventTime)-new Date(g.date))/36e5); const bucket=ageH<=36?1:ageH<=60?2:3; for(const id of relievers){ const pl=side.players?.[`ID${id}`]||{}; const st=pl.stats?.pitching||{}; const pitches=num(st.numberOfPitches,0),ip=baseballInnings(st.inningsPitched)||0; const cur=agg.get(id)||{id,name:pl.person?.fullName||`Pitcher ${id}`,p1:0,p2:0,p3:0,appearances:0,innings:0}; cur.appearances++;cur.innings+=ip; if(bucket<=1)cur.p1+=pitches;if(bucket<=2)cur.p2+=pitches;cur.p3+=pitches;agg.set(id,cur); } }
  const relievers=[...agg.values()].sort((a,b)=>b.p2-a.p2); let penalty=0,heavy=0; for(const r of relievers){ let rp=0; if(r.p1>=35)rp+=18;else if(r.p1>=25)rp+=12;else if(r.p1>=18)rp+=6; if(r.p2>=50)rp+=10;else if(r.p2>=38)rp+=6; if(r.appearances>=2&&r.p2>=28)rp+=5; if(rp>=10)heavy++; penalty+=Math.min(20,rp); } penalty=Math.min(42,penalty); const availability=clamp(92-penalty,45,96); return {verified:observed>0,availability,heavyCount:heavy,relievers:relievers.slice(0,6),games:observed,totalPitches:relievers.reduce((s,r)=>s+r.p3,0)}; }
function starterSkill(st,staffEra=4.35){ const era=num(st.era,staffEra),whip=num(st.whip,1.30),k9=num(st.strikeoutsPer9Inn,num(st.strikeoutsPer9,8.5)),bb9=num(st.walksPer9Inn,num(st.walksPer9,3.0)),hr9=num(st.homeRunsPer9,1.15); const eraF=safeDiv(era,4.35,1),whipF=safeDiv(whip,1.30,1),cmdF=safeDiv(safeDiv(bb9,Math.max(4,k9),.35),.35,1),hrF=safeDiv(hr9,1.15,1); return clamp(.42*eraF+.24*whipF+.19*cmdF+.15*hrF,.62,1.55); }
function starterExpectedIP(st,recent){ const seasonIP=baseballInnings(st.inningsPitched),gs=num(st.gamesStarted,0),seasonAvg=gs>0?safeDiv(seasonIP,gs,5.3):5.1,rec=num(recent?.avgIP,seasonAvg); return clamp(.62*seasonAvg+.38*rec,4.0,6.7); }
function bullpenRunAdjustment(usage){ if(!usage?.verified)return .08; return clamp((75-usage.availability)/100*.9,-.12,.38); }
function expectedModuleCount(sport){ if(sport==='baseball_mlb')return 9;if(sport==='americanfootball_ncaaf')return 7;if(sport==='americanfootball_nfl_preseason')return 8;if(sport==='basketball_wnba')return 6;if(sport==='americanfootball_nfl')return 6;if(sport==='baseball_kbo'||sport==='baseball_npb')return 5;return 6; }
function coverageScore(mods,sport,criticalPenalty=0){ const expected=expectedModuleCount(sport); const points=(mods||[]).reduce((s,m)=>s+Math.min(90,clamp(m.confidence))/90,0); return clamp(100*points/expected-criticalPenalty,0,100); }
function driverCoverage(mods,expected=4){ const points=(mods||[]).reduce((s,m)=>s+Math.min(90,clamp(m.confidence))/90,0); return clamp(100*points/Math.max(1,expected),0,100); }
function effectiveAgreement(raw,coverage,dq){ return clamp(50+(clamp(raw)-50)*(clamp(coverage)/100)*(clamp(dq)/100),0,100); }
function uncertaintyWidth(proj,market='h2h'){ const dq=clamp(proj.data_quality)/100,cov=clamp(proj.coverage_score??proj.data_quality)/100; let w=.025+(1-dq)*.08+(1-cov)*.07; if(market!=='h2h')w+=.01;if(proj.sport==='americanfootball_nfl_preseason')w+=.02;return Math.max(.03,Math.min(.14,w)); }

function module(name,value,side,evidence,confidence=70){ return {name,value:Number(value)||0,side,evidence,confidence:clamp(confidence)}; }
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
  const hOps=num(H.ops,.720),aOps=num(A.ops,.720); const hRecentOff=clamp(safeDiv(hr.pf,lg,1),.86,1.14),aRecentOff=clamp(safeDiv(ar.pf,lg,1),.86,1.14); const hOff=.46*safeDiv(hRpg,lg,1)+.39*safeDiv(hOps,.720,1)+.15*hRecentOff; const aOff=.46*safeDiv(aRpg,lg,1)+.39*safeDiv(aOps,.720,1)+.15*aRecentOff;
  const hspSkill=starterSkill(HSP,hEra),aspSkill=starterSkill(ASP,aEra),hExpIP=starterExpectedIP(HSP,hWork),aExpIP=starterExpectedIP(ASP,aWork); const hSpShare=hExpIP/9,aSpShare=aExpIP/9; const homePitch=hSpShare*hspSkill+(1-hSpShare)*safeDiv(hEra,4.35,1); const awayPitch=aSpShare*aspSkill+(1-aSpShare)*safeDiv(aEra,4.35,1);
  const hBullAdj=bullpenRunAdjustment(hBull),aBullAdj=bullpenRunAdjustment(aBull); const wAdj=weatherTotalAdjustment('baseball_mlb',weather,false); let awayRuns=lg*aOff*homePitch+hBullAdj+0.5*wAdj; let homeRuns=lg*hOff*awayPitch+aBullAdj+0.18+0.5*wAdj; awayRuns=clamp(awayRuns,1.7,8.3);homeRuns=clamp(homeRuns,1.7,8.6);
  const margin=homeRuns-awayRuns,total=homeRuns+awayRuns; const homeProb=clamp01(normCdf(margin/2.85));
  const hK9=num(HSP.strikeoutsPer9Inn,num(HSP.strikeoutsPer9,8.5)),aK9=num(ASP.strikeoutsPer9Inn,num(ASP.strikeoutsPer9,8.5)),hBB9=num(HSP.walksPer9Inn,num(HSP.walksPer9,3.0)),aBB9=num(ASP.walksPer9Inn,num(ASP.walksPer9,3.0));
  const mods=[
    module('Starting pitcher quality', (aspSkill-hspSkill)*1.45,aspSkill>hspSkill?'home':'away',`${hp?.fullName||'Home SP'} ERA ${hspEra.toFixed(2)}, WHIP ${num(HSP.whip,1.30).toFixed(2)}, K/BB ${safeDiv(hK9,hBB9,0).toFixed(2)} vs ${ap?.fullName||'Away SP'} ERA ${aspEra.toFixed(2)}, WHIP ${num(ASP.whip,1.30).toFixed(2)}, K/BB ${safeDiv(aK9,aBB9,0).toFixed(2)}`,hp&&ap?88:45),
    module('Starter workload', (hExpIP-aExpIP)/2.5,hExpIP>=aExpIP?'home':'away',`Expected innings: home ${hExpIP.toFixed(1)}, away ${aExpIP.toFixed(1)}; recent avg pitches home ${num(hWork.avgPitches,0).toFixed(0)}, away ${num(aWork.avgPitches,0).toFixed(0)}.`,hp&&ap?78:40),
    module('Offense / run support', (hOff-aOff)*1.55,hOff>aOff?'home':'away',`Season + regressed recent offense: home R/G ${hRpg.toFixed(2)}, OPS ${hOps.toFixed(3)}, recent R/G ${num(hr.pf,hRpg).toFixed(2)}; away R/G ${aRpg.toFixed(2)}, OPS ${aOps.toFixed(3)}, recent R/G ${num(ar.pf,aRpg).toFixed(2)}.`,84),
    module('Bullpen availability',(hBull.availability-aBull.availability)/45,hBull.availability>=aBull.availability?'home':'away',`Verified recent bullpen workload: home availability ${hBull.availability.toFixed(0)}/100 (${hBull.heavyCount} heavy arms), away ${aBull.availability.toFixed(0)}/100 (${aBull.heavyCount} heavy arms).`,hBull.verified&&aBull.verified?82:45),
    module('Staff pitching',(aEra-hEra)/3.1,aEra>hEra?'home':'away',`Home staff ERA ${hEra.toFixed(2)} vs away ${aEra.toFixed(2)}.`,72),
    module('Recent form (capped)',clamp(((hr.margin||0)-(ar.margin||0))/5,-.65,.65),(hr.margin||0)>(ar.margin||0)?'home':'away',`Last ~10 run margin: home ${(hr.margin??0).toFixed(2)}, away ${(ar.margin??0).toFixed(2)}. Weight capped to avoid recency overreaction.`,58),
    module('Home field',.07,'home','Home-field batting/last-at-bat adjustment.',70),
    module('Lineup confirmation',0,'neutral',lineups.confirmed?`Both batting orders posted (${lineups.awayCount}/${lineups.homeCount}).`:`Batting orders not yet fully posted (${lineups.awayCount||0}/${lineups.homeCount||0}).`,lineups.confirmed?92:28)
  ];
  if(weather)mods.push(module('Environment',wAdj/3,wAdj>=0?'over':'under',`${weatherSummary(weather)}. Temperature is used modestly; wind direction is not known, so wind speed alone does not create a run boost.`,65));
  const totalDrivers=[
    module('Combined offense environment',(((hOff+aOff)/2)-1)*2.4,((hOff+aOff)/2)>=1?'over':'under',`Combined regressed offense index ${(((hOff+aOff)/2)*100).toFixed(0)} (100 = league average).`,82),
    module('Starting-pitcher run environment',(((hspSkill+aspSkill)/2)-1)*2.1,((hspSkill+aspSkill)/2)>=1?'over':'under',`Starter run factors: home ${hspSkill.toFixed(2)}, away ${aspSkill.toFixed(2)} (above 1.00 = more runs allowed).`,hp&&ap?84:42),
    module('Staff run environment',(((hEra+aEra)/(2*4.35))-1)*2.0,(hEra+aEra)>=8.7?'over':'under',`Combined staff ERA ${(hEra+aEra).toFixed(2)} vs neutral 8.70.`,72),
    module('Bullpen fatigue environment',(((100-hBull.availability)+(100-aBull.availability)-50)/70),((100-hBull.availability)+(100-aBull.availability))>=50?'over':'under',`Combined bullpen fatigue load ${(200-hBull.availability-aBull.availability).toFixed(0)}; availability home ${hBull.availability.toFixed(0)}, away ${aBull.availability.toFixed(0)}.`,hBull.verified&&aBull.verified?80:42)
  ];
  if(weather)totalDrivers.push(module('Weather run environment',wAdj/0.8,wAdj>=0?'over':'under',`${weatherSummary(weather)}; weather adjustment ${wAdj>=0?'+':''}${wAdj.toFixed(2)} runs.`,62));
  const criticalPenalty=(hp&&ap?0:12)+(lineups.confirmed?0:7)+(hBull.verified&&aBull.verified?0:8); let dq=38+(hh&&ah?14:0)+(hpStaff&&apStaff?10:0)+(hp&&ap&&hsp&&asp?16:0)+(hlog&&alog?8:0)+(recent?6:0)+(hBull.verified&&aBull.verified?9:0)+(weather?3:0)+(lineups.confirmed?9:0); dq=Math.min(dq,lineups.confirmed?94:85); dq=clamp(dq-criticalPenalty/2,30,96); const uncertainty=clamp(100-dq+(hp&&ap?0:12)+(lineups.confirmed?0:hoursUntil(event.commence_time)<4?7:2)+(hBull.verified&&aBull.verified?0:5)); const rawAgr=agreement(mods),coverage=coverageScore(mods,'baseball_mlb',criticalPenalty),effAgr=effectiveAgreement(rawAgr,coverage,dq); const ec=edgeCount(mods,homeProb>=.5);
  const f5Away=clamp((lg*aOff*hspSkill)*(5/9),.7,5.4),f5Home=clamp((lg*hOff*aspSkill)*(5/9)+.10,.7,5.7),f5Total=f5Away+f5Home,f5Margin=f5Home-f5Away,tieRisk=clamp(.23-.018*(f5Total-4),.12,.27);
  const risks=[]; if(!hp||!ap)risks.push('One or both probable starters are not confirmed.'); if(!lineups.confirmed)risks.push('Starting lineups are not confirmed yet; AEGIS will not release a Core MLB bet close to first pitch without them.'); if(!(hBull.verified&&aBull.verified))risks.push('Recent bullpen workload could not be fully verified.'); else if(hBull.heavyCount||aBull.heavyCount)risks.push(`Bullpen fatigue exists: home ${hBull.heavyCount} heavy-use arm(s), away ${aBull.heavyCount}.`); if(weather?.precip_probability>=60)risks.push('Elevated precipitation risk can alter pitcher usage or game timing.');
  return {event_id:event.id,sport:event.sport_key,away_team:event.away_team,home_team:event.home_team,projected_score:{away:+awayRuns.toFixed(1),home:+homeRuns.toFixed(1)},projected_total:+total.toFixed(1),projected_margin_home:+margin.toFixed(1),home_win_probability:homeProb,data_quality:dq,uncertainty,model_agreement:rawAgr,coverage_score:coverage,effective_agreement:effAgr,independent_edge_count:ec,lineups_confirmed:!!lineups.confirmed,bullpen_verified:!!(hBull.verified&&aBull.verified),total_drivers:totalDrivers,f5:{projected_score:{away:+f5Away.toFixed(1),home:+f5Home.toFixed(1)},projected_total:+f5Total.toFixed(1),projected_margin_home:+f5Margin.toFixed(1),tie_risk:tieRisk},modules:mods,risks,weather,notes:[`Probable starters: ${ap?.fullName||'TBD'} vs ${hp?.fullName||'TBD'}`,lineups.confirmed?'Lineups confirmed by MLB feed.':'Lineups not yet confirmed.',`Bullpen availability: away ${aBull.availability.toFixed(0)}/100, home ${hBull.availability.toFixed(0)}/100.`,`F5 projection ${event.away_team} ${f5Away.toFixed(1)} – ${event.home_team} ${f5Home.toFixed(1)}; estimated tie risk ${(tieRisk*100).toFixed(0)}%.`],sources};
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
    const hmSp=findRatingMatch(cfbd.sp,event.home_team),amSp=findRatingMatch(cfbd.sp,event.away_team),hsp=hmSp.row,asp=amSp.row;
    const hmPrev=findRatingMatch(cfbd.priorSp,event.home_team),amPrev=findRatingMatch(cfbd.priorSp,event.away_team),hPrev=hmPrev.row,aPrev=amPrev.row;
    const hc=findRating(cfbd.core,event.home_team),ac=findRating(cfbd.core,event.away_team),he=findRating(cfbd.elo,event.home_team),ae=findRating(cfbd.elo,event.away_team);
    const hpCore=findRating(cfbd.priorCore,event.home_team),apCore=findRating(cfbd.priorCore,event.away_team),hpElo=findRating(cfbd.priorElo,event.home_team),apElo=findRating(cfbd.priorElo,event.away_team);
    const minGames=Math.min(hm.games||0,am.games||0),currentWeight=ncaafCurrentWeight(minGames),scheduleWeight=ncaafScheduleWeight(minGames);
    let mappingCollision=!!((hsp&&asp&&normalizeTeam(hsp.team)===normalizeTeam(asp.team))||(hPrev&&aPrev&&normalizeTeam(hPrev.team)===normalizeTeam(aPrev.team)));
    if(mappingCollision){ advanced=false; }
    else if((hsp&&asp)||(hPrev&&aPrev)){
      const currentDiff=(hsp&&asp)?clamp(num(hsp.rating)-num(asp.rating),-28,28):null,priorDiff=(hPrev&&aPrev)?clamp(num(hPrev.rating)-num(aPrev.rating),-28,28):null;
      let blendedSp=blendPriorCurrent(currentDiff,priorDiff,currentWeight);
      const homeClass=conferenceClass(hsp?.conference||hPrev?.conference),awayClass=conferenceClass(asp?.conference||aPrev?.conference),crossClass=homeClass!==awayClass&&homeClass!=='unknown'&&awayClass!=='unknown';
      let classBaseline=0;
      if(crossClass){ if(homeClass==='fbs'&&awayClass!=='fbs')classBaseline=7; else if(awayClass==='fbs'&&homeClass!=='fbs')classBaseline=-7; blendedSp=.65*blendedSp+.35*classBaseline; }
      ratingMargin=blendedSp+cfg.homeAdv; advanced=true;
      ncaafMeta={minGames,currentWeight,scheduleWeight,currentDiff,priorDiff,blendedSp,homeClass,awayClass,crossClass,classBaseline,homeMatch:hmSp,awayMatch:amSp,homePriorMatch:hmPrev,awayPriorMatch:amPrev,priorMissing:priorDiff==null};
      const dir=blendedSp>=0?'home':'away',homeMatched=hsp?.team||hPrev?.team||event.home_team,awayMatched=asp?.team||aPrev?.team||event.away_team;
      mods.push(module('SP+ / true strength prior blend',blendedSp/12,dir,`Current SP+ diff ${currentDiff==null?'unavailable':currentDiff.toFixed(1)}; prior-year diff ${priorDiff==null?'unavailable (current rating shrunk toward neutral)':priorDiff.toFixed(1)}; current-season weight ${(currentWeight*100).toFixed(0)}%. Current matches: ${homeMatched} vs ${awayMatched}. Prior matches: ${hPrev?.team||'none'} vs ${aPrev?.team||'none'}.`,minGames<3?74:88));
      if(hsp?.offense&&asp?.offense){const d=num(hsp.offense.rating)-num(asp.offense.rating);mods.push(module('Offense / success / explosiveness',d/18,d>=0?'home':'away',`Current SP+ offense rating ${num(hsp.offense.rating).toFixed(1)} vs ${num(asp.offense.rating).toFixed(1)}; early-season confidence is reduced until sample grows.`,minGames<3?62:82));}
      if(hsp?.defense&&asp?.defense){const d=num(asp.defense.rating)-num(hsp.defense.rating);mods.push(module('Defense / havoc',d/18,d>=0?'home':'away',`Current SP+ defense rating ${num(hsp.defense.rating).toFixed(1)} vs ${num(asp.defense.rating).toFixed(1)}; lower defense rating is treated as better.`,minGames<3?62:82));}
      if(hsp?.specialTeams&&asp?.specialTeams){const d=num(hsp.specialTeams.rating)-num(asp.specialTeams.rating);mods.push(module('Special teams',d/5,d>=0?'home':'away','CFBD SP+ special-teams component; weight remains modest.',70));}
      if(crossClass)mods.push(module('FBS/FCS classification prior',classBaseline/10,classBaseline>=0?'home':'away',`Cross-classification shrink applied: home ${homeClass}, away ${awayClass}. A modest FBS baseline is blended with ratings rather than treated as a hard spread.`,72));
    }
    if(hc&&ac){const cur=num(hc.overall)-num(ac.overall),prev=(hpCore&&apCore)?num(hpCore.overall)-num(apCore.overall):null,bd=blendPriorCurrent(cur,prev,currentWeight);mods.push(module('CORE efficiency prior blend',bd/15,bd>=0?'home':'away',`CORE overall diff current ${cur.toFixed(1)}; prior ${prev==null?'unavailable':prev.toFixed(1)}. Early-season CORE is explicitly shrunk because its sample is smaller.`,minGames<3?60:80));}
    if(he&&ae){const cur=num(he.elo)-num(ae.elo),prev=(hpElo&&apElo)?num(hpElo.elo)-num(apElo.elo):null,bd=blendPriorCurrent(cur,prev,currentWeight);mods.push(module('Elo prior blend',bd/250,bd>=0?'home':'away',`Elo diff current ${cur.toFixed(0)}; prior ${prev==null?'unavailable':prev.toFixed(0)}.`,minGames<3?64:74));}
    if(hmSp.ambiguous||amSp.ambiguous)mods.push(module('CFBD team mapping integrity',0,'neutral','At least one current-year CFBD team-name match was ambiguous, so the uncertain rating match was rejected.',95));
    if((hmPrev.matched&&!hPrev)||(amPrev.matched&&!aPrev))mods.push(module('CFBD prior mapping integrity',0,'neutral',`A prior-year candidate was rejected as too generic/ambiguous (${hmPrev.matched||'none'} / ${amPrev.matched||'none'}). No false prior is substituted.`,100));
    if(mappingCollision)mods.push(module('CFBD team mapping integrity',0,'neutral','Home and away resolved to the same CFBD team; advanced ratings were discarded for this game.',100));
    sources.push({name:'CollegeFootballData free API',url:'https://api.collegefootballdata.com/'});
  }
  const schedMargin=(hm.margin??0)-(am.margin??0); if(ratingMargin!=null){ const sw=ncaafMeta?.scheduleWeight??.28; let blended=(1-sw)*ratingMargin+sw*(schedMargin/2+cfg.homeAdv); if(ncaafMeta?.crossClass&&ncaafMeta.minGames<3){ const againstFbs=(ncaafMeta.homeClass==='fbs'&&blended<-6)||(ncaafMeta.awayClass==='fbs'&&blended>6); if(againstFbs)blended=clamp(blended,-6,6); } const totalBase=homeScore+awayScore; homeScore=totalBase/2+blended/2;awayScore=totalBase/2-blended/2; }
  mods.push(module('Season scoring / efficiency proxy',schedMargin/(event.sport_key==='basketball_wnba'?16:12),schedMargin>=0?'home':'away',`Home PF/PA ${hpf.toFixed(1)}/${hpa.toFixed(1)}; away PF/PA ${apf.toFixed(1)}/${apa.toFixed(1)}`,hm.games>=3&&am.games>=3?78:45));
  const recentDiff=(hm.recentMargin??hm.margin??0)-(am.recentMargin??am.margin??0); mods.push(module('Current form (capped)',recentDiff/(event.sport_key==='basketball_wnba'?18:15),recentDiff>=0?'home':'away',`Recent margin trend: home ${(hm.recentMargin??0).toFixed(1)}, away ${(am.recentMargin??0).toFixed(1)}`,Math.min(65,40+(hm.games+am.games)*2)));
  mods.push(module('Home field / court',cfg.homeAdv/(event.sport_key==='basketball_wnba'?5:7),'home',`Home adjustment ${cfg.homeAdv.toFixed(1)} points.`,70));
  if(hn.some(x=>x.critical)||an.some(x=>x.critical)||hsRisk.injuryHits||asRisk.injuryHits)mods.push(module('Availability / injury signal',0,'neutral','Free structured/news feed contains availability-related language; exact impact may be unresolved.',52));
  const wAdj=weatherTotalAdjustment(event.sport_key,weather,venue.indoor); if(weather&&!venue.indoor)mods.push(module('Weather',wAdj/5,wAdj>=0?'over':'under',weatherSummary(weather),65)); homeScore+=wAdj/2;awayScore+=wAdj/2;
  let margin=homeScore-awayScore,total=homeScore+awayScore; if(event.sport_key==='baseball_kbo'||event.sport_key==='baseball_npb'){homeScore=Math.max(1.4,homeScore);awayScore=Math.max(1.4,awayScore);margin=homeScore-awayScore;total=homeScore+awayScore;}
  const totalDrivers=[
    module('Scoring environment',(((hpf+apf)/(2*avg))-1)*2,(hpf+apf)>=2*avg?'over':'under',`Combined scoring ${hpf.toFixed(1)} + ${apf.toFixed(1)} vs neutral ${(2*avg).toFixed(1)}.`,hm.games>=3&&am.games>=3?74:42),
    module('Points/runs allowed environment',(((hpa+apa)/(2*avg))-1)*2,(hpa+apa)>=2*avg?'over':'under',`Combined points/runs allowed ${hpa.toFixed(1)} + ${apa.toFixed(1)} vs neutral ${(2*avg).toFixed(1)}.`,hm.games>=3&&am.games>=3?72:42)
  ];
  if(Number.isFinite(hm.recentPF)&&Number.isFinite(am.recentPF))totalDrivers.push(module('Recent scoring environment',(((hm.recentPF+am.recentPF)/(2*avg))-1)*1.2,(hm.recentPF+am.recentPF)>=2*avg?'over':'under',`Recent scoring: home ${hm.recentPF.toFixed(1)}, away ${am.recentPF.toFixed(1)}. Weight capped.`,56));
  if(weather&&!venue.indoor)totalDrivers.push(module('Weather total pressure',wAdj/(event.sport_key.startsWith('americanfootball')?4:2),wAdj>=0?'over':'under',weatherSummary(weather),62));
  let dq=35+(hm.games>=3&&am.games>=3?24:hm.games+am.games>0?12:0)+(summary?6:0)+(news?5:0)+(weather||venue.indoor?5:0)+(advanced?18:0); let cap=78;
  if(event.sport_key==='americanfootball_ncaaf'){
    cap=advanced?90:68;
    if(ncaafMeta){ if(ncaafMeta.minGames<2)cap=Math.min(cap,78); else if(ncaafMeta.minGames<4)cap=Math.min(cap,84); if(ncaafMeta.crossClass&&ncaafMeta.minGames<3)cap=Math.min(cap,76); if(ncaafMeta.priorDiff==null&&ncaafMeta.minGames<3)cap=Math.min(cap,72); }
  }
  if(event.sport_key==='americanfootball_nfl_preseason')cap=hn.concat(an).some(x=>/qb2|qb3|rotation|starter|joint practice|play.*quarter|snap/i.test(`${x.headline} ${x.description}`))?68:58;
  if(event.sport_key==='baseball_kbo')cap=62;if(event.sport_key==='baseball_npb')cap=65;if(event.sport_key==='basketball_wnba')cap=78;
  dq=Math.min(cap,dq); const injuryPenalty=Math.min(12,(hn.filter(x=>x.critical).length+an.filter(x=>x.critical).length)*3+Math.min(6,hsRisk.injuryHits+asRisk.injuryHits)); dq=Math.max(30,dq-injuryPenalty); const uncertainty=clamp(100-dq+(event.sport_key==='americanfootball_nfl_preseason'?18:0)); const homeProb=clamp01(normCdf(margin/cfg.marginSd)); const agr=agreement(mods),coverage=coverageScore(mods,event.sport_key,event.sport_key==='americanfootball_nfl_preseason'?15:injuryPenalty/2),effAgr=effectiveAgreement(agr,coverage,dq),ec=edgeCount(mods,homeProb>=.5); const risks=[];
  if((hm.games||0)<3||(am.games||0)<3){ if(event.sport_key==='americanfootball_ncaaf')risks.push(`Early-season NCAAF sample: current results are intentionally downweighted (${Math.round((ncaafMeta?.currentWeight??.18)*100)}% current / ${100-Math.round((ncaafMeta?.currentWeight??.18)*100)}% prior when prior ratings exist).`); else risks.push('Small current-season sample in the free schedule feed.'); }
  if(event.sport_key==='americanfootball_ncaaf'&&ncaafMeta?.crossClass)risks.push(`FBS/FCS crossover uncertainty: ${ncaafMeta.homeClass} home vs ${ncaafMeta.awayClass} away; classification shrink and stricter release limits are active.`);
  if(event.sport_key==='americanfootball_ncaaf'&&(ncaafMeta?.homeMatch?.ambiguous||ncaafMeta?.awayMatch?.ambiguous))risks.push('CFBD current-year team-name mapping was ambiguous for at least one team; the uncertain advanced rating was rejected.');
  if(event.sport_key==='americanfootball_ncaaf'&&ncaafMeta?.priorMissing&&ncaafMeta?.minGames<3)risks.push('No valid prior-year SP+ pair was available; current-year SP+ is heavily shrunk toward neutral rather than given a minimum floor.');
  if(injuryPenalty>0)risks.push('Availability-related news exists but the deterministic engine cannot fully interpret every player impact.'); if(event.sport_key==='americanfootball_nfl_preseason')risks.push('Free structured feeds do not reliably confirm full QB2/QB3 snap plans; large-favorite/Core gates are intentionally strict.'); if((event.sport_key==='baseball_kbo'||event.sport_key==='baseball_npb')&&!hm.games)risks.push('Foreign-league structured data coverage is thin; AEGIS will usually PASS instead of anchoring to the market.');
  return {event_id:event.id,sport:event.sport_key,away_team:event.away_team,home_team:event.home_team,projected_score:{away:+awayScore.toFixed(1),home:+homeScore.toFixed(1)},projected_total:+total.toFixed(1),projected_margin_home:+margin.toFixed(1),home_win_probability:homeProb,data_quality:dq,uncertainty,model_agreement:agr,coverage_score:coverage,effective_agreement:effAgr,independent_edge_count:ec,total_drivers:totalDrivers,modules:mods,risks,weather,ncaaf_integrity:ncaafMeta,notes:[venue.name?`Venue: ${venue.name}`:'Venue unavailable',advanced?'CFBD advanced ratings active with strict team mapping + early-season prior blending.':'CFBD advanced ratings not active.',...(ncaafMeta?[`NCAAF current-season weight ${(ncaafMeta.currentWeight*100).toFixed(0)}%; schedule-result weight ${(ncaafMeta.scheduleWeight*100).toFixed(0)}%.`,ncaafMeta.crossClass?`Cross-classification shrink active (${ncaafMeta.homeClass} vs ${ncaafMeta.awayClass}).`:'Same classification / no crossover shrink.']:[])],news:[...hn.map(x=>({team:event.home_team,...x})),...an.map(x=>({team:event.away_team,...x}))].slice(0,10),sources};
}

async function analyzeEvent(event){ if(event.sport_key==='baseball_mlb')return analyzeMLB(event); return analyzeESPN(event); }

function marketCushion(sport,market,proj){ let c=market==='h2h'?.025:market==='spreads'?.03:.035; if(sport==='baseball_mlb'&&market==='spreads')c=.04; if(sport==='baseball_npb'&&market==='totals'&&proj.projected_total!=null&&proj.projected_total<=6.5)c=.055; if(sport==='americanfootball_nfl_preseason')c+=.015; if(proj.data_quality<70)c+=.01; return c; }
function uncertaintyShrink(prob,proj){ const q=clamp(proj.data_quality)/100,unc=clamp(proj.uncertainty)/100,rel=Math.max(.18,Math.min(.95,q*(1-.45*unc))); return .5+(prob-.5)*rel; }
function getPairOutcome(pair,name){ return pair.outcomes.find(o=>sameTeam(o.name,name)||String(o.name).toLowerCase()===String(name).toLowerCase()); }
function marketCandidate(event,proj,pair,market){
  const home=event.home_team,away=event.away_team; let sideName,oppName,fairRaw,point=null,fit=0,thesis='';
  if(market==='h2h'){ const homeLean=proj.home_win_probability>=.5; sideName=homeLean?home:away;oppName=homeLean?away:home;fairRaw=homeLean?proj.home_win_probability:1-proj.home_win_probability; fit=Math.abs(fairRaw-.5); thesis=`${sideName} moneyline`; }
  else if(market==='spreads'){
    const ho=getPairOutcome(pair,home),ao=getPairOutcome(pair,away); if(!ho||!ao||ho.point==null||ao.point==null)return null; const sd=event.sport_key==='baseball_mlb'?2.85:(ESPN[event.sport_key]?.marginSd||12); const homeCoverMargin=proj.projected_margin_home+Number(ho.point); const homeCover=normCdf(homeCoverMargin/sd); const homeLean=homeCover>=.5; sideName=homeLean?home:away;oppName=homeLean?away:home; const so=homeLean?ho:ao;point=so.point;fairRaw=homeLean?homeCover:1-homeCover;fit=Math.abs(homeCoverMargin)/(event.sport_key==='baseball_mlb'?1.7:5); thesis=`${sideName} ${point>0?'+':''}${point}`;
  } else if(market==='totals'){
    if(proj.projected_total==null)return null; const over=pair.outcomes.find(o=>String(o.name).toLowerCase()==='over'),under=pair.outcomes.find(o=>String(o.name).toLowerCase()==='under'); if(!over||!under||over.point==null)return null; const sd=event.sport_key==='baseball_mlb'?2.9:event.sport_key==='basketball_wnba'?12:event.sport_key.startsWith('americanfootball')?14:3; const overProb=normCdf((proj.projected_total-Number(over.point))/sd); const overLean=overProb>=.5; sideName=overLean?'Over':'Under';oppName=overLean?'Under':'Over'; const so=overLean?over:under; point=so.point;fairRaw=overLean?overProb:1-overProb;fit=Math.abs(proj.projected_total-Number(point))/(event.sport_key==='baseball_mlb'?1.7:6);thesis=`${sideName} ${point}`;
  }
  const so=getPairOutcome(pair,sideName),oo=getPairOutcome(pair,oppName); if(!so||!oo)return null; let pushProbability=0; if(event.sport_key==='baseball_mlb'&&(market==='spreads'||market==='totals')){ const discrete=mlbDiscreteMarket(proj,market,sideName,point,home,away); if(discrete){fairRaw=discrete.prob;pushProbability=discrete.push||0;} } const [bookSp]=fairTwoWay(so.price,oo.price); if(bookSp==null)return null; const consensus=marketConsensus(event,market,sideName,oppName,point),sp=consensus.prob??bookSp; const dq=clamp(proj.data_quality); let cov=clamp(proj.coverage_score??dq),eff=clamp(proj.effective_agreement??proj.model_agreement),rawAgree=clamp(proj.model_agreement),marketEdgeN=proj.independent_edge_count,marketSupport=0; 
  if(market==='totals'){const td=proj.total_drivers||[];const overLean=String(sideName).toLowerCase()==='over';rawAgree=agreement(td);cov=driverCoverage(td,event.sport_key==='baseball_mlb'?4:3);eff=effectiveAgreement(rawAgree,cov,dq);marketEdgeN=edgeCount(td,overLean);marketSupport=supportStrength(td,overLean);}
  else {const selectedHome=sameTeam(sideName,home);marketSupport=supportStrength(proj.modules||[],selectedHome);} const independentFair=uncertaintyShrink(fairRaw,proj); const trust=Math.max(.32,Math.min(.72,.32+.42*(dq/100)*(cov/100)*(eff/100))); const fair=clamp01(sp+(independentFair-sp)*trust); const signedDivergence=independentFair-sp,divergence=Math.abs(signedDivergence),rawDivergence=Math.abs(fairRaw-sp); const bandW=uncertaintyWidth(proj,market); const fairLow=clamp01(fair-bandW),fairHigh=clamp01(fair+bandW); const marketInsideFairRange=sp>=fairLow&&sp<=fairHigh;
  let cushion=marketCushion(event.sport_key,market,proj); let edge=fair-sp; const ev=evFromAmerican(fair,so.price); const selectedAway=market!=='totals'&&sameTeam(sideName,away); if(selectedAway&&Number(so.price)<0)cushion+=.007; if(Number(so.price)<=-220)cushion+=.008; if(market==='totals'&&dq<76)cushion+=.01; if(consensus.dispersion>.02)cushion+=.005; const sanityFlags=[]; if(divergence>=.12)sanityFlags.push('Extreme market disagreement: independent fair differs from consensus by at least 12 percentage points.'); else if(divergence>=.08)sanityFlags.push('Elevated market disagreement: independent fair differs from consensus by at least 8 percentage points.'); if(consensus.books<2)sanityFlags.push('Market challenger has limited multi-book consensus coverage.');
  let gate='PASS'; const edgeN=marketEdgeN;
  if(dq>=80&&cov>=76&&eff>=69&&rawAgree>=64&&edgeN>=2&&marketSupport>=55&&edge>=cushion&&ev>=.02)gate='CORE'; else if(dq>=66&&cov>=60&&eff>=59&&rawAgree>=56&&edgeN>=2&&marketSupport>=42&&edge>=cushion*.72&&ev>=.005)gate='SECONDARY'; else if(edge>0&&dq>=50)gate='WATCH';
  if(divergence>=.12&&gate!=='PASS')gate='WATCH'; else if(divergence>=.08&&gate==='CORE')gate=(dq>=88&&cov>=82&&eff>=75&&consensus.books>=3)?'SECONDARY':'WATCH';
  if(marketInsideFairRange){sanityFlags.push('Uncertainty-band overlap: the market challenger sits inside the calibrated fair-probability range.'); if(gate==='CORE')gate='SECONDARY'; else if(gate==='SECONDARY'&&edge<cushion*1.25)gate='WATCH';}
  if(event.sport_key==='baseball_mlb'){
    const hrs=hoursUntil(event.commence_time); if(hrs<=4&&!proj.lineups_confirmed&&['CORE','SECONDARY'].includes(gate)){gate='WATCH';sanityFlags.push('MLB lineup confirmation gate: batting orders are not fully posted close to first pitch.');}
    if(!proj.bullpen_verified&&gate==='CORE'){gate='SECONDARY';sanityFlags.push('MLB bullpen verification gate: recent reliever workload is incomplete.');}
    if(market==='totals'&&(!proj.bullpen_verified||!proj.lineups_confirmed)&&gate==='CORE'){gate='SECONDARY';sanityFlags.push('Fragile Totals Guard: bullpen/lineup uncertainty prevents a Core total.');}
  }
  if(event.sport_key==='americanfootball_ncaaf'){
    const ni=proj.ncaaf_integrity;
    if(ni?.minGames<2&&gate==='CORE'){gate='SECONDARY';sanityFlags.push('NCAAF early-season prior gate: fewer than two current-season games prevents Core release.');}
    if(ni?.crossClass&&ni.minGames<3&&['CORE','SECONDARY'].includes(gate)){gate='WATCH';sanityFlags.push('FBS/FCS crossover gate: early-season cross-classification projections require stronger confirmation.');}
    if((ni?.homeMatch?.ambiguous||ni?.awayMatch?.ambiguous)&&gate!=='PASS'){gate='WATCH';sanityFlags.push('CFBD mapping-integrity gate: ambiguous team mapping prevents release.');}
  }
  if(event.sport_key==='americanfootball_nfl_preseason'&&gate==='CORE')gate='SECONDARY';
  if(event.sport_key==='americanfootball_nfl_preseason'&&market==='spreads'&&Math.abs(Number(point)||0)>3.5&&dq<68)gate='PASS';
  return {event_id:event.id,market,selection:sideName,point,price:Number(so.price),book:pair.book,book_key:pair.book_key,hard_rock:pair.hard_rock,last_update:pair.last_update,market_probability:sp,book_market_probability:bookSp,market_consensus_books:consensus.books,market_dispersion:consensus.dispersion,fair_probability:fair,fair_independent:independentFair,fair_raw:fairRaw,fair_probability_low:fairLow,fair_probability_high:fairHigh,market_prior_trust:trust,independent_disagreement:divergence,independent_disagreement_signed:signedDivergence,raw_market_gap:rawDivergence,market_inside_fair_range:marketInsideFairRange,push_probability:pushProbability,market_coverage:cov,market_model_agreement:rawAgree,market_effective_agreement:eff,market_edge_count:marketEdgeN,market_support_strength:marketSupport,adjusted_edge:edge,estimated_ev:ev,cushion,fit,thesis,tier:gate,sanity_flags:sanityFlags};
}

function candidateRank(c){ const tier={CORE:4,SECONDARY:3,WATCH:2,PASS:1}[c.tier]||0; return tier*100+(c.hard_rock?8:0)+(c.adjusted_edge||0)*100+(c.fit||0); }
function chooseMarket(event,proj){ const all=[]; for(const k of ['h2h','spreads','totals'])for(const p of quotePairs(event,k)){ const c=marketCandidate(event,proj,p,k); if(c)all.push(c); }
  if(!all.length)return {best:null,all:[]}; const hr=all.filter(c=>c.hard_rock&&c.tier!=='PASS'); let pool=hr.length?hr:all; pool=pool.sort((a,b)=>candidateRank(b)-candidateRank(a)); let best=pool[0]; if(!best.hard_rock&&['CORE','SECONDARY'].includes(best.tier)){best={...best,tier:'WATCH',execution_note:'Hard Rock Florida quote not available in the synced board; reference only until target-book price is verified.'};} return {best,all:all.sort((a,b)=>candidateRank(b)-candidateRank(a))}; }
function buildWhy(proj,c){ let good=[]; if(c.market==='totals'){good=proj.modules.filter(m=>/offense|starting pitcher|staff pitching|bullpen|environment/i.test(m.name)).sort((a,b)=>b.confidence-a.confidence).slice(0,4);}else{const wantHome=sameTeam(c.selection,proj.home_team);good=proj.modules.filter(m=>wantHome?m.value>0:m.value<0).sort((a,b)=>Math.abs(b.value)*b.confidence-Math.abs(a.value)*a.confidence).slice(0,3);} return `${c.thesis}. Independent projection ${proj.away_team} ${proj.projected_score.away??'—'} – ${proj.home_team} ${proj.projected_score.home??'—'}. Primary supporting modules: ${good.map(m=>`${m.name} (${m.evidence})`).join(' | ')||'limited structured evidence'}.`; }
function timing(event,c,proj){ const hrs=hoursUntil(event.commence_time),fresh=c.last_update?Math.abs(Date.now()-new Date(c.last_update).getTime())/60000:null; if(proj.data_quality<65||(proj.coverage_score??0)<58)return 'WAIT / PASS FOR CONFIRMATION'; if(event.sport_key==='baseball_mlb'&&hrs<=4&&!proj.lineups_confirmed)return 'WAIT — starting lineups are not fully confirmed'; if(c.sanity_flags?.length&&c.independent_disagreement>=.08)return 'WAIT — market disagreement requires stronger confirmation'; if(hrs>12)return 'WAIT — re-sync closer to game'; if(fresh!=null&&fresh>45)return 'WAIT — quote may be stale'; return 'BET NOW if target-book line still matches'; }
function finalVerification(proj,c){ const flags=[]; if(proj.data_quality<80)flags.push('data quality below Core threshold'); if((c.market_coverage??proj.coverage_score??0)<76)flags.push('market-specific model coverage below Core threshold'); if((c.market_edge_count??proj.independent_edge_count)<2)flags.push('fewer than two market-specific independent edges'); if((c.market_support_strength??0)<42)flags.push('market-specific support strength is below the Secondary threshold'); if((c.market_effective_agreement??proj.effective_agreement??proj.model_agreement)<69)flags.push('market-specific effective agreement below Core threshold'); if(c.market_inside_fair_range)flags.push('market price remains inside the calibrated uncertainty band'); if(!c.hard_rock)flags.push('Hard Rock price not verified'); if(c.sanity_flags?.length)flags.push(c.sanity_flags[0]); if(proj.risks.length)flags.push(proj.risks[0]); return flags.length?`Caution: ${[...new Set(flags)].join('; ')}.`:'Core release gates checked: data quality, coverage, effective agreement, two-edge gate, uncertainty-band separation, market sanity, price cushion, target book, and failure paths.'; }


function settledBetOutcome(record,score){
  if(!score||!score.final)return null;
  const hs=Number(score.home_score),as=Number(score.away_score); if(!Number.isFinite(hs)||!Number.isFinite(as))return null;
  const market=record.market,sel=String(record.selection||''),point=Number(record.point);
  let z=0;
  if(market==='h2h'){
    const homeSel=sameTeam(sel,record.home_team),awaySel=sameTeam(sel,record.away_team);
    if(!homeSel&&!awaySel)return null;
    z=homeSel?hs-as:as-hs;
  } else if(market==='spreads'){
    const homeSel=sameTeam(sel,record.home_team),awaySel=sameTeam(sel,record.away_team);
    if((!homeSel&&!awaySel)||!Number.isFinite(point))return null;
    z=(homeSel?hs-as:as-hs)+point;
  } else if(market==='totals'){
    if(!Number.isFinite(point))return null;
    z=hs+as-point;
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
      const final=g.status?.abstractGameState==='Final'||g.status?.detailedState==='Final';
      return {final, status:g.status?.detailedState||g.status?.abstractGameState||'', home_score:num(g.teams?.home?.score), away_score:num(g.teams?.away?.score), source:'MLB Stats API'};
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

async function scanSlate(events){ const capped=pregameOnly(events).slice(0,MAX_SCAN_GAMES); const analyses=[]; for(const e of capped){ try{const proj=await analyzeEvent(e); const market=chooseMarket(e,proj); analyses.push({event:sanitizeEvent(e),projection:proj,market});}catch(err){analyses.push({event:sanitizeEvent(e),projection:lowInfoProjection(e,err.message,30),market:{best:null,all:[]}});} }
  const valid=analyses.map(a=>a.market.best).filter(Boolean),extreme=valid.filter(c=>(c.independent_disagreement||0)>=.10); const slateSanity={triggered:extreme.length>=3&&extreme.length/Math.max(1,valid.length)>=.30,extreme_count:extreme.length,candidate_count:valid.length,message:''}; if(slateSanity.triggered){slateSanity.message=`Market Sanity Firewall triggered: ${extreme.length} of ${valid.length} top candidates show ≥10-point independent/market disagreement. Extreme candidates are capped at WATCH until stronger confirmation.`; for(const a of analyses){const c=a.market.best;if(c&&(c.independent_disagreement||0)>=.08&&['CORE','SECONDARY'].includes(c.tier)){c.tier='WATCH';c.sanity_flags=[...(c.sanity_flags||[]),slateSanity.message];}}}
  const released=[]; const passes=[]; for(const a of analyses){ const c=a.market.best,p=a.projection; if(!c||c.tier==='PASS'){passes.push({event_id:a.event.id,matchup:`${a.event.away_team} @ ${a.event.home_team}`,reason:!c?'No verified market matched the independent projection.':`Release gates failed: DQ ${p.data_quality.toFixed(0)}, market coverage ${(c.market_coverage??p.coverage_score??0).toFixed(0)}, market effective agreement ${(c.market_effective_agreement??p.effective_agreement??p.model_agreement).toFixed(0)}, market-specific edges ${c.market_edge_count??p.independent_edge_count}, adjusted edge ${fmtPct(c.adjusted_edge)} vs cushion ${fmtPct(c.cushion)}.`});continue;} released.push({event_id:a.event.id,event:a.event,projection:p,...c,why:buildWhy(p,c),how_it_loses:p.risks.slice(0,4),timing:timing(a.event,c,p),final_verification:finalVerification(p,c),units:c.tier==='CORE'?1:c.tier==='SECONDARY'?.5:0}); }
  released.sort((x,y)=>candidateRank(y)-candidateRank(x)); let cores=0; for(const p of released){ if(p.tier==='CORE'){cores++;if(cores>2){p.tier='SECONDARY';p.units=.5;p.final_verification+=' Precision Mode Core cap downgraded this play.';}} }
  const eligible=released.filter(x=>['CORE','SECONDARY'].includes(x.tier)&&x.hard_rock&&x.fair_probability>=.56&&(x.independent_disagreement||0)<.08).slice(0,3); let parlay=null; if(eligible.length>=2){ const legs=eligible.slice(0,2); let dec=1; for(const l of legs)dec*=l.price>0?1+l.price/100:1+100/(-l.price); const american=dec>=2?Math.round((dec-1)*100):Math.round(-100/(dec-1)); parlay={units:.25,legs:legs.map(l=>({event_id:l.event_id,selection:l.selection,point:l.point,market:l.market,price:l.price,book:l.book})),approx_american:american,rationale:'Optional only: both legs independently cleared straight-bet release gates, use distinct games, have verified Hard Rock quotes, and do not carry extreme market-disagreement flags.'}; }
  const grade=released.filter(x=>x.tier==='CORE').length>=2?'A':released.some(x=>x.tier==='CORE')?'B+':released.some(x=>x.tier==='SECONDARY')?'B':'PASS-HEAVY'; return {version:VERSION,generated_at:new Date().toISOString(),slate_grade:grade,slate_sanity:slateSanity,plays:released,passes,parlay,analyses}; }


const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#06131d"><title>SB101 AEGIS Command Center</title><style>
:root{--bg:#06131d;--panel:#0b1b28;--panel2:#0e2232;--panel3:#081823;--line:#244055;--line2:#31536a;--text:#f3f8fc;--muted:#9db0bf;--mint:#5ef0b7;--mint2:#1bcf91;--red:#ff7f88;--gold:#ffd36b;--blue:#7ab8ff;--shadow:0 14px 40px rgba(0,0,0,.24)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 50% -10%,#123249 0,#081b29 30%,#06131d 70%);color:var(--text);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}.wrap{max-width:1050px;margin:auto;padding:20px 18px 90px}.hero{padding:26px 2px 16px}.brandline{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.eyebrow{color:var(--mint);font-weight:900;letter-spacing:.14em;font-size:13px}.versionpill{font-size:11px;font-weight:900;border:1px solid #2f5a4b;color:#b7ffe3;border-radius:999px;padding:5px 9px;background:#0a261f}.hero h1{font-size:clamp(38px,7vw,64px);line-height:.98;margin:12px 0 10px;letter-spacing:-.035em}.hero .tagline{font-size:clamp(17px,3.6vw,22px);line-height:1.45;max-width:760px;margin:0 0 14px;color:#c4d4df}.hero strong{color:#fff}.muted{color:var(--muted)}.status{display:inline-flex;gap:9px;align-items:center;border:1px solid #2e6d59;border-radius:999px;padding:10px 14px;margin:10px 0;font-size:13px;background:#09241d;box-shadow:inset 0 0 0 1px rgba(94,240,183,.03)}.status:before{content:"";width:8px;height:8px;background:var(--mint);border-radius:50%;box-shadow:0 0 14px var(--mint)}.tabs{display:flex;gap:8px;overflow:auto;padding:12px 0;position:sticky;top:0;background:linear-gradient(180deg,#06131df9 76%,#06131d00);z-index:5;backdrop-filter:blur(8px)}.tab,.btn,select{border:1px solid var(--line);background:#0b1b28;color:var(--text);border-radius:15px;padding:13px 16px;font-size:15px}.tab{white-space:nowrap;font-weight:800;color:#b9c9d4}.tab.active{border-color:var(--mint);color:#fff;background:#0e2831;box-shadow:0 0 0 1px rgba(94,240,183,.08)}.btn{cursor:pointer;font-weight:900;letter-spacing:.01em}.btn.primary{background:linear-gradient(135deg,var(--mint),#55e0c9);color:#052018;border-color:var(--mint);box-shadow:0 10px 28px rgba(94,240,183,.12)}.btn.secondary{border-color:#5b9cce;background:#0c1d2b}.btn.ghost{background:transparent}.btn:disabled{opacity:.45}.panel,.game,.result{background:linear-gradient(180deg,rgba(13,31,45,.97),rgba(9,24,35,.96));border:1px solid var(--line);border-radius:24px;padding:20px;margin:16px 0;box-shadow:var(--shadow)}.mission{padding:22px}.mission h2{font-size:26px;margin:0 0 7px}.missioncopy{color:#b6c8d4;margin:0 0 18px;line-height:1.45}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.control{min-width:220px;flex:1}.control label{display:block;color:var(--muted);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}.control select{width:100%}.actionrow{display:grid;grid-template-columns:1fr 1.6fr;gap:10px;margin-top:14px}.truthline{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.truthchip{font-size:12px;color:#b8cad5;background:#081823;border:1px solid #203a4e;border-radius:999px;padding:7px 10px}.truthchip b{color:#fff}.game h3{font-size:20px;margin:6px 0 12px}.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.quote{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px;font-size:14px}.quote.hardrock{border-color:var(--mint)}.quote b{display:block;color:var(--muted);margin-bottom:5px}.progress{display:none;background:#0e2232;border:1px solid var(--blue);border-radius:20px;padding:18px;margin:16px 0}.progress.show{display:block}.bar{height:8px;background:#173247;border-radius:999px;overflow:hidden;margin-top:10px}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--mint),#7ab8ff);width:15%;transition:.3s}.badge{display:inline-flex;align-items:center;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:950;letter-spacing:.08em;margin-right:6px}.CORE{background:#174d3b;color:#80ffd2}.SECONDARY{background:#493d18;color:#ffe38a}.WATCH{background:#173650;color:#b9ddff}.PASS{background:#49242a;color:#ffb6bd}.slatehero{border:1px solid var(--line2);background:linear-gradient(135deg,#0b2231,#0b1925);border-radius:22px;padding:20px;margin-bottom:18px}.slatehero .label{color:var(--muted);font-size:11px;font-weight:900;letter-spacing:.12em}.slatehero h2{font-size:38px;line-height:1;margin:8px 0}.slatestats{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}.slatestat{background:#081823;border:1px solid #203a4e;border-radius:12px;padding:8px 10px;font-size:12px}.slatestat b{font-size:15px}.play{border:1px solid var(--line);border-left:5px solid var(--mint);border-radius:20px;padding:18px;margin:16px 0;background:linear-gradient(180deg,#0b1d2a,#081823);box-shadow:0 10px 28px rgba(0,0,0,.18)}.playhead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.matchup{font-weight:850;color:#d7e5ed;line-height:1.25}.pickline{font-size:clamp(26px,5vw,34px);font-weight:950;letter-spacing:-.025em;margin:13px 0 7px}.decisionline{color:#c1d1dc;font-size:13px;font-weight:800}.decisionline .fire{color:var(--mint)}.decisionline .hold{color:#a9d5ff}.decisionline .cut{color:#ffb1b8}.quickgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:16px 0}.quickmetric{background:#071721;border:1px solid #1f3a4e;border-radius:14px;padding:12px}.quickmetric b{display:block;color:var(--muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px}.quickmetric strong{font-size:18px}.readbox{background:#0b2330;border:1px solid #24506a;border-radius:16px;padding:14px;margin:12px 0}.readbox .kicker{font-size:11px;color:var(--mint);font-weight:900;letter-spacing:.1em;text-transform:uppercase}.readbox p{margin:7px 0 0;line-height:1.48;color:#e0ebf2}.blocker{background:#281d20;border:1px solid #6b3940;border-radius:16px;padding:14px;margin:10px 0;color:#ffd2d6}.blocker b{color:#fff}.deepdetails{margin-top:12px;border-top:1px solid #183247;padding-top:12px}.deepdetails summary{cursor:pointer;color:#cbe0ec;font-weight:900;padding:8px 0}.metricgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}.metric{background:#071721;border:1px solid #1f3a4e;border-radius:13px;padding:11px}.metric b{display:block;color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}.metric{font-size:15px}.risk{color:#ffc0c5}.models{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.model{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px}.hidden{display:none}.notice{border:1px solid #45596b;background:#0b1b28;border-radius:14px;padding:12px}.small{font-size:12px}.hr{height:1px;background:var(--line);margin:16px 0}.source{display:inline-block;margin:4px 8px 4px 0;color:#9fd2ff}.module{padding:9px 0;border-bottom:1px solid #183247}.warning{border-color:#7a6329;color:#ffe7a3;background:#211e13}.copyrow{display:flex;gap:10px;margin:12px 0}.copyrow .btn{flex:1}.labintro{padding-bottom:4px}.labintro h2{font-size:29px;margin:0 0 7px}.labnote{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px;margin:12px 0;color:#bdced8}.emptycall{text-align:center;padding:30px 16px}.emptycall h3{font-size:24px;margin:4px}.emptycall p{max-width:600px;margin:10px auto;color:var(--muted)}details{border-radius:14px}@media(max-width:720px){.wrap{padding-left:13px;padding-right:13px}.tab{min-width:112px}.controls{display:block}.control{margin-bottom:12px}.actionrow{grid-template-columns:1fr}.btn{width:100%;margin-top:0}.hero h1{font-size:44px}.quickgrid{grid-template-columns:1fr 1fr}.play{padding:16px}.playhead{display:block}.copyrow{display:block}.copyrow .btn{margin:7px 0}.slatehero h2{font-size:34px}}@media(max-width:390px){.quickgrid{grid-template-columns:1fr 1fr}.quickmetric strong{font-size:16px}.tab{min-width:105px;padding:12px 13px}}

.status.bad{border-color:#81404a;background:#2b151a;color:#ffd0d4}.status.bad:before{background:var(--red);box-shadow:0 0 14px var(--red)}
.healthgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;max-width:760px;margin:8px 0 4px}.healthchip{display:flex;flex-direction:column;gap:3px;background:#081823;border:1px solid #203a4e;border-radius:12px;padding:9px 11px;min-width:0}.healthchip b{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#d8e7ef}.healthchip span{font-size:11px;color:var(--mint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.healthchip.warnchip span{color:var(--gold)}.healthchip.badchip span{color:var(--red)}
.missiontop{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.missiontop h2{margin-top:5px}.missionmark{font-size:12px;font-weight:950;letter-spacing:.12em;color:#052018;background:var(--mint);padding:7px 9px;border-radius:999px;white-space:nowrap}.callstrip{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.callpill{display:inline-flex;align-items:center;gap:6px;border:1px solid #28465b;border-radius:999px;padding:7px 10px;font-size:12px;background:#081823}.callpill.fire{border-color:#2d765c;color:#98ffdb}.callpill.hold{border-color:#315f82;color:#b7ddff}.callpill.cut{border-color:#71343b;color:#ffc2c6}
.quickbrief{display:grid;grid-template-columns:1.25fr .75fr;gap:10px;margin:12px 0}.briefbox{background:#071721;border:1px solid #1f3a4e;border-radius:15px;padding:13px}.briefbox .kicker{font-size:10px;color:var(--muted);letter-spacing:.1em;font-weight:900;text-transform:uppercase;margin-bottom:5px}.briefbox .big{font-size:17px;font-weight:850;line-height:1.35}.verdict{border-radius:14px;padding:12px 13px;margin:10px 0;font-size:13px;line-height:1.4}.verdict.firev{background:#0b2b22;border:1px solid #2c765a}.verdict.holdv{background:#0b2234;border:1px solid #315f82}.verdict.cutv{background:#2a1519;border:1px solid #71343b}.verdict b{display:block;margin-bottom:3px}.tab{min-width:0}.tabs{overflow:visible}.copyrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
@media(max-width:720px){.wrap{padding-left:13px;padding-right:13px}.tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:9px 0}.tab{width:100%;padding:11px 8px;font-size:13px}.healthgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.actionrow{grid-template-columns:1fr}.quickgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.quickbrief{grid-template-columns:1fr}.play{padding:15px}.playhead{display:block}.decisionline{margin-top:8px}.pickline{font-size:25px}.slatehero h2{font-size:32px}.missionmark{display:none}}
@media(max-width:410px){.hero h1{font-size:40px}.healthchip{padding:8px}.tab{font-size:12px}.quickmetric strong{font-size:16px}}
</style></head><body><div class="wrap"><header class="hero"><div class="brandline"><div class="eyebrow">SB101 AEGIS</div><div class="versionpill">v5.3.1 • CFBD MAPPING INTEGRITY</div></div><h1>AEGIS Command Center</h1><p class="tagline"><strong>Research hard. Bet selectively.</strong> One tap turns the slate into a disciplined Core / Secondary / Watch / Pass decision — with the deep math available when you want it.</p><div class="status" id="status">Running system check…</div><div class="healthgrid" id="healthGrid"><div class="healthchip"><b>Odds</b><span>Checking…</span></div><div class="healthchip"><b>Sports data</b><span>Checking…</span></div><div class="healthchip"><b>Weather</b><span>Checking…</span></div><div class="healthchip"><b>NCAAF</b><span>Checking…</span></div></div></header>
<nav class="tabs"><button class="tab active" data-tab="dashboard">Command</button><button class="tab" data-tab="card">Final Card</button><button class="tab" data-tab="results">Results Lab</button><button class="tab" data-tab="models">Model Registry</button></nav>
<section id="dashboard"><div class="panel mission"><div class="missiontop"><div><div class="eyebrow">TODAY'S MISSION</div><h2>Find the edge. Make it prove itself.</h2></div><div class="missionmark">AEGIS</div></div><p class="missioncopy">Pick the sport and tap scan. AEGIS handles the research, projection, market challenge and release gates. <b>No sliders. No forced action.</b></p><div class="controls"><div class="control"><label>Sport</label><select id="sport"></select></div><div class="control"><label>Markets</label><select id="markets"><option value="h2h,spreads,totals">ML + Spread + Total</option><option value="h2h">Moneyline only</option><option value="spreads">Spread only</option><option value="totals">Total only</option></select></div></div><div class="actionrow"><button class="btn secondary" id="sync">REFRESH BOARD</button><button class="btn primary" id="scan">RUN FULL AEGIS SCAN</button></div><div class="truthline"><span class="truthchip"><b>Pregame only</b></span><span class="truthchip"><b>49 models</b></span><span class="truthchip"><b>Zero paid AI</b></span><span class="truthchip">PASS is a win when the edge is not proven</span></div><div id="quota" class="muted small" style="margin-top:12px"></div><div id="enhance" class="notice small"></div></div>
<div class="progress" id="progress"><b id="progressTitle">Scanning…</b><p class="muted" id="progressText"></p><div class="bar"><i id="progressBar"></i></div></div><div id="events"></div></section>
<section id="card" class="hidden"><div class="panel" id="cardContent"><h2>No scan yet</h2><p class="muted">Sync a pregame board and run the automatic slate scan.</p></div></section>
<section id="results" class="hidden"><div class="panel"><div class="labintro"><div class="eyebrow">THE RECEIPTS</div><h2>Results & Calibration Lab</h2><p class="muted">Every scan leaves a paper trail. AEGIS tracks what it saw, what it called, and what actually happened — without rewriting itself after one win or loss.</p><div class="labnote"><b>What matters:</b> calibration, released ROI, tier performance and whether our probabilities behave like real probabilities over time.</div></div><div class="metricgrid" id="auditMetrics"></div><div class="controls"><button class="btn primary" id="gradeResults">GRADE FINISHED GAMES</button><button class="btn secondary" id="exportResults">EXPORT BACKUP</button><button class="btn secondary" id="clearResults">CLEAR LOCAL HISTORY</button></div><div id="calibrationTable"></div><div id="tierTable"></div><div id="auditRows"></div></div></section>
<section id="models" class="hidden"><div class="panel"><h2>49-model AEGIS registry</h2><p class="muted">Models activate only when relevant and supported by verified inputs. Missing inputs never become fake neutral scores.</p><div class="models" id="modelGrid"></div></div></section>
</div><script>
let EVENTS=[],LAST=null,LAST_SYNC=0;const $=q=>document.querySelector(q),$$=q=>[...document.querySelectorAll(q)];const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));const fmtA=n=>{n=Number(n);return Number.isFinite(n)?(n>0?'+'+Math.round(n):Math.round(n)): '—'};const pct=n=>Number.isFinite(Number(n))?(Number(n)*100).toFixed(1)+'%':'—';const fmtPoint=(market,point,selection)=>{if(point==null)return '';const n=Number(point);if(market==='totals')return ' '+(Number.isInteger(n)?n:n.toFixed(1));return ' '+(n>0?'+':'')+(Number.isInteger(n)?n:n.toFixed(1));};
async function api(url,opt){const r=await fetch(url,opt),t=await r.text();let d;try{d=JSON.parse(t)}catch{d={error:t}};if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));return d}
function tab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));['dashboard','card','results','models'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==name)); if(name==='results')renderAudit()}$$('.tab').forEach(b=>b.onclick=()=>tab(b.dataset.tab));

const AUDIT_KEY='aegis_results_v5';
function loadAudit(){try{return JSON.parse(localStorage.getItem(AUDIT_KEY)||'[]')}catch{return []}}
function saveAudit(rows){try{localStorage.setItem(AUDIT_KEY,JSON.stringify(rows))}catch{}}
function auditKey(r){return [r.event_id,r.market,Number.isFinite(Number(r.point))?Number(r.point):'',r.selection].join('|')}
function auditProfit(r){
  if(!['CORE','SECONDARY'].includes(r.tier)||!r.units||!r.result)return 0;
  if(r.result==='PUSH')return 0;if(r.result==='LOSS')return -Number(r.units||0);
  const px=Number(r.price),stake=Number(r.units||0);return stake*(px>0?px/100:100/Math.abs(px));
}
function saveScanAudit(d){
  let rows=loadAudit(),by=new Map(rows.map(r=>[auditKey(r),r])),plays=new Map((d.plays||[]).map(p=>[p.event_id,p]));
  for(const a of d.analyses||[]){
    const c=plays.get(a.event?.id)||a.market?.best;if(!c)continue; const p=a.projection||{},e=a.event||c.event||{};
    const rec={event_id:e.id||c.event_id,sport_key:e.sport_key,commence_time:e.commence_time,home_team:e.home_team,away_team:e.away_team,
      market:c.market,selection:c.selection,point:c.point,price:Number(c.price),book:c.book,book_key:c.book_key,target_verified:!!c.hard_rock,
      tier:c.tier||'PASS',units:c.tier==='CORE'?1:c.tier==='SECONDARY'?.5:0,version:d.version||'',
      fair_probability:Number(c.fair_probability),fair_independent:Number(c.fair_independent),fair_raw:Number(c.fair_raw),market_probability:Number(c.market_probability),
      adjusted_edge:Number(c.adjusted_edge),estimated_ev:Number(c.estimated_ev),data_quality:Number(p.data_quality),market_coverage:Number(c.market_coverage),
      effective_agreement:Number(c.market_effective_agreement),market_edges:Number(c.market_edge_count),support_strength:Number(c.market_support_strength),
      uncertainty:Number(p.uncertainty),first_seen_at:d.generated_at,last_seen_at:d.generated_at,result:null,home_score:null,away_score:null,graded_at:null,
      snapshots:[]};
    const k=auditKey(rec),old=by.get(k);
    const snap={at:d.generated_at,price:rec.price,book:rec.book,tier:rec.tier,fair_probability:rec.fair_probability,market_probability:rec.market_probability,edge:rec.adjusted_edge,dq:rec.data_quality,coverage:rec.market_coverage,support:rec.support_strength};
    if(old){rec.first_seen_at=old.first_seen_at;rec.result=old.result;rec.home_score=old.home_score;rec.away_score=old.away_score;rec.graded_at=old.graded_at;rec.snapshots=[...(old.snapshots||[]),snap].slice(-20);Object.assign(old,rec);by.set(k,old)}
    else {rec.snapshots=[snap];rows.push(rec);by.set(k,rec)}
  }
  saveAudit(rows);renderAudit();
}
function calibrationBins(rows){
  const bins=[[.50,.55],[.55,.60],[.60,.65],[.65,.70],[.70,1.01]];return bins.map(([lo,hi])=>{const x=rows.filter(r=>r.result&&r.result!=='PUSH'&&Number(r.fair_probability)>=lo&&Number(r.fair_probability)<hi);const hit=x.filter(r=>r.result==='WIN').length;return {label:Math.round(lo*100)+'–'+Math.round(Math.min(1,hi)*100)+'%',n:x.length,pred:x.length?x.reduce((s,r)=>s+Number(r.fair_probability),0)/x.length:0,actual:x.length?hit/x.length:0}})
}
function renderAudit(){
  if(!$('#auditMetrics'))return;
  const rows=loadAudit(),graded=rows.filter(r=>r.result),decided=graded.filter(r=>r.result!=='PUSH'),action=graded.filter(r=>['CORE','SECONDARY'].includes(r.tier)&&r.units>0);
  const w=action.filter(r=>r.result==='WIN').length,l=action.filter(r=>r.result==='LOSS').length,pu=action.filter(r=>r.result==='PUSH').length;
  const risk=action.reduce((s,r)=>s+Number(r.units||0),0),profit=action.reduce((s,r)=>s+auditProfit(r),0);
  const brier=decided.length?decided.reduce((s,r)=>s+(Number(r.fair_probability)-(r.result==='WIN'?1:0))**2,0)/decided.length:null;
  const lineMove=graded.filter(r=>(r.snapshots||[]).length>1).map(r=>{const a=r.snapshots[0],b=r.snapshots[r.snapshots.length-1];return americanToProbClient(b.price)-americanToProbClient(a.price)}).filter(Number.isFinite);
  const lm=lineMove.length?lineMove.reduce((a,b)=>a+b,0)/lineMove.length:null;
  $('#auditMetrics').innerHTML=metric('Tracked markets',rows.length)+metric('Graded',graded.length)+metric('Released record',w+'–'+l+'–'+pu)+metric('Units P/L',(profit>=0?'+':'')+profit.toFixed(2)+'u')+metric('Released ROI',risk?((profit/risk)*100).toFixed(1)+'%':'—')+metric('Brier score',brier==null?'—':brier.toFixed(3))+metric('Avg last-observed price move',lm==null?'—':(lm*100).toFixed(2)+' pts');
  const bins=calibrationBins(rows);$('#calibrationTable').innerHTML='<div class="hr"></div><h3>Probability calibration</h3><div class="models">'+bins.map(b=>'<div class="model"><b>'+b.label+'</b><div>n='+b.n+'</div><div class="muted small">Avg forecast '+(b.n?(b.pred*100).toFixed(1)+'%':'—')+' • Actual '+(b.n?(b.actual*100).toFixed(1)+'%':'—')+'</div></div>').join('')+'</div><p class="muted small">Calibration stays observation-only until a meaningful sample is reached. AEGIS never rewrites model weights by itself.</p>';
  const tiers=['CORE','SECONDARY','WATCH','PASS'];$('#tierTable').innerHTML='<div class="hr"></div><h3>By release tier</h3><div class="models">'+tiers.map(t=>{const x=graded.filter(r=>r.tier===t&&r.result!=='PUSH'),ww=x.filter(r=>r.result==='WIN').length;return '<div class="model"><b>'+t+'</b><div>n='+x.length+'</div><div class="muted small">'+(x.length?((ww/x.length)*100).toFixed(1)+'% wins':'No graded sample')+'</div></div>'}).join('')+'</div>';
  $('#auditRows').innerHTML='<div class="hr"></div><h3>Recent tracked markets</h3>'+rows.slice().sort((a,b)=>new Date(b.commence_time)-new Date(a.commence_time)).slice(0,20).map(r=>'<div class="notice small"><b>'+esc(r.tier)+' • '+esc(r.away_team)+' @ '+esc(r.home_team)+'</b><br>'+esc(r.selection)+fmtPoint(r.market,r.point,r.selection)+' '+fmtA(r.price)+' • '+esc(r.book||'')+'<br><span class="muted">'+new Date(r.commence_time).toLocaleString()+' • '+(r.result?'<b>'+esc(r.result)+'</b> '+esc(r.away_score)+'–'+esc(r.home_score):'Pending')+'</span></div>').join('');
}
function americanToProbClient(x){x=Number(x);if(!Number.isFinite(x)||x===0)return NaN;return x>0?100/(x+100):(-x)/((-x)+100)}
async function gradeAudit(auto=false){
  let rows=loadAudit();const due=rows.filter(r=>!r.result&&new Date(r.commence_time).getTime()<Date.now()-2*3600e3).slice(0,100);if(!due.length){if(!auto)alert('No ungraded finished games are due yet.');return}
  try{if(!auto)$('#gradeResults').disabled=true;const d=await api('/api/results/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({records:due})});const map=new Map((d.results||[]).map(x=>[auditKey(x),x]));for(const r of rows){const z=map.get(auditKey(r));if(z&&z.final&&z.outcome){r.result=z.outcome;r.home_score=z.home_score;r.away_score=z.away_score;r.graded_at=new Date().toISOString();r.result_source=z.source||''}}saveAudit(rows);renderAudit()}catch(e){if(!auto)alert('Grade error: '+e.message)}finally{if($('#gradeResults'))$('#gradeResults').disabled=false}
}
function exportAudit(){const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),version:'5.2.1',records:loadAudit()},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='aegis-results-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function autoGrade(){const last=Number(localStorage.getItem('aegis_last_grade')||0);if(Date.now()-last>6*3600e3){localStorage.setItem('aegis_last_grade',String(Date.now()));gradeAudit(true)}}

async function init(){
  const status=$('#status'),hg=$('#healthGrid');
  try{
    const h=await api('/api/health');
    status.classList.remove('bad');
    status.textContent=(h.odds_ready?'AEGIS READY • live odds connected':'AEGIS READY • odds key needed')+' • '+h.models+' models';
    hg.innerHTML=
      '<div class="healthchip '+(h.odds_ready?'':'badchip')+'"><b>Odds</b><span>'+(h.odds_ready?'Connected':'Needs key')+'</span></div>'+ 
      '<div class="healthchip"><b>Sports data</b><span>Public feeds ready</span></div>'+ 
      '<div class="healthchip"><b>Weather</b><span>Open-Meteo ready</span></div>'+ 
      '<div class="healthchip '+(h.cfbd_ready?'':'warnchip')+'"><b>NCAAF</b><span>'+(h.cfbd_ready?'Advanced CFBD':'Basic mode')+'</span></div>';
    $('#enhance').innerHTML='<b>Free-data stack:</b> MLB Stats API + ESPN structured feeds + Open-Meteo + nflverse. '+(h.cfbd_ready?'<b>NCAAF advanced ratings active.</b>':'NCAAF basic mode is active; an optional free CFBD key can raise coverage.');
    const s=await api('/api/sports');
    $('#sport').innerHTML=s.sports.map(x=>'<option value="'+esc(x.key)+'">'+esc(x.title)+'</option>').join('');
    $('#sport').value=s.sports.some(x=>x.key==='baseball_mlb')?'baseball_mlb':(s.sports[0]?.key||'');
    const m=await api('/api/models');
    $('#modelGrid').innerHTML=m.models.map(x=>'<div class="model"><b>'+esc(x[0])+'</b><div class="muted small">'+esc(x[1])+'</div><p>'+esc(x[2])+'</p></div>').join('');
    const resetBoard=()=>{EVENTS=[];LAST_SYNC=0;$('#events').innerHTML='';};
    $('#sport').onchange=resetBoard;$('#markets').onchange=resetBoard;$('#gradeResults').onclick=()=>gradeAudit(false);$('#exportResults').onclick=exportAudit;$('#clearResults').onclick=()=>{if(confirm('Clear AEGIS results stored on this device?')){localStorage.removeItem(AUDIT_KEY);renderAudit()}};
    renderAudit();setTimeout(autoGrade,800);
  }catch(e){status.classList.add('bad');status.textContent='SETUP NEEDS ATTENTION • '+e.message;hg.innerHTML='<div class="healthchip badchip"><b>System</b><span>Check setup</span></div>';throw e}
}
function renderQuotes(e){let books=[...(e.bookmakers||[])].sort((a,b)=>(b.key.includes('hardrock')?1:0)-(a.key.includes('hardrock')?1:0));return books.flatMap(b=>(b.markets||[]).map(m=>{let txt=(m.outcomes||[]).map(o=>esc(o.name)+fmtPoint(m.key,o.point,o.name)+' '+fmtA(o.price)).join('<br>');return '<div class="quote '+(b.key.includes('hardrock')?'hardrock':'')+'"><b>'+esc(b.title)+' • '+esc(m.key)+(b.key.includes('hardrock')?' • TARGET BOOK':'')+'</b>'+txt+'</div>'})).join('')}
function renderEvents(){ $('#events').innerHTML=EVENTS.length?EVENTS.map((e,i)=>'<article class="game"><div class="muted small">'+new Date(e.commence_time).toLocaleString()+'</div><h3>'+esc(e.away_team)+' @ '+esc(e.home_team)+'</h3><div class="quotes">'+renderQuotes(e)+'</div><button class="btn secondary" data-game="'+i+'">AUTO SCAN THIS GAME</button></article>').join(''):'<div class="panel">No upcoming pregame events returned.</div>';$$('[data-game]').forEach(b=>b.onclick=()=>runScan([EVENTS[+b.dataset.game]]));}
async function syncBoard(show=true){try{if(show)$('#events').innerHTML='<div class="panel">Syncing upcoming pregame board…</div>';const d=await api('/api/odds?sport='+encodeURIComponent($('#sport').value)+'&markets='+encodeURIComponent($('#markets').value));EVENTS=d.events||[];LAST_SYNC=Date.now();$('#quota').textContent=d.quota?'Odds API quota • remaining '+(d.quota.remaining??'—')+' • used '+(d.quota.used??'—')+' • last '+(d.quota.last??'—'):'';renderEvents();return EVENTS}catch(e){$('#events').innerHTML='<div class="panel"><b>Live sync error</b><p>'+esc(e.message)+'</p></div>';throw e}} $('#sync').onclick=()=>syncBoard(true);
function progress(p,title,text){$('#progress').classList.add('show');$('#progressBar').style.width=p+'%';$('#progressTitle').textContent=title;$('#progressText').textContent=text;window.scrollTo({top:$('#progress').offsetTop-80,behavior:'smooth'})}
async function runScan(events){try{$('#scan').disabled=true;progress(12,'Stage 1 of 4 • Free independent data','Pulling current public sports statistics, schedules, probable starters, ratings, news signals and weather without using sportsbook prices to set direction.');await new Promise(r=>setTimeout(r,150));progress(38,'Stage 2 of 4 • Sport-specific projection','Running sport-specific modules, coverage scoring, uncertainty bands, effective agreement and failure paths.');const d=await api('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events})});progress(72,'Stage 3 of 4 • Market challenger','Building multi-book de-vig consensus, shrinking extreme disagreement appropriately, and preserving the independent thesis direction.');await new Promise(r=>setTimeout(r,180));progress(92,'Stage 4 of 4 • Release gates','Applying coverage/effective-agreement gates, Market Sanity Firewall, two-edge gate, price cushion, target-book verification and Precision Mode Core cap.');LAST=d;saveScanAudit(d);renderCard(d);progress(100,'Calibrated AEGIS scan complete','Final card is ready. Extreme model/market disagreements are challenged instead of treated as automatic value.');setTimeout(()=>tab('card'),300)}catch(e){progress(100,'Scan stopped',e.message);$('#progressBar').style.background='var(--red)'}finally{$('#scan').disabled=false}}
$('#scan').onclick=async()=>{try{if(!EVENTS.length||Date.now()-LAST_SYNC>10*60*1000){progress(5,'Refreshing pregame board','Getting current sportsbook prices before the independent data scan.');await syncBoard(false);}if(EVENTS.length)await runScan(EVENTS);else progress(100,'No upcoming games','No pregame events are currently available for this sport.')}catch(e){progress(100,'Scan stopped',e.message);$('#progressBar').style.background='var(--red)'}};
function modulesHtml(p){return (p.projection?.modules||[]).map(m=>'<div class="module"><b>'+esc(m.name)+'</b> <span class="muted">('+Math.round(m.confidence)+'/100)</span><br><span class="small">'+esc(m.evidence)+'</span></div>').join('')}
function selectionLabel(p){return esc(p.selection)+fmtPoint(p.market,p.point,p.selection)+' '+fmtA(p.price)+' • '+esc(p.book)+(p.hard_rock?' • HARD ROCK VERIFIED':'');}
function metric(label,value){return '<div class="metric"><b>'+esc(label)+'</b>'+value+'</div>';}
function f5Html(p){const f=p.projection&&p.projection.f5;if(!f)return '';return '<div class="notice small"><b>MLB F5 context:</b> '+esc(p.event.away_team)+' '+esc(f.projected_score.away)+' – '+esc(p.event.home_team)+' '+esc(f.projected_score.home)+' • F5 total '+esc(f.projected_total)+' • tie risk '+pct(f.tie_risk)+'. This is projection context only unless a verified F5 market is synced.</div>';}
function shortText(x,n=340){x=String(x||'');return x.length>n?x.slice(0,n).replace(/\s+\S*$/,'')+'…':x}
function tierCall(p){if(p.tier==='CORE')return '<span class="fire">🔥 FIRE • '+p.units+'u</span>';if(p.tier==='SECONDARY')return '<span class="fire">🟡 SMALL FIRE • '+p.units+'u</span>';if(p.tier==='WATCH')return '<span class="hold">👀 HOLD • 0u</span>';return '<span class="cut">✂️ CUT • 0u</span>'}
function verdictHtml(p){if(p.tier==='CORE')return '<div class="verdict firev"><b>🔥 AEGIS SAYS FIRE</b>Cleared the release gates. This is bankroll-qualified action at the listed number.</div>';if(p.tier==='SECONDARY')return '<div class="verdict firev"><b>🟡 AEGIS SAYS SMALL FIRE</b>The edge qualifies, but the evidence or price is not strong enough for Core size.</div>';if(p.tier==='WATCH')return '<div class="verdict holdv"><b>👀 AEGIS SAYS HOLD</b>There is a thesis here, but one or more confirmation gates are still open. Do not force it.</div>';return '<div class="verdict cutv"><b>✂️ AEGIS SAYS CUT</b>No bankroll exposure. The edge did not survive the full verification.</div>'}
function copyCardText(d){
  const out=['🔥 SB101 AEGIS FINAL CARD','Slate: '+(d.slate_grade||'—'),''];
  for(const t of ['CORE','SECONDARY']){
    const rows=(d.plays||[]).filter(p=>p.tier===t);if(!rows.length)continue;
    out.push(t==='CORE'?'🔥 CORE':'🟡 SECONDARY');
    for(const p of rows){
      out.push((p.units?p.units+'u ':'')+p.selection+fmtPoint(p.market,p.point,p.selection)+' '+fmtA(p.price)+' • '+p.book);
      out.push('Projection: '+p.event.away_team+' '+p.projection.projected_score.away+' – '+p.event.home_team+' '+p.projection.projected_score.home);
      out.push('Edge: '+pct(p.adjusted_edge)+' • Support '+Math.round(p.market_support_strength||0)+'/100');
      out.push('Timing: '+p.timing);
      out.push('');
    }
  }
  const watch=(d.plays||[]).filter(p=>p.tier==='WATCH').slice(0,4);
  if(watch.length){out.push('👀 WATCHLIST');for(const p of watch)out.push(p.selection+fmtPoint(p.market,p.point,p.selection)+' '+fmtA(p.price)+' • '+p.book+' — '+p.event.away_team+' @ '+p.event.home_team);out.push('')}
  if(d.parlay){out.push('🎯 OPTIONAL PARLAY • '+d.parlay.units+'u • approx '+fmtA(d.parlay.approx_american));for(const l of d.parlay.legs)out.push(l.selection+fmtPoint(l.market,l.point,l.selection)+' '+fmtA(l.price));out.push('')}
  if(!(d.plays||[]).some(p=>['CORE','SECONDARY'].includes(p.tier)))out.push('✂️ NO QUALIFIED STRAIGHT BETS — discipline over action.');
  return out.join('\\n');
}
async function copyFinalCard(){if(!LAST)return;const txt=copyCardText(LAST);try{await navigator.clipboard.writeText(txt);const b=$('#copyCard');if(b){const old=b.textContent;b.textContent='COPIED ✓';setTimeout(()=>b.textContent=old,1400)}}catch{alert(txt)}}
function renderCard(d){const counts={CORE:0,SECONDARY:0,WATCH:0,PASS:(d.passes||[]).length};for(const p of d.plays||[])counts[p.tier]=(counts[p.tier]||0)+1;let h='<div class="slatehero"><div class="label">MISSION BRIEF</div><h2>'+esc(d.slate_grade||'—')+'</h2><p class="muted">'+(counts.CORE?'🔥 Qualified action is on the board. Stay inside the listed numbers and sizing.':counts.SECONDARY?'🟡 Selective action only. No need to reach beyond the qualified Secondary spots.':counts.WATCH?'👀 HOLD THE LINE. AEGIS sees candidates, but the slate has not fully earned bankroll exposure.':'✂️ NO ACTION. The slate did not clear our release gates.')+'</p><div class="callstrip"><span class="callpill fire">🔥 FIRE = bankroll qualified</span><span class="callpill hold">👀 HOLD = wait for confirmation</span><span class="callpill cut">✂️ CUT = no bet</span></div><div class="slatestats"><span class="slatestat"><b>'+counts.CORE+'</b> Core</span><span class="slatestat"><b>'+counts.SECONDARY+'</b> Secondary</span><span class="slatestat"><b>'+counts.WATCH+'</b> Watch</span><span class="slatestat"><b>'+counts.PASS+'</b> Cut</span></div><div class="copyrow"><button class="btn secondary" id="copyCard">COPY CARD</button></div><p class="muted small">Generated '+new Date(d.generated_at).toLocaleString()+' • calibrated deterministic/free-data engine</p></div>';
if(d.slate_sanity&&d.slate_sanity.triggered)h+='<div class="notice warning"><b>AEGIS CHECK ENGINE</b><p>'+esc(d.slate_sanity.message)+'</p></div>';
if(!(d.plays||[]).length)h+='<div class="emptycall"><div class="eyebrow">NO QUALIFIED BETS</div><h3>The slate did not earn a bet.</h3><p>Missing coverage, weak evidence or too much model/market conflict is uncertainty — not a reason to manufacture confidence.</p></div>';
for(const p of d.plays||[]){const pr=p.projection||{},range=pct(p.fair_probability_low)+' – '+pct(p.fair_probability_high),topRisk=(p.how_it_loses||[])[0]||p.final_verification||'No major failure path surfaced.';let flags=(p.sanity_flags||[]).map(x=>'<div class="notice warning small">'+esc(x)+'</div>').join('');const fairVsMarket=pct(p.fair_probability)+' vs '+pct(p.market_probability);h+='<article class="play"><div class="playhead"><div><span class="badge '+esc(p.tier)+'">'+esc(p.tier)+'</span><span class="matchup">'+esc(p.event.away_team)+' @ '+esc(p.event.home_team)+'</span></div><div class="decisionline">'+tierCall(p)+'</div></div><div class="pickline">'+selectionLabel(p)+'</div>'+verdictHtml(p)+'<div class="quickbrief"><div class="briefbox"><div class="kicker">WHY IT WINS</div><div class="big">'+esc(shortText(p.why,210))+'</div></div><div class="briefbox"><div class="kicker">WHAT MATTERS NOW</div><div class="big">'+esc(p.timing)+'</div></div></div><div class="quickgrid"><div class="quickmetric"><b>Projection</b><strong>'+esc(pr.projected_score.away)+'–'+esc(pr.projected_score.home)+'</strong></div><div class="quickmetric"><b>Fair vs market</b><strong>'+fairVsMarket+'</strong></div><div class="quickmetric"><b>Edge</b><strong>'+pct(p.adjusted_edge)+'</strong></div><div class="quickmetric"><b>Support</b><strong>'+Math.round(p.market_support_strength||0)+'/100</strong></div></div><div class="blocker"><b>'+(p.tier==='CORE'?'Main risk':'What is blocking the bet')+':</b> '+esc(shortText(topRisk,260))+'</div><p class="decisionline"><b>Timing:</b> '+esc(p.timing)+'</p>'+flags+f5Html(p)+'<details class="deepdetails"><summary>Deep model diagnostics</summary><div class="metricgrid">'+metric('Raw model',pct(p.fair_raw))+metric('Independent',pct(p.fair_independent))+metric('Calibrated fair',pct(p.fair_probability))+metric('Fair range',range)+metric('Market challenger',pct(p.market_probability))+metric('Independent-market gap',pct(p.independent_disagreement))+metric('Raw-model gap',pct(p.raw_market_gap))+metric('Band vs market',p.market_inside_fair_range?'OVERLAPS':'CLEARS')+metric('Estimated EV',pct(p.estimated_ev))+metric('Data quality',Math.round(pr.data_quality)+'/100')+metric('Market agreement',Math.round(p.market_model_agreement==null?(pr.model_agreement||0):p.market_model_agreement)+'/100')+metric('Market coverage',Math.round(p.market_coverage==null?(pr.coverage_score||0):p.market_coverage)+'/100')+metric('Effective agreement',Math.round(p.market_effective_agreement==null?(pr.effective_agreement||0):p.market_effective_agreement)+'/100')+metric('Market-specific edges',esc(p.market_edge_count==null?pr.independent_edge_count:p.market_edge_count))+metric('Uncertainty',Math.round(pr.uncertainty||0)+'/100')+metric('Required cushion',pct(p.cushion))+metric('Target book',p.hard_rock?'VERIFIED':'NOT VERIFIED')+(p.push_probability>0?metric('Push probability',pct(p.push_probability)):'')+'</div><div class="hr"></div><p class="risk"><b>Full risk map:</b> '+esc((p.how_it_loses||[]).join(' • '))+'</p><p class="muted"><b>Final verification:</b> '+esc(p.final_verification)+'</p><details><summary>Applied models & source evidence</summary>'+modulesHtml(p)+'<div class="hr"></div>'+((pr.notes||[]).map(n=>'<div class="small muted">• '+esc(n)+'</div>').join(''))+'<div class="hr"></div>'+((pr.sources||[]).map(s=>'<a class="source" target="_blank" rel="noopener" href="'+esc(s.url)+'">'+esc(s.name)+'</a>').join('')||'<span class="muted">No external source links available.</span>')+'</details></details></article>'}
if(d.parlay)h+='<div class="panel"><div class="eyebrow">OPTIONAL PARLAY</div><h3>'+d.parlay.units+'u • approx '+fmtA(d.parlay.approx_american)+'</h3>'+d.parlay.legs.map(l=>'<div style="padding:6px 0"><b>'+esc(l.selection)+fmtPoint(l.market,l.point,l.selection)+'</b> '+fmtA(l.price)+' • '+esc(l.book)+'</div>').join('')+'<p class="muted">'+esc(d.parlay.rationale)+'</p></div>';
if((d.passes||[]).length){h+='<details class="panel"><summary><b>Cut list • '+d.passes.length+' games</b></summary><p class="muted small">These failed release gates. They are here for transparency, not temptation.</p>'+d.passes.map(p=>'<p class="muted"><b>'+esc(p.matchup)+'</b> — '+esc(p.reason)+'</p>').join('')+'</details>'}$('#cardContent').innerHTML=h;const cb=$('#copyCard');if(cb)cb.onclick=copyFinalCard}
init().catch(()=>{});
</script></body></html>`;

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&u.pathname==='/')return send(res,200,HTML,'text/html; charset=utf-8');
    if(req.method==='POST'&&u.pathname==='/api/results/resolve'){
      const body=JSON.parse(await readBody(req)||'{}'),records=Array.isArray(body.records)?body.records.slice(0,100):[],results=[];
      for(const r of records){const score=await resolveFinalScore(r),outcome=settledBetOutcome(r,score);results.push({...r,...score,outcome});}
      return send(res,200,{ok:true,results});
    }
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
server.listen(PORT,'0.0.0.0',()=>console.log(`AEGIS Command UX v5.3.1 running on ${PORT} • ${MODELS.length} models • OpenAI calls disabled`));
