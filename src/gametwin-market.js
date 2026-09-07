'use strict';

const VERSION='0.4.0-market-evaluation';

function clamp01(x){x=Number(x);return Number.isFinite(x)?Math.max(0,Math.min(1,x)):0;}
function round(x,n=4){const p=10**n;return Math.round((Number(x)||0)*p)/p;}
function americanToProb(price){price=Number(price);if(!Number.isFinite(price)||price===0)return null;return price<0?(-price)/((-price)+100):100/(price+100);}
function probToAmerican(prob){prob=Number(prob);if(!Number.isFinite(prob)||prob<=0||prob>=1)return null;return prob>=.5?Math.round(-100*prob/(1-prob)):Math.round(100*(1-prob)/prob);}
function americanProfit(price){price=Number(price);if(!Number.isFinite(price)||price===0)return null;return price>0?price/100:100/(-price);}
function normalizeName(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function sameName(a,b){const x=normalizeName(a),y=normalizeName(b);return !!x&&!!y&&(x===y||x.endsWith(` ${y}`)||y.endsWith(` ${x}`));}
function twoWayDevig(priceA,priceB){const a=americanToProb(priceA),b=americanToProb(priceB);if(a==null||b==null||a+b<=0)return null;return {a:round(a/(a+b),6),b:round(b/(a+b),6),hold:round(a+b-1,6)};}
function normalizeTriplet(win,lose,push=0){const total=win+lose+push;if(total<=0)return null;win/=total;lose/=total;push/=total;const conditional=(win+lose)>0?win/(win+lose):null;return {win_probability:round(win,6),lose_probability:round(lose,6),push_probability:round(push,6),fair_probability:conditional==null?null:round(conditional,6),fair_price:conditional==null?null:probToAmerican(conditional)};}
function scoreRows(projection){const rows=[];for(const [key,p0] of Object.entries(projection?.score_distribution||{})){const [away,home]=String(key).split('-').map(Number),p=Number(p0);if(Number.isFinite(away)&&Number.isFinite(home)&&p>0)rows.push({away,home,p});}return rows;}
function resolveTeamSide(projection,selection){if(String(selection).toLowerCase()==='home')return 'home';if(String(selection).toLowerCase()==='away')return 'away';if(sameName(selection,projection?.teams?.home))return 'home';if(sameName(selection,projection?.teams?.away))return 'away';return null;}
function gameOutcome(projection,quote){const market=String(quote.market||'').toLowerCase(),rows=scoreRows(projection);if(!rows.length)return null;let win=0,lose=0,push=0;
  if(['h2h','moneyline','ml'].includes(market)){
    const side=resolveTeamSide(projection,quote.selection);if(!side)return null;for(const r of rows){const z=side==='home'?r.home-r.away:r.away-r.home;if(z>0)win+=r.p;else if(z<0)lose+=r.p;else push+=r.p;}
  }else if(['spread','run_line','runline','spreads'].includes(market)){
    const side=resolveTeamSide(projection,quote.selection),point=Number(quote.point);if(!side||!Number.isFinite(point))return null;for(const r of rows){const z=(side==='home'?r.home-r.away:r.away-r.home)+point;if(z>1e-9)win+=r.p;else if(z<-1e-9)lose+=r.p;else push+=r.p;}
  }else if(['total','totals','game_total'].includes(market)){
    const sel=String(quote.selection||'').toLowerCase(),point=Number(quote.point);if(!['over','under'].includes(sel)||!Number.isFinite(point))return null;for(const r of rows){let z=r.home+r.away-point;if(sel==='under')z=-z;if(z>1e-9)win+=r.p;else if(z<-1e-9)lose+=r.p;else push+=r.p;}
  }else return null;
  return normalizeTriplet(win,lose,push);
}
const PLAYER_MARKETS={
  player_hits:{group:'players',metric:'H'},hits:{group:'players',metric:'H'},
  player_total_bases:{group:'players',metric:'TB'},total_bases:{group:'players',metric:'TB'},
  player_home_runs:{group:'players',metric:'HR'},home_runs:{group:'players',metric:'HR'},
  player_runs:{group:'players',metric:'R'},runs:{group:'players',metric:'R'},
  player_strikeouts:{group:'players',metric:'K'},batter_strikeouts:{group:'players',metric:'K'},
  player_walks:{group:'players',metric:'BB'},batter_walks:{group:'players',metric:'BB'},
  pitcher_strikeouts:{group:'pitchers',metric:'K'},pitcher_ks:{group:'pitchers',metric:'K'},
  pitcher_outs:{group:'pitchers',metric:'OUTS'},pitcher_outs_recorded:{group:'pitchers',metric:'OUTS'},
  pitcher_earned_runs:{group:'pitchers',metric:'ER'},pitcher_er:{group:'pitchers',metric:'ER'},
  pitcher_hits_allowed:{group:'pitchers',metric:'H'},pitcher_walks:{group:'pitchers',metric:'BB'},
  pitcher_home_runs_allowed:{group:'pitchers',metric:'HR'},pitcher_pitches:{group:'pitchers',metric:'PITCHES'}
};
function findProjectionPerson(projection,group,name){for(const side of ['away','home'])for(const [n,row] of Object.entries(projection?.[group]?.[side]||{}))if(sameName(n,name))return {side,name:n,row};return null;}
function distOutcome(dist,selection,point){const sel=String(selection||'over').toLowerCase();point=Number(point);if(!['over','under'].includes(sel)||!Number.isFinite(point))return null;let win=0,lose=0,push=0;for(const [value,p0] of Object.entries(dist||{})){const v=Number(value),p=Number(p0);if(!Number.isFinite(v)||!Number.isFinite(p)||p<=0)continue;let z=v-point;if(sel==='under')z=-z;if(z>1e-9)win+=p;else if(z<-1e-9)lose+=p;else push+=p;}return normalizeTriplet(win,lose,push);}
function playerOutcome(projection,quote){const cfg=PLAYER_MARKETS[String(quote.market||'').toLowerCase()];if(!cfg)return null;const found=findProjectionPerson(projection,cfg.group,quote.player||quote.selection_name||quote.name);if(!found)return null;const dist=found.row?.distributions?.[cfg.metric];if(!dist)return null;const outcome=distOutcome(dist,quote.selection||'over',quote.point);return outcome?{...outcome,projection_person:found.name,projection_side:found.side,metric:cfg.metric}:null;}
function evaluateQuote(projection,quote){const market=String(quote?.market||'').toLowerCase();const base=PLAYER_MARKETS[market]?playerOutcome(projection,quote):gameOutcome(projection,quote);if(!base)return {supported:false,reason:'Unsupported market or projection distribution unavailable',quote};const price=Number(quote.price),implied=americanToProb(price),profit=americanProfit(price),win=base.win_probability,lose=base.lose_probability,push=base.push_probability;const ev=(profit==null)?null:win*profit-lose;return {...base,supported:true,quote:{...quote,price:Number.isFinite(price)?price:null},book_implied_probability:implied==null?null:round(implied,6),raw_probability_edge:implied==null||base.fair_probability==null?null:round(base.fair_probability-implied,6),estimated_ev:ev==null?null:round(ev,6),shadow_only:true,release_eligible:false};}
function quoteKey(q){const m=String(q.market||'').toLowerCase(),p=q.player?normalizeName(q.player):'',pt=Number.isFinite(Number(q.point))?Number(q.point):'';return `${m}|${p}|${pt}`;}
function evaluateBoard(projection,quotes=[]){const evaluated=quotes.map(q=>evaluateQuote(projection,q));const groups=new Map();for(const row of evaluated){const key=quoteKey(row.quote||{});if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}for(const rows of groups.values()){if(rows.length!==2)continue;const a=rows[0],b=rows[1],d=twoWayDevig(a.quote?.price,b.quote?.price);if(!d)continue;a.market_devig_probability=d.a;b.market_devig_probability=d.b;a.market_hold=d.hold;b.market_hold=d.hold;a.devig_edge=a.fair_probability==null?null:round(a.fair_probability-d.a,6);b.devig_edge=b.fair_probability==null?null:round(b.fair_probability-d.b,6);}return evaluated;}
function rankShadowEdges(evaluated=[]){return evaluated.filter(x=>x.supported&&Number.isFinite(x.estimated_ev)).slice().sort((a,b)=>b.estimated_ev-a.estimated_ev).map((x,i)=>({...x,shadow_rank:i+1}));}

module.exports={VERSION,PLAYER_MARKETS,americanToProb,probToAmerican,americanProfit,twoWayDevig,gameOutcome,playerOutcome,evaluateQuote,evaluateBoard,rankShadowEdges,normalizeName,sameName,distOutcome};
