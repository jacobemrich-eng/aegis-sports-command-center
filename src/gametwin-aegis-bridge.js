'use strict';

const market=require('./gametwin-market');
const audit=require('./gametwin-audit');

const VERSION='0.6.0-aegis-bridge';
const FULL_GAME_MARKETS=new Set(['h2h','spreads','totals']);

function normalizeAegisMarket(name){
  const m=String(name||'').toLowerCase();
  if(m==='h2h')return 'moneyline';
  if(m==='spreads')return 'run_line';
  if(m==='totals')return 'total';
  return null;
}
function isFullGameMarket(name){return FULL_GAME_MARKETS.has(String(name||'').toLowerCase());}
function sameMatchup(analysis,spec){
  const e=analysis?.event||analysis||{};
  return market.sameName(e.away_team,spec?.away?.name)&&market.sameName(e.home_team,spec?.home?.name);
}
function findAnalysisForSpec(card,spec){return (card?.analyses||[]).find(a=>sameMatchup(a,spec))||null;}
function candidateKey(c){return [String(c.market||'').toLowerCase(),market.normalizeName(c.selection),Number.isFinite(Number(c.point))?Number(c.point):''].join('|');}
function quoteKey(q){return [String(q.market||'').toLowerCase(),market.normalizeName(q.selection),Number.isFinite(Number(q.point))?Number(q.point):''].join('|');}
function candidateToQuote(c){
  const mapped=normalizeAegisMarket(c.market);if(!mapped)return null;
  const price=Number(c.price);if(!Number.isFinite(price))return null;
  return {market:mapped,selection:c.selection,point:c.point==null?null:Number(c.point),price,book:c.book||null,book_key:c.book_key||null,last_update:c.last_update||null,source_market:c.market,source:'aegis-market-candidate'};
}
function preferredCandidates(analysis,{targetBookKey='hardrockbet_fl'}={}){
  const all=(analysis?.market?.all||[]).filter(c=>isFullGameMarket(c.market));
  if(!all.length)return [];
  const target=all.filter(c=>c.book_key===targetBookKey||c.hard_rock===true);
  const pool=target.length?target:all;
  const by=new Map();
  for(const c of pool){
    const k=candidateKey(c),old=by.get(k);
    if(!old){by.set(k,c);continue;}
    // Keep the freshest duplicate quote when the same side/point appears twice.
    const ot=Date.parse(old.last_update||0)||0,ct=Date.parse(c.last_update||0)||0;if(ct>=ot)by.set(k,c);
  }
  return [...by.values()];
}
function quotesFromAnalysis(analysis,options={}){return preferredCandidates(analysis,options).map(candidateToQuote).filter(Boolean);}
function aegisProbabilityMap(analysis,options={}){
  const map=new Map();
  for(const c of preferredCandidates(analysis,options)){
    const q=candidateToQuote(c);if(!q)continue;
    const p=Number(c.fair_probability??c.market_probability??c.fair_raw);
    if(Number.isFinite(p))map.set(quoteKey(q),{probability:p,source:'AEGIS',tier:c.tier||null,quality:c.decision_quality??null});
  }
  return map;
}
function aegisForecastResolver(analysis,options={}){
  const map=aegisProbabilityMap(analysis,options);
  return row=>{
    if(!row?.quote)return null;
    return map.get(quoteKey(row.quote))||null;
  };
}
function providersFromCard(card,options={}){
  return {
    quotesProvider:async(_gamePk,spec)=>{
      const a=findAnalysisForSpec(card,spec);return a?quotesFromAnalysis(a,options):[];
    },
    aegisForecastProvider:async(_gamePk,spec)=>{
      const a=findAnalysisForSpec(card,spec);return a?aegisForecastResolver(a,options):null;
    }
  };
}
function cardFingerprint(card){
  if(!card)return null;
  const plays=(card.analyses||[]).map(a=>{
    const e=a.event||{};
    const prices=(a.market?.all||[]).filter(c=>isFullGameMarket(c.market)).map(c=>[c.market,c.selection,c.point,c.price,c.book_key,c.last_update].join(':')).sort();
    return [e.id,e.away_team,e.home_team,e.commence_time,prices.join(',')].join('|');
  }).sort();
  return [card.version||'',card.generated_at||'',...plays].join('||');
}
function snapshotAegisReference(card,spec,options={}){
  const a=findAnalysisForSpec(card,spec);if(!a)return null;
  const resolver=aegisForecastResolver(a,options),quotes=quotesFromAnalysis(a,options);
  return {event_id:a.event?.id||null,card_version:card.version||null,card_generated_at:card.generated_at||null,quotes,aegis_forecast_keys:quotes.map(q=>({forecast_key:`quote|${audit.forecastKey(q)}`,aegis:resolver({quote:q})}))};
}

module.exports={VERSION,FULL_GAME_MARKETS,normalizeAegisMarket,isFullGameMarket,sameMatchup,findAnalysisForSpec,candidateToQuote,preferredCandidates,quotesFromAnalysis,aegisProbabilityMap,aegisForecastResolver,providersFromCard,cardFingerprint,snapshotAegisReference,quoteKey};
