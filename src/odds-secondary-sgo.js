'use strict';

const DEFAULT_BASE_URL='https://api.sportsgameodds.com/v2';

const SPORTS={
  baseball_mlb:{leagueID:'MLB',title:'MLB'},
  americanfootball_ncaaf:{leagueID:'NCAAF',title:'NCAAF'}
};

const TO_SGO_BOOK={
  hardrockbet_fl:'hardrockbet',
  fanduel:'fanduel',
  draftkings:'draftkings',
  bovada:'bovada',
  betmgm:'betmgm',
  espnbet:'espnbet',
  fanatics:'fanatics'
};

const FROM_SGO_BOOK=Object.fromEntries(
  Object.entries(TO_SGO_BOOK).map(([a,b])=>[b,a])
);

const TITLES={
  hardrockbet_fl:'Hard Rock Bet',
  fanduel:'FanDuel',
  draftkings:'DraftKings',
  bovada:'Bovada',
  betmgm:'BetMGM',
  espnbet:'ESPN BET',
  fanatics:'Fanatics'
};

function config(env=process.env){
  const enabled=String(env.AEGIS_ODDS_SECONDARY_ENABLED||'true').toLowerCase()!=='false';
  const apiKey=String(env.SPORTSGAMEODDS_API_KEY||'').trim();
  return {
    name:'sportsgameodds',
    enabled,
    configured:enabled&&!!apiKey,
    apiKey,
    baseUrl:String(env.AEGIS_ODDS_SECONDARY_BASE_URL||DEFAULT_BASE_URL).replace(/\/+$/,''),
    timeoutMs:Math.max(3000,Math.min(30000,Number(env.AEGIS_ODDS_SECONDARY_TIMEOUT_MS||10000))),
    maxPages:Math.max(1,Math.min(4,Number(env.AEGIS_ODDS_SECONDARY_MAX_PAGES||3)))
  };
}

function parseEndpoint(endpoint){
  const text=String(endpoint||'');
  const m=text.match(/^sports\/([^/]+)\/odds(?:\?|$)/);
  if(!m)return null;

  const sportKey=decodeURIComponent(m[1]);
  const sport=SPORTS[sportKey];
  if(!sport)return null;

  const q=text.includes('?')?text.slice(text.indexOf('?')+1):'';
  const params=new URLSearchParams(q);
  const markets=String(params.get('markets')||'h2h,spreads,totals')
    .split(',').map(x=>x.trim()).filter(Boolean);

  if(markets.some(x=>!['h2h','spreads','totals'].includes(x)))return null;

  const primaryBooks=String(params.get('bookmakers')||'')
    .split(',').map(x=>x.trim()).filter(Boolean);
  const sgoBooks=[...new Set(primaryBooks.map(x=>TO_SGO_BOOK[x]).filter(Boolean))];

  const oddIDs=[];
  if(markets.includes('h2h')){
    oddIDs.push('points-home-game-ml-home','points-away-game-ml-away');
  }
  if(markets.includes('spreads')){
    oddIDs.push('points-home-game-sp-home','points-away-game-sp-away');
  }
  if(markets.includes('totals')){
    oddIDs.push('points-all-game-ou-over','points-all-game-ou-under');
  }

  return {
    sportKey,
    sportTitle:sport.title,
    leagueID:sport.leagueID,
    markets,
    primaryBooks,
    sgoBooks,
    oddIDs
  };
}

function canHandle(endpoint){
  return !!parseEndpoint(endpoint);
}

function num(value){
  if(value==null||value==='')return null;
  const n=Number(String(value).replace(/^\+/,''));
  return Number.isFinite(n)?n:null;
}

function teamName(team){
  return team?.names?.medium||team?.names?.long||team?.names?.short||team?.name||team?.teamID||'Unknown';
}

function marketKey(odd){
  if(odd?.periodID!=='game')return null;
  if(odd?.betTypeID==='ml')return 'h2h';
  if(odd?.betTypeID==='sp')return 'spreads';
  if(odd?.betTypeID==='ou')return 'totals';
  return null;
}

function outcomeFor(odd,event,book){
  const key=marketKey(odd);
  if(!key)return null;

  const home=teamName(event?.teams?.home);
  const away=teamName(event?.teams?.away);
  const price=num(book?.odds);
  if(price==null)return null;

  if(key==='h2h'||key==='spreads'){
    const side=String(odd?.sideID||'').toLowerCase();
    const name=side==='home'?home:side==='away'?away:null;
    if(!name)return null;
    const point=key==='spreads'?num(book?.spread??odd?.bookSpread):null;
    return point==null?{name,price}:{name,price,point};
  }

  const side=String(odd?.sideID||'').toLowerCase();
  if(side!=='over'&&side!=='under')return null;
  const point=num(book?.overUnder??odd?.bookOverUnder);
  const name=side==='over'?'Over':'Under';
  return point==null?{name,price}:{name,price,point};
}

function normalizeEvent(event,parsed){
  const byBook=new Map();
  const allowed=new Set(parsed.primaryBooks||[]);

  for(const odd of Object.values(event?.odds||{})){
    const key=marketKey(odd);
    if(!key||!parsed.markets.includes(key))continue;

    for(const [sgoBook,book] of Object.entries(odd?.byBookmaker||{})){
      if(book?.available===false)continue;
      const primaryBook=FROM_SGO_BOOK[sgoBook]||sgoBook;
      if(allowed.size&&!allowed.has(primaryBook))continue;

      const outcome=outcomeFor(odd,event,book);
      if(!outcome)continue;

      if(!byBook.has(primaryBook)){
        byBook.set(primaryBook,{
          key:primaryBook,
          title:TITLES[primaryBook]||primaryBook,
          last_update:null,
          markets:new Map()
        });
      }

      const row=byBook.get(primaryBook);
      if(!row.markets.has(key))row.markets.set(key,{key,outcomes:[]});
      const market=row.markets.get(key);

      const duplicate=market.outcomes.some(x=>
        x.name===outcome.name&&
        Number(x.point??0)===Number(outcome.point??0)
      );
      if(!duplicate)market.outcomes.push(outcome);

      const stamp=book?.lastUpdatedAt||null;
      if(stamp&&(!row.last_update||new Date(stamp)>new Date(row.last_update))){
        row.last_update=stamp;
      }
    }
  }

  const bookmakers=[...byBook.values()].map(row=>({
    key:row.key,
    title:row.title,
    last_update:row.last_update,
    markets:[...row.markets.values()].filter(m=>m.outcomes.length)
  })).filter(b=>b.markets.length);

  return {
    id:`sgo:${event.eventID}`,
    sport_key:parsed.sportKey,
    sport_title:parsed.sportTitle,
    commence_time:event?.status?.startsAt||event?.startTime||null,
    home_team:teamName(event?.teams?.home),
    away_team:teamName(event?.teams?.away),
    bookmakers
  };
}

function normalizeEvents(events,parsed){
  return (events||[])
    .filter(e=>e&&!e?.status?.cancelled&&!e?.status?.ended)
    .map(e=>normalizeEvent(e,parsed))
    .filter(e=>e.commence_time&&e.bookmakers.length);
}

async function fetchPage(url,cfg){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),cfg.timeoutMs);
  try{
    const response=await fetch(url,{
      signal:controller.signal,
      headers:{
        'x-api-key':cfg.apiKey,
        'Accept':'application/json',
        'User-Agent':'SB101-AEGIS/9.1.2'
      }
    });
    const raw=await response.text();
    let body;
    try{body=JSON.parse(raw);}catch{body={success:false,error:raw};}
    if(!response.ok||body?.success===false){
      const err=new Error(body?.error||`SportsGameOdds ${response.status}`);
      err.status=response.status;
      err.provider='sportsgameodds';
      throw err;
    }
    return body;
  }finally{
    clearTimeout(timer);
  }
}

async function fetchOdds(endpoint,{env=process.env}={}){
  const cfg=config(env);
  if(!cfg.configured)throw Object.assign(new Error('SportsGameOdds secondary is not configured.'),{status:503,provider:'sportsgameodds'});

  const parsed=parseEndpoint(endpoint);
  if(!parsed)throw Object.assign(new Error('SportsGameOdds adapter does not support this endpoint.'),{status:422,provider:'sportsgameodds'});

  const params=new URLSearchParams({
    leagueID:parsed.leagueID,
    oddsAvailable:'true',
    live:'false',
    started:'false',
    includeOpposingOdds:'true',
    limit:'100'
  });

  if(parsed.oddIDs.length)params.set('oddID',parsed.oddIDs.join(','));
  if(parsed.sgoBooks.length)params.set('bookmakerID',parsed.sgoBooks.join(','));

  const all=[];
  let cursor=null;
  let pages=0;

  do{
    const q=new URLSearchParams(params);
    if(cursor)q.set('cursor',cursor);
    const body=await fetchPage(`${cfg.baseUrl}/events?${q.toString()}`,cfg);
    all.push(...(Array.isArray(body?.data)?body.data:[]));
    cursor=body?.nextCursor||null;
    pages++;
  }while(cursor&&pages<cfg.maxPages);

  return {
    data:normalizeEvents(all,parsed),
    meta:{
      provider:'sportsgameodds',
      source:'secondary_provider',
      fetched_at:new Date().toISOString(),
      failover:true,
      pages,
      objects:all.length,
      sport_key:parsed.sportKey
    }
  };
}

function retryable(error){
  const status=Number(error?.status);
  return error?.name==='AbortError'||!Number.isFinite(status)||status===408||status===425||status===429||status>=500;
}

function publicStatus(env=process.env){
  const c=config(env);
  return {
    name:c.name,
    enabled:c.enabled,
    configured:c.configured,
    supported_sports:Object.keys(SPORTS),
    supported_markets:['h2h','spreads','totals']
  };
}

module.exports={
  DEFAULT_BASE_URL,
  SPORTS,
  TO_SGO_BOOK,
  config,
  parseEndpoint,
  canHandle,
  normalizeEvent,
  normalizeEvents,
  fetchOdds,
  retryable,
  publicStatus
};
