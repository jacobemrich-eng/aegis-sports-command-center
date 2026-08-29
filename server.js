const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ODDS_KEY = process.env.ODDS_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const OPENAI_REASONING = process.env.OPENAI_REASONING || 'high';
const ODDS_BOOKMAKERS = process.env.ODDS_BOOKMAKERS || 'hardrockbet_fl,fanduel,draftkings,bovada,betmgm,espnbet,fanatics';
const MAX_SCAN_GAMES = Math.max(1, Math.min(30, Number(process.env.MAX_SCAN_GAMES || 12)));

const MODELS = [
  ['SB101 AEGIS v1.0','governance','Master release/governance layer for calibrated EV decisions.'],
  ['Precision Mode','execution','Bankroll-protection mode with tight Core/Secondary caps.'],
  ['Independent Thesis Model','projection','Locks sports direction before sportsbook price.'],
  ['Model Agreement Score','governance','Penalizes major disagreement across relevant modules.'],
  ['Two-Independent-Edges Gate','governance','Requires multiple independent drivers for Core.'],
  ['Market Challenger / Prior','market','De-vigs market prices and treats consensus as a rival forecast.'],
  ['Market Intelligence System','market','Tracks consensus, dispersion, movement inputs and timing.'],
  ['Market-Specific Cushion Model','governance','Applies stricter required edge to volatile markets.'],
  ['Data Quality / Uncertainty Gate','governance','Blocks false precision when inputs are missing or stale.'],
  ['Mistake Firewall','governance','Final stale-data, correlation, price and contradiction check.'],
  ['How Does This Lose?','risk','Scores plausible failure paths before release.'],
  ['Score Prediction Model','projection','Produces expected score/margin/total from available inputs.'],
  ['Market Selection Engine','market','Chooses best expression of the thesis.'],
  ['Offensive Support Filter v1.0','mlb','Checks whether pitcher edges have realistic run support.'],
  ['Road Favorite Filter','risk','Raises requirements for road favorites.'],
  ['Favorite Tax Model','market','Measures expensive-favorite price drag.'],
  ['Favorite Split Rule','execution','Supports ML/spread split for very expensive favorites when justified.'],
  ['F5 Tie-Risk Model','mlb','Adjusts early-inning baseball markets for draw probability.'],
  ['Fragile Totals Guard','risk','Raises the bar for totals with multiple volatility paths.'],
  ['NRFI/YRFI Model','mlb','Standalone first-inning scoring model.'],
  ['MLB Game Model','mlb','Blends SP, offense, bullpen, matchup and environment.'],
  ['MLB Starting Pitcher Projection','mlb','Projects workload, K, BB, hits/runs and removal risk.'],
  ['MLB Player Prop Model','mlb','Projects batter/pitcher props from role and matchup inputs.'],
  ['HR101','mlb','Dedicated home-run ranking engine.'],
  ['HR101 × SB101 Alignment','mlb','Cross-validates HR candidates against game environment.'],
  ['KBO Model','baseball','League-adjusted KBO quality and volatility model.'],
  ['NPB Model','baseball','League-adjusted NPB run-prevention and leverage model.'],
  ['NFL Preseason Rotation Model','nfl_preseason','Quarter-by-quarter rotation modeling.'],
  ['NFL Preseason QB Depth Model','nfl_preseason','Weights QB2/QB3 and reserve offense heavily.'],
  ['NFL Preseason Large-Favorite Gate','nfl_preseason','Requires deep-roster superiority to lay big numbers.'],
  ['NFL Preseason 1Q / 1H Model','nfl_preseason','Isolates early edge when starter advantage is front-loaded.'],
  ['NFL Preseason Coaching Usage','nfl_preseason','Weights expected usage over historical preseason records.'],
  ['NFL Preseason Joint-Practice Adjustment','nfl_preseason','Adjusts starter duration/variance after joint practices.'],
  ['NFL Special Teams / Penalty / Turnover','nfl_preseason','Models reserve-heavy randomness and hidden yards.'],
  ['WNBA Game Model','wnba','Projects pace, efficiency, matchup, depth and availability.'],
  ['WNBA Player Prop Model','wnba','Projects minutes, role, usage, rebounds and assists.'],
  ['Tennis Match Model','tennis','Surface-adjusted serve/return and matchup engine.'],
  ['Live Betting Model','live','A-level only live re-pricing with game-state context.'],
  ['BET NOW / WAIT','execution','Timing engine for confirmation and likely line movement.'],
  ['Correlation & Exposure Model','risk','Enforces one-thesis/limited same-game exposure.'],
  ['Parlay Construction System','execution','Requires every leg to qualify independently.'],
  ['Boost Evaluation System','execution','Applies promos only after independent selection.'],
  ['Bankroll / Unit System','execution','Maps confidence tier to disciplined stake sizing.'],
  ['Slate Ranking System','execution','Ranks qualified bets relative to the full slate.'],
  ['Final Verification System','governance','Rechecks inputs, market, price and failure paths before lock.'],
  ['Daily Results Audit System','audit','Separates outcome, CLV, thesis, execution and variance.'],
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

const SPORT_MODULES = {
  baseball_mlb: [
    'starting pitcher true talent and current arsenal','expected starter workload / pitch count / times-through-order risk',
    'offense vs handedness and pitch mix','bullpen quality, leverage availability and recent workload','lineup/injury confirmation',
    'platoon and pitch-type matchup','park/weather/run environment','defense/baserunning','recent form with capped weight',
    'offensive support filter','road favorite filter when applicable','F5 tie risk','fragile total guard','NRFI/YRFI first-inning context',
    'player-prop opportunity context','HR101 power/pitch-type environment when relevant'
  ],
  baseball_kbo: [
    'starting pitcher quality/reliability','foreign starter edge where relevant','offense and platoon fit','bullpen quality/volatility',
    'lineup availability','league run environment','defense/base-running','recent form capped','market liquidity/data quality',
    'KBO structural edge gate: do not elevate a 55-57% side without a clear starter/bullpen/offense driver'
  ],
  baseball_npb: [
    'starting pitcher quality/workload','offense and platoon fit','bullpen leverage availability','lineup availability',
    'park/weather','late-inning run-prevention profile','recent form capped','low-total variance guard especially totals <= 6.5'
  ],
  americanfootball_nfl_preseason: [
    'QB1 expected usage','QB2 quality','QB3/deep QB quality','starter 1Q edge','2Q rotation edge','second-half/deep reserve edge',
    'reserve OL/DL quality','RB/WR depth','defensive depth','coaching usage/intent','joint-practice workload adjustment',
    'special teams','penalty/turnover volatility','injuries/availability','large-favorite release gate','1Q/1H vs full-game market fit'
  ],
  americanfootball_nfl: [
    'QB and passing efficiency','offensive line','run game','skill-position availability','defensive front','coverage/secondary',
    'success rate/EPA-style efficiency','explosive plays','red zone','turnovers with regression','special teams','coaching/scheme',
    'rest/travel','weather','injuries','recent form capped'
  ],
  americanfootball_ncaaf: [
    'overall talent/true strength','QB quality and continuity','offensive line','passing offense','rushing offense','defensive front',
    'secondary/pass defense','success rate / down-to-down efficiency','explosive plays','havoc / pressure / sack creation','red zone',
    'turnovers with regression','special teams/hidden yards','injuries/availability','coaching/scheme','pace','rest/travel',
    'weather/environment','returning production/roster continuity where relevant','current form capped'
  ],
  basketball_wnba: [
    'offensive efficiency','defensive efficiency','pace','projected starting lineup','injuries/availability','projected minutes',
    'usage/role','paint matchup','perimeter/3-point profile','rebounding chances','assist creation','turnover pressure','bench depth',
    'rest/travel','blowout risk','recent form capped','player-prop role context'
  ]
};

function modulesForSport(sport){ return SPORT_MODULES[sport] || ['true strength','offense','defense','matchup','availability','environment','recent form capped']; }
function clamp(x,lo=0,hi=100){ return Math.max(lo, Math.min(hi, Number(x)||0)); }
function americanToProb(price){ const p=Number(price); if(!Number.isFinite(p)||p===0)return null; return p<0?(-p)/((-p)+100):100/(p+100); }
function probToAmerican(prob){ if(!Number.isFinite(prob)||prob<=0||prob>=1)return null; return prob>=.5?Math.round(-100*prob/(1-prob)):Math.round(100*(1-prob)/prob); }
function evFromAmerican(prob, price){ const p=Number(price); if(!Number.isFinite(prob)||!Number.isFinite(p))return null; const profit=p>0?p/100:100/(-p); return prob*profit-(1-prob); }
function formatAmerican(p){ p=Number(p); return Number.isFinite(p)?(p>0?`+${p}`:`${p}`):'—'; }
function send(res,status,data,type='application/json'){ res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'}); res.end(type==='application/json'?JSON.stringify(data):data); }
function readBody(req){ return new Promise((resolve,reject)=>{ let s=''; req.on('data',d=>{s+=d;if(s.length>5e6)req.destroy();}); req.on('end',()=>resolve(s)); req.on('error',reject); }); }
function sanitizeEvent(e){ return {id:e.id,sport_key:e.sport_key,sport_title:e.sport_title,commence_time:e.commence_time,home_team:e.home_team,away_team:e.away_team}; }
function isHardRock(book){ return ['hardrockbet','hardrockbet_fl','hardrockbet_az','hardrockbet_oh'].includes(book.key); }

async function oddsFetch(endpoint){
  if(!ODDS_KEY) throw new Error('ODDS_API_KEY is not configured.');
  const join=endpoint.includes('?')?'&':'?';
  const url=`https://api.the-odds-api.com/v4/${endpoint}${join}apiKey=${encodeURIComponent(ODDS_KEY)}`;
  const r=await fetch(url,{headers:{'User-Agent':'AEGIS-Auto-Research/2.0'}});
  const text=await r.text(); let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!r.ok) throw new Error(data.message||data.error||`Odds API ${r.status}`);
  return {data,meta:{remaining:r.headers.get('x-requests-remaining'),used:r.headers.get('x-requests-used'),last:r.headers.get('x-requests-last')}};
}

function buildQuotes(events){
  const out=[];
  for(const e of events||[]){
    for(const b of e.bookmakers||[]){
      for(const m of b.markets||[]){
        for(let i=0;i<(m.outcomes||[]).length;i++){
          const o=m.outcomes[i];
          out.push({
            quote_id:`${e.id}|${b.key}|${m.key}|${i}`,
            event_id:e.id, book_key:b.key, book:b.title, hard_rock:isHardRock(b), market_key:m.key,
            selection:o.name, price:o.price, point:o.point??null, last_update:m.last_update||b.last_update||null
          });
        }
      }
    }
  }
  return out;
}

function compactBoard(events){
  return (events||[]).map(e=>({
    ...sanitizeEvent(e),
    quotes:buildQuotes([e])
  }));
}

function blindSchema(){
  return {
    type:'object', additionalProperties:false,
    properties:{
      sport:{type:'string'}, scan_summary:{type:'string'},
      games:{type:'array',items:{type:'object',additionalProperties:false,properties:{
        event_id:{type:'string'}, away_team:{type:'string'}, home_team:{type:'string'},
        projected_winner:{type:'string'}, home_win_probability:{type:'number'},
        projected_score:{type:'object',additionalProperties:false,properties:{away:{type:['number','null']},home:{type:['number','null']}},required:['away','home']},
        projected_total:{type:['number','null']}, projected_margin_home:{type:['number','null']},
        data_quality:{type:'number'}, uncertainty:{type:'number'}, model_agreement:{type:'number'},
        research_summary:{type:'string'},
        modules:{type:'array',items:{type:'object',additionalProperties:false,properties:{
          name:{type:'string'}, edge:{type:'string'}, confidence:{type:'number'}, evidence:{type:'string'}
        },required:['name','edge','confidence','evidence']}},
        independent_edges:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},side:{type:'string'},strength:{type:'number'},evidence:{type:'string'}},required:['name','side','strength','evidence']}},
        risks:{type:'array',items:{type:'string'}}, preferred_market_types:{type:'array',items:{type:'string'}}
      },required:['event_id','away_team','home_team','projected_winner','home_win_probability','projected_score','projected_total','projected_margin_home','data_quality','uncertainty','model_agreement','research_summary','modules','independent_edges','risks','preferred_market_types']}}
    },required:['sport','scan_summary','games']
  };
}

function finalSchema(){
  return {
    type:'object',additionalProperties:false,
    properties:{
      slate_grade:{type:'string'}, final_summary:{type:'string'},
      plays:{type:'array',items:{type:'object',additionalProperties:false,properties:{
        event_id:{type:'string'}, quote_id:{type:'string'}, fair_probability:{type:'number'}, confidence:{type:'number'},
        tier:{type:'string'}, units:{type:'number'}, bet_now_wait:{type:'string'}, why:{type:'string'},
        risks:{type:'array',items:{type:'string'}}, market_challenger_probability:{type:'number'},
        adjusted_edge:{type:'number'}, data_quality:{type:'number'}, model_agreement:{type:'number'}, independent_edge_count:{type:'integer'},
        final_verification:{type:'string'}
      },required:['event_id','quote_id','fair_probability','confidence','tier','units','bet_now_wait','why','risks','market_challenger_probability','adjusted_edge','data_quality','model_agreement','independent_edge_count','final_verification']}},
      passes:{type:'array',items:{type:'object',additionalProperties:false,properties:{event_id:{type:'string'},reason:{type:'string'}},required:['event_id','reason']}},
      parlay:{type:['object','null'],additionalProperties:false,properties:{quote_ids:{type:'array',items:{type:'string'}},units:{type:'number'},rationale:{type:'string'}},required:['quote_ids','units','rationale']}
    },required:['slate_grade','final_summary','plays','passes','parlay']
  };
}

function extractText(resp){
  if(typeof resp.output_text==='string') return resp.output_text;
  for(const item of resp.output||[]){ if(item.type==='message'){ for(const c of item.content||[]){ if(c.type==='output_text'&&typeof c.text==='string') return c.text; } } }
  return '';
}
function extractSources(resp){
  const map=new Map();
  for(const item of resp.output||[]){
    if(item.type==='web_search_call' && item.action && Array.isArray(item.action.sources)){
      for(const s of item.action.sources){ const url=s.url||s.link; if(url) map.set(url,{title:s.title||s.name||url,url}); }
    }
    if(item.type==='message') for(const c of item.content||[]) for(const a of c.annotations||[]){
      if(a.type==='url_citation'&&a.url) map.set(a.url,{title:a.title||a.url,url:a.url});
    }
  }
  return [...map.values()].slice(0,60);
}

async function openAIResearch({system,user,schema,name}){
  if(!OPENAI_KEY) throw new Error('OPENAI_API_KEY is not configured in Render. Add it under Environment, then redeploy.');
  const payload={
    model:OPENAI_MODEL,
    reasoning:{effort:OPENAI_REASONING},
    tools:[{type:'web_search',search_context_size:'high'}],
    tool_choice:'auto',
    include:['web_search_call.action.sources'],
    input:[{role:'system',content:system},{role:'user',content:user}],
    text:{format:{type:'json_schema',name,strict:true,schema}},
    max_output_tokens:24000
  };
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENAI_KEY}`},body:JSON.stringify(payload)});
  const raw=await r.text(); let data; try{data=JSON.parse(raw)}catch{throw new Error(`OpenAI returned non-JSON (${r.status}).`)};
  if(!r.ok) throw new Error(data.error?.message||`OpenAI API ${r.status}`);
  const text=extractText(data); if(!text) throw new Error('OpenAI returned no structured research output.');
  let parsed; try{parsed=JSON.parse(text)}catch{throw new Error('Research response could not be parsed as JSON.');}
  return {result:parsed,sources:extractSources(data),usage:data.usage||null,response_id:data.id||null};
}

function blindSystem(sport){
  return `You are the automatic research engine for SB101 AEGIS. Perform a deep current sports scan using web search. This is STAGE 1: BLIND INDEPENDENT PROJECTION. You must NOT use sportsbook prices, betting lines, consensus odds, picks pages, or market-implied probabilities to decide the sports direction. Research real-world team/player information only. Prioritize official league/team sources, trusted beat reporting, reputable statistics sites, weather authorities, and primary injury/availability reporting. Verify dates and expected availability. Do not invent unavailable data. If evidence is incomplete, lower data_quality and increase uncertainty. PASS-quality uncertainty is a valid outcome.

Sport: ${sport}.
Relevant modules to research independently: ${modulesForSport(sport).join('; ')}.

AEGIS principles: blind sports thesis first; component-level forecasting; Model Agreement Score; Two-Independent-Edges requirement for Core consideration; Data Quality/Uncertainty Gate; How-Does-This-Lose risk analysis; score projection; current form capped so one recent result cannot dominate. For NFL preseason, model by quarter/rotation and heavily weight QB2/QB3/deep reserves. For MLB, separate starter/offense/bullpen/platoon/environment and consider run support/F5 tie risk. For WNBA, emphasize minutes/usage/availability/pace/matchup. For KBO/NPB apply league-specific volatility guards. Return calibrated probabilities, not certainty.`;
}

function finalSystem(sport){
  return `You are STAGE 2 of SB101 AEGIS: MARKET CHALLENGER + FINAL VERIFICATION. You are given blind independent research completed without sportsbook prices, plus a CURRENT quote board. Now compare the independent projection to the market. You may use web search again only to verify late-breaking injuries, lineups, rotations, weather, starter/QB usage, or other material changes. Do not let price reverse the underlying sports thesis; an overpriced preferred side should be reduced or passed, not flipped just for value.

Hard rules: only select a bet by returning an exact quote_id supplied in the current board. Never invent a line, price, book, player, or market. PASS is successful. Core requires at least two independent edges, reasonable model agreement, sufficient data quality, a market-specific cushion after uncertainty, and a credible reason the model differs from the market. Respect one thesis = one primary exposure per game. Precision Mode: maximum 2 Core plays on a slate, limited Secondary, no forced parlay. Parlays require each leg to qualify independently. Apply road-favorite, favorite-tax, fragile-total and sport-specific gates. Use the CURRENT quote, with Hard Rock Florida preferred when its price is competitive because it is the target execution book; otherwise identify the better quoted book but never fabricate Hard Rock availability. For each play provide a fair win probability and a market challenger probability as decimals from 0 to 1, plus adjusted_edge as fair probability minus market challenger after uncertainty. Tiers must be CORE, SECONDARY, WATCH, or PASS. Units: CORE typically 1.0, SECONDARY 0.5, WATCH/PASS 0.0, parlay 0.25 unless exceptional. If no play clears gates, return no plays.`;
}

function hydrateFinal(final, events){
  const quotes=buildQuotes(events); const qmap=new Map(quotes.map(q=>[q.quote_id,q])); const eventMap=new Map(events.map(e=>[e.id,e]));
  const valid=[]; const seen=new Set();
  for(const p of final.plays||[]){
    const q=qmap.get(p.quote_id); if(!q||q.event_id!==p.event_id||seen.has(p.event_id)) continue;
    seen.add(p.event_id);
    let tier=String(p.tier||'PASS').toUpperCase();
    if(!['CORE','SECONDARY','WATCH','PASS'].includes(tier)) tier='WATCH';
    if(p.data_quality<68 || p.model_agreement<62 || p.independent_edge_count<2){ if(tier==='CORE') tier='SECONDARY'; }
    if(p.adjusted_edge<0.015 && tier==='CORE') tier='SECONDARY';
    if(p.adjusted_edge<=0 && ['CORE','SECONDARY'].includes(tier)) tier='WATCH';
    const fair=Number(p.fair_probability); const ev=evFromAmerican(fair,q.price); const e=eventMap.get(q.event_id);
    valid.push({...p,tier,units:tier==='CORE'?Math.min(1,Number(p.units)||1):tier==='SECONDARY'?Math.min(.5,Number(p.units)||.5):0,
      event:e?sanitizeEvent(e):null,quote:q,implied_probability:americanToProb(q.price),fair_price:probToAmerican(fair),estimated_ev:ev});
  }
  valid.sort((a,b)=>(b.tier==='CORE'?2:b.tier==='SECONDARY'?1:0)-(a.tier==='CORE'?2:a.tier==='SECONDARY'?1:0) || (b.adjusted_edge||0)-(a.adjusted_edge||0));
  let coreCount=0; for(const p of valid){ if(p.tier==='CORE'){ coreCount++; if(coreCount>2){p.tier='SECONDARY';p.units=.5;} } }
  const parlay=final.parlay && Array.isArray(final.parlay.quote_ids) ? (()=>{ const legs=final.parlay.quote_ids.map(id=>qmap.get(id)).filter(Boolean); if(legs.length<2)return null; const eligible=new Set(valid.filter(p=>['CORE','SECONDARY'].includes(p.tier)).map(p=>p.quote_id)); if(!legs.every(l=>eligible.has(l.quote_id)))return null; const distinct=new Set(legs.map(l=>l.event_id)); if(distinct.size!==legs.length)return null; let dec=1; for(const l of legs){const p=l.price>0?1+l.price/100:1+100/(-l.price); dec*=p;} const american=dec>=2?Math.round((dec-1)*100):Math.round(-100/(dec-1)); return {legs,units:.25,rationale:final.parlay.rationale,approx_american:american}; })() : null;
  return {...final,plays:valid,parlay};
}

const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#06131d"><title>SB101 AEGIS Auto Research</title><style>
:root{--bg:#06131d;--panel:#0b1b28;--panel2:#0e2232;--line:#244055;--text:#eef5fb;--muted:#98adbd;--mint:#5ef0b7;--red:#ff6b76;--gold:#ffd36b;--blue:#7ab8ff}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#071825,#06131d);color:var(--text);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1050px;margin:auto;padding:24px 18px 80px}.hero{padding:20px 0 8px}.eyebrow{color:var(--mint);font-weight:800;letter-spacing:.14em}.hero h1{font-size:clamp(34px,7vw,60px);line-height:1;margin:10px 0}.muted{color:var(--muted)}.status{display:inline-flex;gap:10px;align-items:center;border:1px solid var(--mint);border-radius:999px;padding:11px 16px;margin:10px 0;font-size:14px}.tabs{display:flex;gap:10px;overflow:auto;padding:14px 0;position:sticky;top:0;background:#06131df2;z-index:5}.tab,.btn,select{border:1px solid var(--line);background:#0b1b28;color:var(--text);border-radius:14px;padding:14px 16px;font-size:16px}.tab.active{border-color:var(--mint)}.btn{cursor:pointer;font-weight:800}.btn.primary{background:var(--mint);color:#052018;border-color:var(--mint)}.btn.secondary{border-color:var(--blue)}.btn:disabled{opacity:.5}.panel,.game,.result{background:rgba(11,27,40,.9);border:1px solid var(--line);border-radius:22px;padding:18px;margin:16px 0}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.control label{display:block;color:var(--muted);font-size:13px;margin:0 0 7px}.game h3{font-size:20px;margin:6px 0 12px}.quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.quote{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px;font-size:14px}.quote.hardrock{border-color:var(--mint)}.quote b{display:block;color:var(--muted);margin-bottom:5px}.progress{display:none;background:#0e2232;border:1px solid var(--blue);border-radius:18px;padding:18px;margin:16px 0}.progress.show{display:block}.bar{height:8px;background:#173247;border-radius:999px;overflow:hidden;margin-top:10px}.bar i{display:block;height:100%;background:var(--mint);width:15%;transition:.3s}.badge{display:inline-block;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;margin-right:6px}.CORE{background:#174d3b;color:#7dffd0}.SECONDARY{background:#3e3415;color:#ffe38a}.WATCH{background:#173650;color:#a9d5ff}.PASS{background:#49242a;color:#ffb1b8}.metricgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.metric{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px}.metric b{display:block;color:var(--muted);font-size:12px}.play{border-left:4px solid var(--mint);padding-left:14px;margin:18px 0}.risk{color:#ffc0c5}.sources a{color:#8ec8ff;display:block;margin:8px 0;overflow-wrap:anywhere}.models{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.model{background:#081823;border:1px solid #203a4e;border-radius:14px;padding:12px}.hidden{display:none}.notice{border:1px solid #45596b;background:#0b1b28;border-radius:14px;padding:12px}.small{font-size:12px}.hr{height:1px;background:var(--line);margin:16px 0}@media(max-width:600px){.wrap{padding:16px 12px 70px}.controls>*{width:100%}.controls select,.controls button{width:100%}.quotes{grid-template-columns:1fr 1fr}.tab{padding:12px 14px}.game{padding:14px}}
</style></head><body><div class="wrap"><div class="hero"><div class="eyebrow">SB101 AEGIS v2 • AUTO RESEARCH</div><h1>Sports Command Center</h1><p class="muted">One tap: live odds → blind web research → sport-specific models → market challenger → final verification → disciplined card.</p><div id="status" class="status">Checking data engines…</div></div>
<div class="tabs"><button class="tab active" data-tab="dashboard">Dashboard</button><button class="tab" data-tab="card">Final Card</button><button class="tab" data-tab="models">Model Registry</button></div>
<section id="dashboard"><div class="panel"><div class="controls"><div class="control"><label>Sport</label><select id="sport"></select></div><div class="control"><label>Markets</label><select id="markets"><option value="h2h,spreads,totals">ML + Spread + Total</option><option value="h2h">Moneyline only</option></select></div><button class="btn secondary" id="sync">Sync Live Board</button><button class="btn primary" id="scan" disabled>RUN FULL AUTOMATIC SLATE SCAN</button></div><p id="quota" class="muted small"></p><p class="muted small">No model sliders. AEGIS researches the matchup automatically. The slate scan is capped by the server's MAX_SCAN_GAMES setting to control API cost.</p></div><div id="progress" class="progress"><b id="progressTitle">Starting…</b><div id="progressText" class="muted">Preparing research.</div><div class="bar"><i id="progressBar"></i></div></div><div id="events"></div></section>
<section id="card" class="hidden"><div id="cardContent" class="panel"><h2>No automatic scan yet</h2><p class="muted">Sync a board and run the full automatic slate scan.</p></div></section>
<section id="models" class="hidden"><div class="panel"><h2>49-model AEGIS registry</h2><p class="muted">The automatic research engine activates only the modules relevant to the selected sport, while the governance/execution layers run on every final decision.</p><div id="modelGrid" class="models"></div></div></section>
</div><script>
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)]; let EVENTS=[]; let LAST=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtA=p=>Number(p)>0?'+'+p:String(p??'—'); const pct=x=>Number.isFinite(Number(x))?(Number(x)*100).toFixed(1)+'%':'—';
async function api(url,opt){const r=await fetch(url,opt);const t=await r.text();let d;try{d=JSON.parse(t)}catch{d={error:t}};if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));return d}
function tab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));['dashboard','card','models'].forEach(x=>$('#'+x).classList.toggle('hidden',x!==name))}
$$('.tab').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
async function init(){const h=await api('/api/health');$('#status').textContent=(h.odds_ready?'ODDS READY':'ODDS KEY NEEDED')+' • '+(h.research_ready?'AUTO RESEARCH READY':'OPENAI KEY NEEDED')+' • '+h.models+' models'; const s=await api('/api/sports');$('#sport').innerHTML=s.sports.map(x=>'<option value="'+esc(x.key)+'">'+esc(x.title)+'</option>').join(''); const m=await api('/api/models');$('#modelGrid').innerHTML=m.models.map(x=>'<div class="model"><b>'+esc(x[0])+'</b><div class="muted small">'+esc(x[1])+'</div><p>'+esc(x[2])+'</p></div>').join('')}
function renderQuotes(e){let books=[...(e.bookmakers||[])].sort((a,b)=>(b.key.includes('hardrock')?1:0)-(a.key.includes('hardrock')?1:0));return books.flatMap(b=>(b.markets||[]).map(m=>{let txt=(m.outcomes||[]).map(o=>esc(o.name)+(o.point!=null?' '+esc(o.point):'')+' '+fmtA(o.price)).join('<br>');return '<div class="quote '+(b.key.includes('hardrock')?'hardrock':'')+'"><b>'+esc(b.title)+' • '+esc(m.key)+(b.key.includes('hardrock')?' • TARGET BOOK':'')+'</b>'+txt+'</div>'})).join('')}
function renderEvents(){ $('#events').innerHTML=EVENTS.length?EVENTS.map((e,i)=>'<article class="game"><div class="muted small">'+new Date(e.commence_time).toLocaleString()+'</div><h3>'+esc(e.away_team)+' @ '+esc(e.home_team)+'</h3><div class="quotes">'+renderQuotes(e)+'</div><button class="btn secondary" data-game="'+i+'" style="margin-top:12px">AUTO DEEP SCAN THIS GAME</button></article>').join(''):'<div class="panel">No events returned.</div>'; $$('[data-game]').forEach(b=>b.onclick=()=>runScan([EVENTS[+b.dataset.game]],true)); }
$('#sync').onclick=async()=>{try{$('#events').innerHTML='<div class="panel">Syncing live board…</div>';const d=await api('/api/odds?sport='+encodeURIComponent($('#sport').value)+'&markets='+encodeURIComponent($('#markets').value));EVENTS=d.events||[];$('#quota').textContent=d.quota?'Odds API quota • remaining '+(d.quota.remaining??'—')+' • used '+(d.quota.used??'—')+' • last '+(d.quota.last??'—'):'';renderEvents();$('#scan').disabled=!EVENTS.length}catch(e){$('#events').innerHTML='<div class="panel"><b>Live sync error</b><p>'+esc(e.message)+'</p></div>'}}
function progress(p,title,text){$('#progress').classList.add('show');$('#progressBar').style.width=p+'%';$('#progressTitle').textContent=title;$('#progressText').textContent=text;window.scrollTo({top:$('#progress').offsetTop-80,behavior:'smooth'})}
async function runScan(events,single=false){try{const cap=Number((await api('/api/health')).max_scan_games||12);events=events.slice(0,cap);progress(12,'Stage 1 of 4 • Blind independent research','Searching current team/player information without sportsbook prices.');$('#scan').disabled=true;const blind=await api('/api/scan/blind',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sport:$('#sport').value,events:events.map(e=>({id:e.id,sport_key:e.sport_key,sport_title:e.sport_title,commence_time:e.commence_time,home_team:e.home_team,away_team:e.away_team}))})});progress(48,'Stage 2 of 4 • Component agreement','Independent projections complete. Measuring agreement, uncertainty and failure paths.');await new Promise(r=>setTimeout(r,250));progress(62,'Stage 3 of 4 • Market challenger','Comparing blind projections to current sportsbook quotes and Hard Rock Florida when available.');const fin=await api('/api/scan/final',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sport:$('#sport').value,events,blind:blind.result,blind_sources:blind.sources})});progress(92,'Stage 4 of 4 • Final verification','Running release gates, exposure guard, Core cap and parlay validation.');LAST={blind,final:fin};renderCard(LAST);progress(100,'Automatic AEGIS scan complete','Final card is ready. PASS is allowed when the release gates are not met.');setTimeout(()=>tab('card'),400)}catch(e){progress(100,'Scan stopped',e.message);$('#progressBar').style.background='var(--red)'}finally{$('#scan').disabled=!EVENTS.length}}
$('#scan').onclick=()=>runScan(EVENTS,false);
function renderCard(data){const f=data.final.result;const plays=f.plays||[];const passes=f.passes||[];let h='<div class="muted small">SLATE GRADE</div><h2>'+esc(f.slate_grade||'—')+'</h2><p>'+esc(f.final_summary||'')+'</p>';
if(!plays.length)h+='<div class="notice"><b>NO QUALIFIED BETS</b><p class="muted">AEGIS did not release a play. That is a successful system outcome when the gates are not met.</p></div>';
for(const p of plays){const q=p.quote||{};h+='<div class="play"><span class="badge '+esc(p.tier)+'">'+esc(p.tier)+'</span><b>'+esc(p.event?.away_team||'')+' @ '+esc(p.event?.home_team||'')+'</b><h3>'+esc(q.selection||'')+(q.point!=null?' '+esc(q.point):'')+' '+fmtA(q.price)+' • '+esc(q.book||'')+'</h3><div class="metricgrid"><div class="metric"><b>Fair probability</b>'+pct(p.fair_probability)+'</div><div class="metric"><b>Fair price</b>'+fmtA(p.fair_price)+'</div><div class="metric"><b>Adjusted edge</b>'+pct(p.adjusted_edge)+'</div><div class="metric"><b>Estimated EV</b>'+pct(p.estimated_ev)+'</div><div class="metric"><b>Model agreement</b>'+Number(p.model_agreement).toFixed(0)+'/100</div><div class="metric"><b>Data quality</b>'+Number(p.data_quality).toFixed(0)+'/100</div><div class="metric"><b>Stake</b>'+p.units+'u</div><div class="metric"><b>Timing</b>'+esc(p.bet_now_wait)+'</div></div><p><b>Why:</b> '+esc(p.why)+'</p><p class="risk"><b>How it loses:</b> '+esc((p.risks||[]).join(' • '))+'</p><p class="muted"><b>Final verification:</b> '+esc(p.final_verification)+'</p></div>'}
if(f.parlay){h+='<div class="panel"><h3>Qualified parlay • '+f.parlay.units+'u • approx '+fmtA(f.parlay.approx_american)+'</h3>'+f.parlay.legs.map(l=>'<div>'+esc(l.selection)+(l.point!=null?' '+esc(l.point):'')+' '+fmtA(l.price)+' • '+esc(l.book)+'</div>').join('')+'<p>'+esc(f.parlay.rationale)+'</p></div>'}
if(passes.length){h+='<div class="hr"></div><h3>Pass / Cut</h3>'+passes.map(p=>'<p class="muted"><b>'+esc((EVENTS.find(e=>e.id===p.event_id)||{}).away_team||p.event_id)+'</b> — '+esc(p.reason)+'</p>').join('')}
const sources=[...(data.blind.sources||[]),...(data.final.sources||[])];const unique=[...new Map(sources.map(s=>[s.url,s])).values()].slice(0,35);if(unique.length)h+='<div class="hr"></div><h3>Research sources</h3><div class="sources">'+unique.map(s=>'<a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.title||s.url)+'</a>').join('')+'</div>';
$('#cardContent').innerHTML=h}
init().catch(e=>{$('#status').textContent='Setup error: '+e.message});
</script></body></html>`;

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&u.pathname==='/') return send(res,200,HTML,'text/html; charset=utf-8');
    if(req.method==='GET'&&u.pathname==='/api/health') return send(res,200,{ok:true,version:'2.0.0',models:MODELS.length,odds_ready:!!ODDS_KEY,research_ready:!!OPENAI_KEY,openai_model:OPENAI_MODEL,max_scan_games:MAX_SCAN_GAMES,target_book:'Hard Rock Bet Florida'});
    if(req.method==='GET'&&u.pathname==='/api/models') return send(res,200,{models:MODELS});
    if(req.method==='GET'&&u.pathname==='/api/sports') return send(res,200,{sports:SPORTS});
    if(req.method==='GET'&&u.pathname==='/api/odds'){
      const sport=u.searchParams.get('sport')||'baseball_mlb'; const markets=u.searchParams.get('markets')||'h2h,spreads,totals';
      const endpoint=`sports/${encodeURIComponent(sport)}/odds?bookmakers=${encodeURIComponent(ODDS_BOOKMAKERS)}&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`;
      const r=await oddsFetch(endpoint); return send(res,200,{events:r.data,quota:r.meta,bookmakers:ODDS_BOOKMAKERS.split(',')});
    }
    if(req.method==='POST'&&u.pathname==='/api/scan/blind'){
      const body=JSON.parse(await readBody(req)||'{}'); const sport=body.sport; const events=(body.events||[]).slice(0,MAX_SCAN_GAMES);
      if(!sport||!events.length) return send(res,400,{error:'sport and events are required'});
      const user=`Current UTC time: ${new Date().toISOString()}\nResearch these scheduled games. Do not use betting odds in this stage. Verify that each event is current and identify late news.\n\n${JSON.stringify(events,null,2)}`;
      const r=await openAIResearch({system:blindSystem(sport),user,schema:blindSchema(),name:'aegis_blind_scan'}); return send(res,200,r);
    }
    if(req.method==='POST'&&u.pathname==='/api/scan/final'){
      const body=JSON.parse(await readBody(req)||'{}'); const sport=body.sport; const events=(body.events||[]).slice(0,MAX_SCAN_GAMES); const blind=body.blind;
      if(!sport||!events.length||!blind) return send(res,400,{error:'sport, events, and blind research are required'});
      const board=compactBoard(events);
      const user=`Current UTC time: ${new Date().toISOString()}\nBelow is the blind research from Stage 1 and the current sportsbook quote board. Use exact quote_id values only. Hard Rock Florida quotes are marked hard_rock=true. Perform final verification and release only bets that clear AEGIS.\n\nBLIND RESEARCH:\n${JSON.stringify(blind)}\n\nCURRENT QUOTES:\n${JSON.stringify(board)}`;
      const r=await openAIResearch({system:finalSystem(sport),user,schema:finalSchema(),name:'aegis_final_card'}); r.result=hydrateFinal(r.result,events); return send(res,200,r);
    }
    return send(res,404,{error:'Not found'});
  }catch(e){console.error(e);return send(res,500,{error:e.message||'Server error'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`AEGIS Auto Research v2 running on ${PORT} • ${MODELS.length} models • OpenAI ${OPENAI_MODEL}`));
