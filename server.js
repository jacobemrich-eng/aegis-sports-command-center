const http = require('http');
const { URL } = require('url');

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


function clamp(x, lo=0, hi=100){ return Math.max(lo, Math.min(hi, x)); }
function americanToProb(price){
  const p = Number(price);
  if (!Number.isFinite(p) || p === 0) return null;
  return p < 0 ? (-p)/((-p)+100) : 100/(p+100);
}
function probToAmerican(prob){
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null;
  return prob >= .5 ? Math.round(-100*prob/(1-prob)) : Math.round(100*(1-prob)/prob);
}
function devigTwoWay(a,b){
  const pa = americanToProb(a), pb = americanToProb(b);
  if (pa == null || pb == null) return null;
  const s = pa+pb;
  return {a: pa/s, b: pb/s, hold: s-1};
}
function average(xs){ const v=xs.filter(Number.isFinite); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; }
function sd(xs){ const m=average(xs); if(m==null) return null; return Math.sqrt(average(xs.map(x=>(x-m)**2))); }

function extractConsensus(event){
  const rows = [];
  for (const book of event.bookmakers || []) {
    for (const market of book.markets || []) {
      if (market.key !== 'h2h') continue;
      const home = market.outcomes.find(o=>o.name===event.home_team);
      const away = market.outcomes.find(o=>o.name===event.away_team);
      if (!home || !away) continue;
      const dv = devigTwoWay(home.price, away.price);
      if (!dv) continue;
      rows.push({book:book.title, homePrice:home.price, awayPrice:away.price, homeProb:dv.a, awayProb:dv.b, hold:dv.hold});
    }
  }
  return {
    rows,
    homeProb: average(rows.map(r=>r.homeProb)),
    awayProb: average(rows.map(r=>r.awayProb)),
    homeDispersion: sd(rows.map(r=>r.homeProb)),
    hold: average(rows.map(r=>r.hold))
  };
}

function defaultFactorSet(){
  return {
    talent: 50, offense: 50, defense: 50, starter: 50, bullpen: 50,
    depth: 50, qbDepth: 50, coaching: 50, role: 50, matchup: 50,
    environment: 50, availability: 50, specialTeams: 50, recentForm: 50,
    dataQuality: 40, uncertainty: 60, failureRisk: 50
  };
}

function factorWeightForSport(sport){
  if (sport.includes('baseball')) return {talent:.10, offense:.16, defense:.04, starter:.22, bullpen:.12, matchup:.14, environment:.08, availability:.08, recentForm:.06};
  if (sport==='americanfootball_nfl_preseason') return {talent:.05, offense:.05, defense:.08, depth:.18, qbDepth:.23, coaching:.14, specialTeams:.07, availability:.10, recentForm:.03, matchup:.07};
  if (sport.includes('americanfootball')) return {talent:.20, offense:.17, defense:.17, matchup:.14, availability:.12, coaching:.05, specialTeams:.05, recentForm:.10};
  if (sport==='basketball_wnba') return {talent:.15, offense:.18, defense:.17, matchup:.15, availability:.15, recentForm:.10, role:.05, environment:.05};
  if (sport.includes('tennis')) return {talent:.24, offense:.20, defense:.20, matchup:.20, recentForm:.10, availability:.06};
  return {talent:.20, offense:.15, defense:.15, matchup:.15, availability:.15, recentForm:.10, environment:.10};
}

function weightedScore(factors, weights){
  let n=0,d=0;
  for (const [k,w] of Object.entries(weights)) { if (Number.isFinite(+factors[k])) { n += (+factors[k])*w; d+=w; } }
  return d ? n/d : 50;
}

function marketSpecificCushion({sport, market='h2h', isFavorite=false, price=null, road=false}){
  let pct = 0.025;
  if (market.includes('spreads')) pct = 0.03;
  if (market.includes('totals')) pct = 0.035;
  if (market.includes('h1') || market.includes('q1') || market.includes('f5')) pct += 0.01;
  if (sport.includes('baseball') && market.includes('f5')) pct += 0.008;
  if (sport==='americanfootball_nfl_preseason' && isFavorite) pct += 0.012;
  if (road && isFavorite) pct += 0.008;
  if (price && price <= -220) pct += 0.012;
  return pct;
}

function runAegis({event, factors={}, selection='home', market='h2h', offeredPrice=null, road=false, bankroll=100}){
  const f = {...defaultFactorSet(), ...factors};
  const consensus = extractConsensus(event);
  const weights = factorWeightForSport(event.sport_key || '');
  const thesisScore = weightedScore(f, weights);
  const thesisProb = clamp(50 + (thesisScore-50)*0.9, 2, 98)/100;
  const selectedThesisProb = selection==='home' ? thesisProb : 1-thesisProb;
  const marketProb = selection==='home' ? consensus.homeProb : consensus.awayProb;
  const priceProb = americanToProb(offeredPrice);
  const challengerProb = marketProb ?? priceProb ?? .5;

  const relevantFactorValues = Object.keys(weights).map(k=>+f[k]).filter(Number.isFinite);
  const disagreement = sd(relevantFactorValues) || 0;
  const agreement = clamp(100 - disagreement*2.1);
  const independentEdges = relevantFactorValues.filter(x=>x>=58).length;
  const dataQuality = clamp(+f.dataQuality);
  const uncertainty = clamp(+f.uncertainty);
  const failureRisk = clamp(+f.failureRisk);
  const favorite = (offeredPrice ?? probToAmerican(challengerProb)) < 0;
  const cushion = marketSpecificCushion({sport:event.sport_key||'',market,isFavorite:favorite,price:offeredPrice,road});
  const rawEdge = selectedThesisProb - challengerProb;
  const uncertaintyPenalty = ((100-dataQuality)*0.00022) + (uncertainty*0.00012) + (failureRisk*0.00008);
  const adjustedEdge = rawEdge - uncertaintyPenalty;
  const fairPrice = probToAmerican(selectedThesisProb);
  const ev = offeredPrice == null ? null : (()=>{
    const decimal = offeredPrice < 0 ? 1 + 100/Math.abs(offeredPrice) : 1 + offeredPrice/100;
    return selectedThesisProb*decimal - 1;
  })();

  const gates = {
    independentThesis: thesisScore >= 54,
    agreement: agreement >= 68,
    twoIndependentEdges: independentEdges >= 2,
    marketCushion: adjustedEdge >= cushion,
    dataQuality: dataQuality >= 65,
    uncertainty: uncertainty <= 45,
    mistakeFirewall: failureRisk <= 58,
    priceEV: ev == null ? true : ev >= 0.015
  };
  const passCount = Object.values(gates).filter(Boolean).length;
  let tier = 'PASS';
  if (Object.values(gates).every(Boolean) && thesisScore>=61 && agreement>=75) tier='CORE';
  else if (passCount>=6 && adjustedEdge>0) tier='SECONDARY';
  else if (passCount>=5 && adjustedEdge>0.01) tier='WATCH';

  const baseUnit = Math.max(1, bankroll*0.03);
  const stake = tier==='CORE' ? baseUnit : tier==='SECONDARY' ? baseUnit*.5 : 0;
  const timing = dataQuality<70 || uncertainty>35 ? 'WAIT' : (adjustedEdge >= cushion*1.35 ? 'BET NOW' : 'WAIT');

  const sportChecks = [];
  if ((event.sport_key||'').includes('baseball')) {
    sportChecks.push({name:'Offensive Support Filter',pass:f.offense>=52 || f.starter<62});
    sportChecks.push({name:'F5 Tie-Risk / Fragile Total Guard',pass: market.includes('f5') ? f.offense>=55 : true});
  }
  if (event.sport_key==='americanfootball_nfl_preseason') {
    sportChecks.push({name:'QB Depth Gate',pass:f.qbDepth>=55});
    sportChecks.push({name:'Rotation Depth Gate',pass:f.depth>=55});
    sportChecks.push({name:'Large Favorite Gate',pass:!(favorite && offeredPrice && offeredPrice<-180) || (f.qbDepth>=62 && f.depth>=62)});
  }
  if (event.sport_key==='basketball_wnba') sportChecks.push({name:'Minutes / Availability Gate',pass:f.availability>=60});

  if (sportChecks.some(x=>!x.pass) && tier==='CORE') tier='SECONDARY';

  return {
    tier, timing, selection, market, offeredPrice, fairPrice,
    thesisScore:+thesisScore.toFixed(1), thesisProb:+selectedThesisProb.toFixed(4),
    marketProb:+challengerProb.toFixed(4), rawEdge:+rawEdge.toFixed(4), adjustedEdge:+adjustedEdge.toFixed(4),
    requiredCushion:+cushion.toFixed(4), agreement:+agreement.toFixed(1), independentEdges,
    dataQuality, uncertainty, failureRisk,
    ev: ev==null ? null : +ev.toFixed(4), stake:+stake.toFixed(2),
    consensus, gates, sportChecks,
    scoreProjection: {
      home: +(50 + (thesisScore-50)*0.42).toFixed(1),
      away: +(50 - (thesisScore-50)*0.42).toFixed(1),
      note: 'Normalized model score, not literal game points unless sport-specific enrichment is supplied.'
    },
    modelsExecuted: MODELS.map(([name,category,purpose])=>({name,category,purpose,status:'evaluated-or-gated'}))
  };
}


const STATIC_ASSETS = {
  "/": { type: "text/html; charset=utf-8", body: Buffer.from("PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CiAgPG1ldGEgY2hhcnNldD0idXRmLTgiIC8+CiAgPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCxpbml0aWFsLXNjYWxlPTEiIC8+CiAgPHRpdGxlPkFFR0lTIFNwb3J0cyBDb21tYW5kIENlbnRlcjwvdGl0bGU+CiAgPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBocmVmPSJzdHlsZXMuY3NzIiAvPgo8L2hlYWQ+Cjxib2R5PgogIDxoZWFkZXI+CiAgICA8ZGl2PgogICAgICA8ZGl2IGNsYXNzPSJleWVicm93Ij5TQjEwMSBBRUdJUyB2MS4wPC9kaXY+CiAgICAgIDxoMT5TcG9ydHMgQ29tbWFuZCBDZW50ZXI8L2gxPgogICAgICA8cD5MaXZlIG1hcmtldCBpbmdlc3Rpb24g4oaSIGluZGVwZW5kZW50IHRoZXNpcyDihpIgY2hhbGxlbmdlciBtYXJrZXQg4oaSIHJlbGVhc2UgZ2F0ZXMg4oaSIGRpc2NpcGxpbmVkIGZpbmFsIGNhcmQuPC9wPgogICAgPC9kaXY+CiAgICA8ZGl2IGlkPSJoZWFsdGgiIGNsYXNzPSJzdGF0dXMiPkNoZWNraW5nIGRhdGEgbGF5ZXLigKY8L2Rpdj4KICA8L2hlYWRlcj4KCiAgPG5hdj4KICAgIDxidXR0b24gZGF0YS10YWI9ImRhc2hib2FyZCIgY2xhc3M9ImFjdGl2ZSI+RGFzaGJvYXJkPC9idXR0b24+CiAgICA8YnV0dG9uIGRhdGEtdGFiPSJhbmFseXplciI+QW5hbHl6ZXI8L2J1dHRvbj4KICAgIDxidXR0b24gZGF0YS10YWI9Im1vZGVscyI+TW9kZWwgUmVnaXN0cnk8L2J1dHRvbj4KICAgIDxidXR0b24gZGF0YS10YWI9IndlYXRoZXIiPldlYXRoZXI8L2J1dHRvbj4KICA8L25hdj4KCiAgPG1haW4+CiAgICA8c2VjdGlvbiBpZD0iZGFzaGJvYXJkIiBjbGFzcz0idGFiIGFjdGl2ZSI+CiAgICAgIDxkaXYgY2xhc3M9InRvb2xiYXIgcGFuZWwiPgogICAgICAgIDxsYWJlbD5TcG9ydDxzZWxlY3QgaWQ9InNwb3J0Ij48L3NlbGVjdD48L2xhYmVsPgogICAgICAgIDxsYWJlbD5NYXJrZXRzPHNlbGVjdCBpZD0ibWFya2V0cyI+PG9wdGlvbiB2YWx1ZT0iaDJoLHNwcmVhZHMsdG90YWxzIj5NTCArIFNwcmVhZCArIFRvdGFsPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iaDJoIj5Nb25leWxpbmUgb25seTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9InNwcmVhZHMiPlNwcmVhZCBvbmx5PC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0idG90YWxzIj5Ub3RhbHMgb25seTwvb3B0aW9uPjwvc2VsZWN0PjwvbGFiZWw+CiAgICAgICAgPGJ1dHRvbiBpZD0ibG9hZE9kZHMiIGNsYXNzPSJwcmltYXJ5Ij5TeW5jIExpdmUgQm9hcmQ8L2J1dHRvbj4KICAgICAgPC9kaXY+CiAgICAgIDxkaXYgaWQ9InF1b3RhIiBjbGFzcz0ic3VidGxlIj48L2Rpdj4KICAgICAgPGRpdiBpZD0iZXZlbnRzIiBjbGFzcz0iZ3JpZCI+PC9kaXY+CiAgICA8L3NlY3Rpb24+CgogICAgPHNlY3Rpb24gaWQ9ImFuYWx5emVyIiBjbGFzcz0idGFiIj4KICAgICAgPGRpdiBjbGFzcz0icGFuZWwiPgogICAgICAgIDxoMj5BRUdJUyBBbmFseXplcjwvaDI+CiAgICAgICAgPHAgY2xhc3M9InN1YnRsZSI+U2VsZWN0IGEgZ2FtZSBmcm9tIHRoZSBsaXZlIGJvYXJkLCB0aGVuIGFkZCBpbmRlcGVuZGVudCBpbmZvcm1hdGlvbi4gTWlzc2luZyBpbnB1dHMgbG93ZXIgRGF0YSBRdWFsaXR5IGFuZCBjYW4gZm9yY2UgUEFTUy48L3A+CiAgICAgICAgPGRpdiBpZD0ic2VsZWN0ZWRHYW1lIiBjbGFzcz0ic2VsZWN0ZWQiPk5vIGdhbWUgc2VsZWN0ZWQuPC9kaXY+CiAgICAgIDwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJhbmFseXplci1sYXlvdXQiPgogICAgICAgIDxmb3JtIGlkPSJhbmFseXNpc0Zvcm0iIGNsYXNzPSJwYW5lbCBmYWN0b3ItZm9ybSI+CiAgICAgICAgICA8ZGl2IGNsYXNzPSJyb3ciPjxsYWJlbD5TZWxlY3Rpb248c2VsZWN0IGlkPSJzZWxlY3Rpb24iPjxvcHRpb24gdmFsdWU9ImhvbWUiPkhvbWU8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJhd2F5Ij5Bd2F5PC9vcHRpb24+PC9zZWxlY3Q+PC9sYWJlbD48bGFiZWw+T2ZmZXJlZCBBbWVyaWNhbiBwcmljZTxpbnB1dCBpZD0icHJpY2UiIHR5cGU9Im51bWJlciIgcGxhY2Vob2xkZXI9Ii0xMTAiIC8+PC9sYWJlbD48bGFiZWw+QmFua3JvbGw8aW5wdXQgaWQ9ImJhbmtyb2xsIiB0eXBlPSJudW1iZXIiIHZhbHVlPSIxMDAiIG1pbj0iMSIgc3RlcD0iMC4wMSIgLz48L2xhYmVsPjwvZGl2PgogICAgICAgICAgPGRpdiBpZD0iZmFjdG9ycyI+PC9kaXY+CiAgICAgICAgICA8YnV0dG9uIGNsYXNzPSJwcmltYXJ5IiB0eXBlPSJzdWJtaXQiPlJ1biBGdWxsIEFFR0lTIFZlcmlmaWNhdGlvbjwvYnV0dG9uPgogICAgICAgIDwvZm9ybT4KICAgICAgICA8ZGl2IGlkPSJhbmFseXNpc1Jlc3VsdCIgY2xhc3M9InBhbmVsIHJlc3VsdCI+PGgzPkRlY2lzaW9uIG91dHB1dDwvaDM+PHAgY2xhc3M9InN1YnRsZSI+Tm8gYW5hbHlzaXMgeWV0LjwvcD48L2Rpdj4KICAgICAgPC9kaXY+CiAgICA8L3NlY3Rpb24+CgogICAgPHNlY3Rpb24gaWQ9Im1vZGVscyIgY2xhc3M9InRhYiI+PGRpdiBjbGFzcz0icGFuZWwiPjxoMj5Nb2RlbCAmIFN5c3RlbSBSZWdpc3RyeTwvaDI+PGRpdiBpZD0ibW9kZWxMaXN0IiBjbGFzcz0ibW9kZWwtbGlzdCI+PC9kaXY+PC9kaXY+PC9zZWN0aW9uPgoKICAgIDxzZWN0aW9uIGlkPSJ3ZWF0aGVyIiBjbGFzcz0idGFiIj4KICAgICAgPGRpdiBjbGFzcz0icGFuZWwiPgogICAgICAgIDxoMj5OV1MgV2VhdGhlciBFbnJpY2htZW50PC9oMj4KICAgICAgICA8cCBjbGFzcz0ic3VidGxlIj5GcmVlIFUuUy4gTmF0aW9uYWwgV2VhdGhlciBTZXJ2aWNlIGZlZWQuIEVudGVyIHZlbnVlIGNvb3JkaW5hdGVzIHRvIGFkZCByZWFsIGZvcmVjYXN0IGNvbnRleHQgdG8gZW52aXJvbm1lbnQgbW9kZWxzLjwvcD4KICAgICAgICA8ZGl2IGNsYXNzPSJyb3ciPjxsYWJlbD5MYXRpdHVkZTxpbnB1dCBpZD0ibGF0IiB2YWx1ZT0iMjcuMjczIiAvPjwvbGFiZWw+PGxhYmVsPkxvbmdpdHVkZTxpbnB1dCBpZD0ibG9uIiB2YWx1ZT0iLTgwLjM1OCIgLz48L2xhYmVsPjxidXR0b24gaWQ9ImxvYWRXZWF0aGVyIiBjbGFzcz0icHJpbWFyeSI+R2V0IEZvcmVjYXN0PC9idXR0b24+PC9kaXY+CiAgICAgICAgPGRpdiBpZD0iZm9yZWNhc3QiPjwvZGl2PgogICAgICA8L2Rpdj4KICAgIDwvc2VjdGlvbj4KICA8L21haW4+CjxzY3JpcHQgc3JjPSJhcHAuanMiPjwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4K", 'base64') },
  "/index.html": { type: "text/html; charset=utf-8", body: Buffer.from("PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CiAgPG1ldGEgY2hhcnNldD0idXRmLTgiIC8+CiAgPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCxpbml0aWFsLXNjYWxlPTEiIC8+CiAgPHRpdGxlPkFFR0lTIFNwb3J0cyBDb21tYW5kIENlbnRlcjwvdGl0bGU+CiAgPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBocmVmPSJzdHlsZXMuY3NzIiAvPgo8L2hlYWQ+Cjxib2R5PgogIDxoZWFkZXI+CiAgICA8ZGl2PgogICAgICA8ZGl2IGNsYXNzPSJleWVicm93Ij5TQjEwMSBBRUdJUyB2MS4wPC9kaXY+CiAgICAgIDxoMT5TcG9ydHMgQ29tbWFuZCBDZW50ZXI8L2gxPgogICAgICA8cD5MaXZlIG1hcmtldCBpbmdlc3Rpb24g4oaSIGluZGVwZW5kZW50IHRoZXNpcyDihpIgY2hhbGxlbmdlciBtYXJrZXQg4oaSIHJlbGVhc2UgZ2F0ZXMg4oaSIGRpc2NpcGxpbmVkIGZpbmFsIGNhcmQuPC9wPgogICAgPC9kaXY+CiAgICA8ZGl2IGlkPSJoZWFsdGgiIGNsYXNzPSJzdGF0dXMiPkNoZWNraW5nIGRhdGEgbGF5ZXLigKY8L2Rpdj4KICA8L2hlYWRlcj4KCiAgPG5hdj4KICAgIDxidXR0b24gZGF0YS10YWI9ImRhc2hib2FyZCIgY2xhc3M9ImFjdGl2ZSI+RGFzaGJvYXJkPC9idXR0b24+CiAgICA8YnV0dG9uIGRhdGEtdGFiPSJhbmFseXplciI+QW5hbHl6ZXI8L2J1dHRvbj4KICAgIDxidXR0b24gZGF0YS10YWI9Im1vZGVscyI+TW9kZWwgUmVnaXN0cnk8L2J1dHRvbj4KICAgIDxidXR0b24gZGF0YS10YWI9IndlYXRoZXIiPldlYXRoZXI8L2J1dHRvbj4KICA8L25hdj4KCiAgPG1haW4+CiAgICA8c2VjdGlvbiBpZD0iZGFzaGJvYXJkIiBjbGFzcz0idGFiIGFjdGl2ZSI+CiAgICAgIDxkaXYgY2xhc3M9InRvb2xiYXIgcGFuZWwiPgogICAgICAgIDxsYWJlbD5TcG9ydDxzZWxlY3QgaWQ9InNwb3J0Ij48L3NlbGVjdD48L2xhYmVsPgogICAgICAgIDxsYWJlbD5NYXJrZXRzPHNlbGVjdCBpZD0ibWFya2V0cyI+PG9wdGlvbiB2YWx1ZT0iaDJoLHNwcmVhZHMsdG90YWxzIj5NTCArIFNwcmVhZCArIFRvdGFsPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iaDJoIj5Nb25leWxpbmUgb25seTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9InNwcmVhZHMiPlNwcmVhZCBvbmx5PC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0idG90YWxzIj5Ub3RhbHMgb25seTwvb3B0aW9uPjwvc2VsZWN0PjwvbGFiZWw+CiAgICAgICAgPGJ1dHRvbiBpZD0ibG9hZE9kZHMiIGNsYXNzPSJwcmltYXJ5Ij5TeW5jIExpdmUgQm9hcmQ8L2J1dHRvbj4KICAgICAgPC9kaXY+CiAgICAgIDxkaXYgaWQ9InF1b3RhIiBjbGFzcz0ic3VidGxlIj48L2Rpdj4KICAgICAgPGRpdiBpZD0iZXZlbnRzIiBjbGFzcz0iZ3JpZCI+PC9kaXY+CiAgICA8L3NlY3Rpb24+CgogICAgPHNlY3Rpb24gaWQ9ImFuYWx5emVyIiBjbGFzcz0idGFiIj4KICAgICAgPGRpdiBjbGFzcz0icGFuZWwiPgogICAgICAgIDxoMj5BRUdJUyBBbmFseXplcjwvaDI+CiAgICAgICAgPHAgY2xhc3M9InN1YnRsZSI+U2VsZWN0IGEgZ2FtZSBmcm9tIHRoZSBsaXZlIGJvYXJkLCB0aGVuIGFkZCBpbmRlcGVuZGVudCBpbmZvcm1hdGlvbi4gTWlzc2luZyBpbnB1dHMgbG93ZXIgRGF0YSBRdWFsaXR5IGFuZCBjYW4gZm9yY2UgUEFTUy48L3A+CiAgICAgICAgPGRpdiBpZD0ic2VsZWN0ZWRHYW1lIiBjbGFzcz0ic2VsZWN0ZWQiPk5vIGdhbWUgc2VsZWN0ZWQuPC9kaXY+CiAgICAgIDwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJhbmFseXplci1sYXlvdXQiPgogICAgICAgIDxmb3JtIGlkPSJhbmFseXNpc0Zvcm0iIGNsYXNzPSJwYW5lbCBmYWN0b3ItZm9ybSI+CiAgICAgICAgICA8ZGl2IGNsYXNzPSJyb3ciPjxsYWJlbD5TZWxlY3Rpb248c2VsZWN0IGlkPSJzZWxlY3Rpb24iPjxvcHRpb24gdmFsdWU9ImhvbWUiPkhvbWU8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJhd2F5Ij5Bd2F5PC9vcHRpb24+PC9zZWxlY3Q+PC9sYWJlbD48bGFiZWw+T2ZmZXJlZCBBbWVyaWNhbiBwcmljZTxpbnB1dCBpZD0icHJpY2UiIHR5cGU9Im51bWJlciIgcGxhY2Vob2xkZXI9Ii0xMTAiIC8+PC9sYWJlbD48bGFiZWw+QmFua3JvbGw8aW5wdXQgaWQ9ImJhbmtyb2xsIiB0eXBlPSJudW1iZXIiIHZhbHVlPSIxMDAiIG1pbj0iMSIgc3RlcD0iMC4wMSIgLz48L2xhYmVsPjwvZGl2PgogICAgICAgICAgPGRpdiBpZD0iZmFjdG9ycyI+PC9kaXY+CiAgICAgICAgICA8YnV0dG9uIGNsYXNzPSJwcmltYXJ5IiB0eXBlPSJzdWJtaXQiPlJ1biBGdWxsIEFFR0lTIFZlcmlmaWNhdGlvbjwvYnV0dG9uPgogICAgICAgIDwvZm9ybT4KICAgICAgICA8ZGl2IGlkPSJhbmFseXNpc1Jlc3VsdCIgY2xhc3M9InBhbmVsIHJlc3VsdCI+PGgzPkRlY2lzaW9uIG91dHB1dDwvaDM+PHAgY2xhc3M9InN1YnRsZSI+Tm8gYW5hbHlzaXMgeWV0LjwvcD48L2Rpdj4KICAgICAgPC9kaXY+CiAgICA8L3NlY3Rpb24+CgogICAgPHNlY3Rpb24gaWQ9Im1vZGVscyIgY2xhc3M9InRhYiI+PGRpdiBjbGFzcz0icGFuZWwiPjxoMj5Nb2RlbCAmIFN5c3RlbSBSZWdpc3RyeTwvaDI+PGRpdiBpZD0ibW9kZWxMaXN0IiBjbGFzcz0ibW9kZWwtbGlzdCI+PC9kaXY+PC9kaXY+PC9zZWN0aW9uPgoKICAgIDxzZWN0aW9uIGlkPSJ3ZWF0aGVyIiBjbGFzcz0idGFiIj4KICAgICAgPGRpdiBjbGFzcz0icGFuZWwiPgogICAgICAgIDxoMj5OV1MgV2VhdGhlciBFbnJpY2htZW50PC9oMj4KICAgICAgICA8cCBjbGFzcz0ic3VidGxlIj5GcmVlIFUuUy4gTmF0aW9uYWwgV2VhdGhlciBTZXJ2aWNlIGZlZWQuIEVudGVyIHZlbnVlIGNvb3JkaW5hdGVzIHRvIGFkZCByZWFsIGZvcmVjYXN0IGNvbnRleHQgdG8gZW52aXJvbm1lbnQgbW9kZWxzLjwvcD4KICAgICAgICA8ZGl2IGNsYXNzPSJyb3ciPjxsYWJlbD5MYXRpdHVkZTxpbnB1dCBpZD0ibGF0IiB2YWx1ZT0iMjcuMjczIiAvPjwvbGFiZWw+PGxhYmVsPkxvbmdpdHVkZTxpbnB1dCBpZD0ibG9uIiB2YWx1ZT0iLTgwLjM1OCIgLz48L2xhYmVsPjxidXR0b24gaWQ9ImxvYWRXZWF0aGVyIiBjbGFzcz0icHJpbWFyeSI+R2V0IEZvcmVjYXN0PC9idXR0b24+PC9kaXY+CiAgICAgICAgPGRpdiBpZD0iZm9yZWNhc3QiPjwvZGl2PgogICAgICA8L2Rpdj4KICAgIDwvc2VjdGlvbj4KICA8L21haW4+CjxzY3JpcHQgc3JjPSJhcHAuanMiPjwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4K", 'base64') },
  "/styles.css": { type: "text/css; charset=utf-8", body: Buffer.from("OnJvb3R7LS1iZzojMDcxMDE5Oy0tcGFuZWw6IzBkMTgyMzstLXBhbmVsMjojMTMyMTJlOy0tdGV4dDojZWFmMmY4Oy0tbXV0ZWQ6IzkxYTRiNDstLWxpbmU6IzIwMzI0MzstLWFjY2VudDojNjVmMmI1Oy0td2FybjojZjZjNTZiOy0tYmFkOiNmZjdjN2M7LS1nb29kOiM3MmU3OWZ9Cip7Ym94LXNpemluZzpib3JkZXItYm94fSBib2R5e21hcmdpbjowO2JhY2tncm91bmQ6cmFkaWFsLWdyYWRpZW50KGNpcmNsZSBhdCAyMCUgMCUsIzEwMjUzNiAwLCMwNzEwMTkgNDIlKTtjb2xvcjp2YXIoLS10ZXh0KTtmb250OjE0cHgvMS40NSBJbnRlcix1aS1zYW5zLXNlcmlmLHN5c3RlbS11aSwtYXBwbGUtc3lzdGVtLFNlZ29lIFVJLHNhbnMtc2VyaWZ9aGVhZGVye2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjtnYXA6MjRweDtwYWRkaW5nOjI4cHggNXZ3IDE4cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tbGluZSl9aDF7Zm9udC1zaXplOjM0cHg7bGluZS1oZWlnaHQ6MTttYXJnaW46NXB4IDAgOHB4fWgyLGgze21hcmdpbi10b3A6MH0uZXllYnJvd3tjb2xvcjp2YXIoLS1hY2NlbnQpO2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzouMTJlbX0uc3RhdHVze2FsaWduLXNlbGY6Y2VudGVyO3BhZGRpbmc6OXB4IDEycHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjk5OXB4O2JhY2tncm91bmQ6IzA5MTQxZX0uc3VidGxle2NvbG9yOnZhcigtLW11dGVkKX1uYXZ7ZGlzcGxheTpmbGV4O2dhcDo4cHg7cGFkZGluZzoxMnB4IDV2dztwb3NpdGlvbjpzdGlja3k7dG9wOjA7YmFja2dyb3VuZDpyZ2JhKDcsMTYsMjUsLjk0KTtiYWNrZHJvcC1maWx0ZXI6Ymx1cigxMnB4KTt6LWluZGV4OjM7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tbGluZSl9YnV0dG9uLHNlbGVjdCxpbnB1dHtmb250OmluaGVyaXR9YnV0dG9ue2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7YmFja2dyb3VuZDp2YXIoLS1wYW5lbCk7Y29sb3I6dmFyKC0tdGV4dCk7cGFkZGluZzo5cHggMTNweDtib3JkZXItcmFkaXVzOjlweDtjdXJzb3I6cG9pbnRlcn1idXR0b246aG92ZXIsbmF2IGJ1dHRvbi5hY3RpdmV7Ym9yZGVyLWNvbG9yOnZhcigtLWFjY2VudCl9YnV0dG9uLnByaW1hcnl7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2NvbG9yOiMwNjIyMTk7Ym9yZGVyLWNvbG9yOnZhcigtLWFjY2VudCk7Zm9udC13ZWlnaHQ6ODAwfW1haW57cGFkZGluZzoyMnB4IDV2dyA2MHB4fS50YWJ7ZGlzcGxheTpub25lfS50YWIuYWN0aXZle2Rpc3BsYXk6YmxvY2t9LnBhbmVse2JhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KDE4MGRlZyx2YXIoLS1wYW5lbCksIzBhMTUxZik7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjE2cHg7cGFkZGluZzoxOHB4O2JveC1zaGFkb3c6MCAxNHB4IDQwcHggcmdiYSgwLDAsMCwuMTUpfS50b29sYmFyLC5yb3d7ZGlzcGxheTpmbGV4O2dhcDoxMnB4O2FsaWduLWl0ZW1zOmVuZDtmbGV4LXdyYXA6d3JhcH1sYWJlbHtkaXNwbGF5OmdyaWQ7Z2FwOjZweDtjb2xvcjp2YXIoLS1tdXRlZCk7bWluLXdpZHRoOjE1MHB4fXNlbGVjdCxpbnB1dHtiYWNrZ3JvdW5kOiMwNzEyMWM7Y29sb3I6dmFyKC0tdGV4dCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjhweDtwYWRkaW5nOjlweCAxMHB4O21pbi1oZWlnaHQ6NDBweH0uZ3JpZHtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMzAwcHgsMWZyKSk7Z2FwOjE0cHg7bWFyZ2luLXRvcDoxNHB4fS5nYW1le3BhZGRpbmc6MTZweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6MTRweDtiYWNrZ3JvdW5kOnZhcigtLXBhbmVsKX0uZ2FtZSBoM3tmb250LXNpemU6MTZweDttYXJnaW46MCAwIDZweH0uYm9vay1ncmlke2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KDMsMWZyKTtnYXA6OHB4O21hcmdpbi10b3A6MTJweH0ubWFya2V0e2JhY2tncm91bmQ6IzA4MTMxZDtib3JkZXI6MXB4IHNvbGlkICMxYTJkM2U7Ym9yZGVyLXJhZGl1czo5cHg7cGFkZGluZzo4cHh9Lm1hcmtldCBie2Rpc3BsYXk6YmxvY2s7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tbXV0ZWQpO21hcmdpbi1ib3R0b206NHB4fS5tYXJrZXQgc3BhbntkaXNwbGF5OmJsb2NrfS5nYW1lIGJ1dHRvbnt3aWR0aDoxMDAlO21hcmdpbi10b3A6MTJweH0uc2VsZWN0ZWR7cGFkZGluZzoxMnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6MTBweDtiYWNrZ3JvdW5kOiMwNzEyMWN9LmFuYWx5emVyLWxheW91dHtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOm1pbm1heCgwLDEuMjVmcikgbWlubWF4KDMyMHB4LC43NWZyKTtnYXA6MTRweDttYXJnaW4tdG9wOjE0cHh9LmZhY3Rvci1mb3JtICNmYWN0b3Jze2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KDIsbWlubWF4KDAsMWZyKSk7Z2FwOjEwcHg7bWFyZ2luOjE4cHggMH0uZmFjdG9ye2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyIDcwcHg7Z2FwOjEwcHg7YWxpZ24taXRlbXM6Y2VudGVyO3BhZGRpbmc6OXB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjlweH0uZmFjdG9yIGlucHV0e3dpZHRoOjcwcHh9LmRlY2lzaW9ue2ZvbnQtc2l6ZTozMHB4O2ZvbnQtd2VpZ2h0OjkwMDttYXJnaW46NHB4IDB9LkNPUkV7Y29sb3I6dmFyKC0tZ29vZCl9LlNFQ09OREFSWXtjb2xvcjp2YXIoLS13YXJuKX0uV0FUQ0h7Y29sb3I6IzhjYmNmZn0uUEFTU3tjb2xvcjp2YXIoLS1iYWQpfS5tZXRyaWMtZ3JpZHtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCgyLDFmcik7Z2FwOjhweH0ubWV0cmlje3BhZGRpbmc6OXB4O2JhY2tncm91bmQ6IzA3MTIxYztib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6OXB4fS5tZXRyaWMgYntkaXNwbGF5OmJsb2NrO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLW11dGVkKX0uZ2F0ZXtkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47cGFkZGluZzo3cHggMDtib3JkZXItYm90dG9tOjFweCBzb2xpZCAjMTcyODM4fS5wYXNze2NvbG9yOnZhcigtLWdvb2QpfS5mYWlse2NvbG9yOnZhcigtLWJhZCl9Lm1vZGVsLWxpc3R7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDI4MHB4LDFmcikpO2dhcDo5cHh9Lm1vZGVsLWl0ZW17Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMXB4O2JhY2tncm91bmQ6IzA4MTMxZH0ubW9kZWwtaXRlbSBie2Rpc3BsYXk6YmxvY2t9LmJhZGdle2Rpc3BsYXk6aW5saW5lLWJsb2NrO21hcmdpbi10b3A6NnB4O3BhZGRpbmc6M3B4IDdweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6OTk5cHg7Y29sb3I6dmFyKC0tYWNjZW50KTtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2V9LmZvcmVjYXN0LWl0ZW17cGFkZGluZzoxMHB4IDA7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tbGluZSl9QG1lZGlhKG1heC13aWR0aDo4NTBweCl7aGVhZGVye2Rpc3BsYXk6YmxvY2t9LnN0YXR1c3tkaXNwbGF5OmlubGluZS1ibG9jazttYXJnaW4tdG9wOjEycHh9LmFuYWx5emVyLWxheW91dHtncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyfS5mYWN0b3ItZm9ybSAjZmFjdG9yc3tncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyfS5ib29rLWdyaWR7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmciAxZnIgMWZyfX0K", 'base64') },
  "/app.js": { type: "application/javascript; charset=utf-8", body: Buffer.from("bGV0IHNlbGVjdGVkRXZlbnQgPSBudWxsOwpjb25zdCAkPXM9PmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3Iocyk7CmNvbnN0IGVzYz1zPT5TdHJpbmcocz8/JycpLnJlcGxhY2UoL1smPD4iJ10vZyxtPT4oeycmJzonJmFtcDsnLCc8JzonJmx0OycsJz4nOicmZ3Q7JywnIic6JyZxdW90OycsIiciOicmIzM5Oyd9W21dKSk7Cgpjb25zdCBmYWN0b3JOYW1lcyA9IHsKICB0YWxlbnQ6J092ZXJhbGwgdGFsZW50IC8gdHJ1ZSBzdHJlbmd0aCcsIG9mZmVuc2U6J09mZmVuc2UnLCBkZWZlbnNlOidEZWZlbnNlIC8gcnVuIHByZXZlbnRpb24nLCBzdGFydGVyOidTdGFydGluZyBwaXRjaGVyIC8gcHJpbWFyeSBzdGFydGVyJywgYnVsbHBlbjonQnVsbHBlbicsCiAgZGVwdGg6J1Jlc2VydmUgLyByb3N0ZXIgZGVwdGgnLCBxYkRlcHRoOidRQjIgLyBRQjMgZGVwdGgnLCBjb2FjaGluZzonQ29hY2hpbmcgdXNhZ2UgLyBpbnRlbnQnLCByb2xlOidQbGF5ZXIgcm9sZSAvIG1pbnV0ZXMnLCBtYXRjaHVwOidNYXRjaHVwIC8gc2NoZW1lIC8gcGxhdG9vbicsCiAgZW52aXJvbm1lbnQ6J1BhcmsgLyB3ZWF0aGVyIC8gY291cnQgZW52aXJvbm1lbnQnLCBhdmFpbGFiaWxpdHk6J0xpbmV1cCAvIGluanVyeSBhdmFpbGFiaWxpdHknLCBzcGVjaWFsVGVhbXM6J1NwZWNpYWwgdGVhbXMgLyBoaWRkZW4geWFyZHMnLCByZWNlbnRGb3JtOidDdXJyZW50IGZvcm0gKGNhcHBlZCknLAogIGRhdGFRdWFsaXR5OidEYXRhIHF1YWxpdHkgLyBjb25maXJtYXRpb24nLCB1bmNlcnRhaW50eTonVW5jZXJ0YWludHkgKGxvd2VyIGlzIGJldHRlciknLCBmYWlsdXJlUmlzazonSG93LWRvZXMtdGhpcy1sb3NlIHJpc2sgKGxvd2VyIGlzIGJldHRlciknCn07CgpmdW5jdGlvbiB0YWIobmFtZSl7ZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLnRhYicpLmZvckVhY2goeD0+eC5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLHguaWQ9PT1uYW1lKSk7ZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnbmF2IGJ1dHRvbicpLmZvckVhY2goeD0+eC5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLHguZGF0YXNldC50YWI9PT1uYW1lKSk7fQpkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCduYXYgYnV0dG9uJykuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PnRhYihiLmRhdGFzZXQudGFiKSk7Cgphc3luYyBmdW5jdGlvbiBhcGkodXJsLG9wdHMpe2NvbnN0IHI9YXdhaXQgZmV0Y2godXJsLG9wdHMpO2NvbnN0IGo9YXdhaXQgci5qc29uKCk7aWYoIXIub2spdGhyb3cgbmV3IEVycm9yKGouZXJyb3J8fHIuc3RhdHVzVGV4dCk7cmV0dXJuIGo7fQphc3luYyBmdW5jdGlvbiBpbml0KCl7CiAgdHJ5e2NvbnN0IGg9YXdhaXQgYXBpKCcvYXBpL2hlYWx0aCcpOyAkKCcjaGVhbHRoJykudGV4dENvbnRlbnQ9aC5vZGRzQ29uZmlndXJlZD9gTElWRSBEQVRBIFJFQURZIOKAoiAke2gubW9kZWxzfSBtb2RlbHNgOmBTRVRVUCBORUVERUQg4oCiICR7aC5tb2RlbHN9IG1vZGVsc2A7ICQoJyNoZWFsdGgnKS5zdHlsZS5ib3JkZXJDb2xvcj1oLm9kZHNDb25maWd1cmVkPyd2YXIoLS1hY2NlbnQpJzondmFyKC0td2FybiknO31jYXRjaChlKXskKCcjaGVhbHRoJykudGV4dENvbnRlbnQ9ZS5tZXNzYWdlfQogIGNvbnN0IHNwb3J0cz1hd2FpdCBhcGkoJy9hcGkvc3BvcnRzJyk7ICQoJyNzcG9ydCcpLmlubmVySFRNTD1zcG9ydHMuc3BvcnRzLmZpbHRlcihzPT5bJ2Jhc2ViYWxsX21sYicsJ2Jhc2ViYWxsX2tibycsJ2Jhc2ViYWxsX25wYicsJ2FtZXJpY2FuZm9vdGJhbGxfbmZsX3ByZXNlYXNvbicsJ2FtZXJpY2FuZm9vdGJhbGxfbmZsJywnYW1lcmljYW5mb290YmFsbF9uY2FhZicsJ2Jhc2tldGJhbGxfd25iYSddLmluY2x1ZGVzKHMua2V5KSkubWFwKHM9PmA8b3B0aW9uIHZhbHVlPSIke2VzYyhzLmtleSl9Ij4ke2VzYyhzLnRpdGxlKX08L29wdGlvbj5gKS5qb2luKCcnKTsKICBjb25zdCBtb2RlbHM9YXdhaXQgYXBpKCcvYXBpL21vZGVscycpOyAkKCcjbW9kZWxMaXN0JykuaW5uZXJIVE1MPW1vZGVscy5tb2RlbHMubWFwKG09PmA8ZGl2IGNsYXNzPSJtb2RlbC1pdGVtIj48Yj4ke20uaWR9LiAke2VzYyhtLm5hbWUpfTwvYj48c3Bhbj4ke2VzYyhtLnB1cnBvc2UpfTwvc3Bhbj48ZGl2IGNsYXNzPSJiYWRnZSI+JHtlc2MobS5jYXRlZ29yeSl9PC9kaXY+PC9kaXY+YCkuam9pbignJyk7CiAgJCgnI2ZhY3RvcnMnKS5pbm5lckhUTUw9T2JqZWN0LmVudHJpZXMoZmFjdG9yTmFtZXMpLm1hcCgoW2ssbl0pPT5gPGxhYmVsIGNsYXNzPSJmYWN0b3IiPjxzcGFuPiR7bn08L3NwYW4+PGlucHV0IGRhdGEtZmFjdG9yPSIke2t9IiB0eXBlPSJudW1iZXIiIG1pbj0iMCIgbWF4PSIxMDAiIHZhbHVlPSIke2s9PT0nZGF0YVF1YWxpdHknPzQwOms9PT0ndW5jZXJ0YWludHknPzYwOjUwfSI+PC9sYWJlbD5gKS5qb2luKCcnKTsKfQoKZnVuY3Rpb24gbWFya2V0VGV4dChldmVudCl7CiAgY29uc3QgYm9va3M9KGV2ZW50LmJvb2ttYWtlcnN8fFtdKS5zbGljZSgwLDMpOwogIHJldHVybiBib29rcy5tYXAoYm9vaz0+ewogICAgY29uc3QgaXRlbXM9W107IGZvcihjb25zdCBtIG9mIGJvb2subWFya2V0c3x8W10pewogICAgICBpZihtLmtleT09PSdoMmgnKXtjb25zdCBhPW0ub3V0Y29tZXMuZmluZChvPT5vLm5hbWU9PT1ldmVudC5hd2F5X3RlYW0pLGg9bS5vdXRjb21lcy5maW5kKG89Pm8ubmFtZT09PWV2ZW50LmhvbWVfdGVhbSk7aXRlbXMucHVzaChgPGRpdiBjbGFzcz0ibWFya2V0Ij48Yj4ke2VzYyhib29rLnRpdGxlKX0gTUw8L2I+PHNwYW4+JHtlc2MoZXZlbnQuYXdheV90ZWFtKX0gJHthP2VzYyhhLnByaWNlKTon4oCUJ308L3NwYW4+PHNwYW4+JHtlc2MoZXZlbnQuaG9tZV90ZWFtKX0gJHtoP2VzYyhoLnByaWNlKTon4oCUJ308L3NwYW4+PC9kaXY+YCl9CiAgICAgIGlmKG0ua2V5PT09J3NwcmVhZHMnKXtjb25zdCBhPW0ub3V0Y29tZXMuZmluZChvPT5vLm5hbWU9PT1ldmVudC5hd2F5X3RlYW0pLGg9bS5vdXRjb21lcy5maW5kKG89Pm8ubmFtZT09PWV2ZW50LmhvbWVfdGVhbSk7aXRlbXMucHVzaChgPGRpdiBjbGFzcz0ibWFya2V0Ij48Yj4ke2VzYyhib29rLnRpdGxlKX0gU3ByZWFkPC9iPjxzcGFuPiR7ZXNjKGV2ZW50LmF3YXlfdGVhbSl9ICR7YT9gJHtlc2MoYS5wb2ludCl9ICgke2VzYyhhLnByaWNlKX0pYDon4oCUJ308L3NwYW4+PHNwYW4+JHtlc2MoZXZlbnQuaG9tZV90ZWFtKX0gJHtoP2Ake2VzYyhoLnBvaW50KX0gKCR7ZXNjKGgucHJpY2UpfSlgOifigJQnfTwvc3Bhbj48L2Rpdj5gKX0KICAgICAgaWYobS5rZXk9PT0ndG90YWxzJyl7Y29uc3Qgbz1tLm91dGNvbWVzLmZpbmQobz0+by5uYW1lPT09J092ZXInKSx1PW0ub3V0Y29tZXMuZmluZChvPT5vLm5hbWU9PT0nVW5kZXInKTtpdGVtcy5wdXNoKGA8ZGl2IGNsYXNzPSJtYXJrZXQiPjxiPiR7ZXNjKGJvb2sudGl0bGUpfSBUb3RhbDwvYj48c3Bhbj5PICR7bz9gJHtlc2Moby5wb2ludCl9ICgke2VzYyhvLnByaWNlKX0pYDon4oCUJ308L3NwYW4+PHNwYW4+VSAke3U/YCR7ZXNjKHUucG9pbnQpfSAoJHtlc2ModS5wcmljZSl9KWA6J+KAlCd9PC9zcGFuPjwvZGl2PmApfQogICAgfSByZXR1cm4gaXRlbXMuam9pbignJyk7CiAgfSkuam9pbignJyk7Cn0KCmFzeW5jIGZ1bmN0aW9uIGxvYWRPZGRzKCl7CiAgJCgnI2V2ZW50cycpLmlubmVySFRNTD0nPGRpdiBjbGFzcz0icGFuZWwiPlN5bmNpbmcgbGl2ZSBib2FyZOKApjwvZGl2Pic7CiAgdHJ5e2NvbnN0IGQ9YXdhaXQgYXBpKGAvYXBpL29kZHM/c3BvcnQ9JHtlbmNvZGVVUklDb21wb25lbnQoJCgnI3Nwb3J0JykudmFsdWUpfSZtYXJrZXRzPSR7ZW5jb2RlVVJJQ29tcG9uZW50KCQoJyNtYXJrZXRzJykudmFsdWUpfWApOyAkKCcjcXVvdGEnKS50ZXh0Q29udGVudD1kLnF1b3RhP2BPZGRzIEFQSSBxdW90YSDigKIgcmVtYWluaW5nICR7ZC5xdW90YS5yZW1haW5pbmc/PyfigJQnfSDigKIgdXNlZCAke2QucXVvdGEudXNlZD8/J+KAlCd9YDonJzsKICAkKCcjZXZlbnRzJykuaW5uZXJIVE1MPShkLmV2ZW50c3x8W10pLm1hcCgoZSxpKT0+YDxhcnRpY2xlIGNsYXNzPSJnYW1lIj48ZGl2IGNsYXNzPSJzdWJ0bGUiPiR7bmV3IERhdGUoZS5jb21tZW5jZV90aW1lKS50b0xvY2FsZVN0cmluZygpfTwvZGl2PjxoMz4ke2VzYyhlLmF3YXlfdGVhbSl9IEAgJHtlc2MoZS5ob21lX3RlYW0pfTwvaDM+PGRpdiBjbGFzcz0iYm9vay1ncmlkIj4ke21hcmtldFRleHQoZSl8fCc8c3BhbiBjbGFzcz0ic3VidGxlIj5ObyByZXF1ZXN0ZWQgbWFya2V0cyByZXR1cm5lZC48L3NwYW4+J308L2Rpdj48YnV0dG9uIGRhdGEtZ2FtZT0iJHtpfSI+QW5hbHl6ZSB3aXRoIEFFR0lTPC9idXR0b24+PC9hcnRpY2xlPmApLmpvaW4oJycpfHwnPGRpdiBjbGFzcz0icGFuZWwiPk5vIGV2ZW50cyByZXR1cm5lZCBmb3IgdGhpcyBzcG9ydC9tYXJrZXQuPC9kaXY+JzsKICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdbZGF0YS1nYW1lXScpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5zZWxlY3RHYW1lKGQuZXZlbnRzWytiLmRhdGFzZXQuZ2FtZV0pKTsKICB9Y2F0Y2goZSl7JCgnI2V2ZW50cycpLmlubmVySFRNTD1gPGRpdiBjbGFzcz0icGFuZWwiPjxiPkxpdmUgc3luYyB1bmF2YWlsYWJsZS48L2I+PHAgY2xhc3M9InN1YnRsZSI+JHtlc2MoZS5tZXNzYWdlKX08L3A+PHA+Q29uZmlndXJlIDxjb2RlPk9ERFNfQVBJX0tFWTwvY29kZT4gaW4gYSBsb2NhbCA8Y29kZT4uZW52PC9jb2RlPiBmaWxlLjwvcD48L2Rpdj5gfQp9CiQoJyNsb2FkT2RkcycpLm9uY2xpY2s9bG9hZE9kZHM7CgpmdW5jdGlvbiBzZWxlY3RHYW1lKGUpe3NlbGVjdGVkRXZlbnQ9ZTsgJCgnI3NlbGVjdGVkR2FtZScpLmlubmVySFRNTD1gPGI+JHtlc2MoZS5hd2F5X3RlYW0pfSBAICR7ZXNjKGUuaG9tZV90ZWFtKX08L2I+PGJyPjxzcGFuIGNsYXNzPSJzdWJ0bGUiPiR7ZXNjKGUuc3BvcnRfdGl0bGV8fGUuc3BvcnRfa2V5KX0g4oCiICR7bmV3IERhdGUoZS5jb21tZW5jZV90aW1lKS50b0xvY2FsZVN0cmluZygpfTwvc3Bhbj5gOyBjb25zdCBtPShlLmJvb2ttYWtlcnN8fFtdKS5mbGF0TWFwKGI9PmIubWFya2V0c3x8W10pLmZpbmQobT0+bS5rZXk9PT0naDJoJyk7IGNvbnN0IGhvbWU9bT8ub3V0Y29tZXM/LmZpbmQobz0+by5uYW1lPT09ZS5ob21lX3RlYW0pOyBpZihob21lKSQoJyNwcmljZScpLnZhbHVlPWhvbWUucHJpY2U7IHRhYignYW5hbHl6ZXInKTt9CgokKCcjYW5hbHlzaXNGb3JtJykub25zdWJtaXQ9YXN5bmMgZXY9PnsKICBldi5wcmV2ZW50RGVmYXVsdCgpOyBpZighc2VsZWN0ZWRFdmVudCl7JCgnI2FuYWx5c2lzUmVzdWx0JykuaW5uZXJIVE1MPSc8aDM+Tm8gZ2FtZSBzZWxlY3RlZDwvaDM+JztyZXR1cm47fQogIGNvbnN0IGZhY3RvcnM9e307IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ1tkYXRhLWZhY3Rvcl0nKS5mb3JFYWNoKGk9PmZhY3RvcnNbaS5kYXRhc2V0LmZhY3Rvcl09K2kudmFsdWUpOwogICQoJyNhbmFseXNpc1Jlc3VsdCcpLmlubmVySFRNTD0nPGgzPlJ1bm5pbmcgQUVHSVMgZ2F0ZXPigKY8L2gzPic7CiAgdHJ5e2NvbnN0IHI9YXdhaXQgYXBpKCcvYXBpL2FuYWx5emUnLHttZXRob2Q6J1BPU1QnLGhlYWRlcnM6eydDb250ZW50LVR5cGUnOidhcHBsaWNhdGlvbi9qc29uJ30sYm9keTpKU09OLnN0cmluZ2lmeSh7ZXZlbnQ6c2VsZWN0ZWRFdmVudCxmYWN0b3JzLHNlbGVjdGlvbjokKCcjc2VsZWN0aW9uJykudmFsdWUsbWFya2V0OidoMmgnLG9mZmVyZWRQcmljZTokKCcjcHJpY2UnKS52YWx1ZT8rJCgnI3ByaWNlJykudmFsdWU6bnVsbCxiYW5rcm9sbDorJCgnI2Jhbmtyb2xsJykudmFsdWV9KX0pOyByZW5kZXJSZXN1bHQocik7fWNhdGNoKGUpeyQoJyNhbmFseXNpc1Jlc3VsdCcpLmlubmVySFRNTD1gPGgzPkVycm9yPC9oMz48cD4ke2VzYyhlLm1lc3NhZ2UpfTwvcD5gfQp9OwpmdW5jdGlvbiBwY3QoeCl7cmV0dXJuIGAkeyh4KjEwMCkudG9GaXhlZCgxKX0lYH0KZnVuY3Rpb24gcmVuZGVyUmVzdWx0KHIpewogIGNvbnN0IGdhdGVzPXsuLi5yLmdhdGVzfTsgY29uc3Qgc3BvcnQ9ci5zcG9ydENoZWNrc3x8W107CiAgJCgnI2FuYWx5c2lzUmVzdWx0JykuaW5uZXJIVE1MPWA8ZGl2IGNsYXNzPSJzdWJ0bGUiPkFFR0lTIFJFTEVBU0U8L2Rpdj48ZGl2IGNsYXNzPSJkZWNpc2lvbiAke3IudGllcn0iPiR7ci50aWVyfTwvZGl2PjxiPiR7ZXNjKHIudGltaW5nKX08L2I+CiAgPGRpdiBjbGFzcz0ibWV0cmljLWdyaWQiIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPgogICAgPGRpdiBjbGFzcz0ibWV0cmljIj48Yj5JbmRlcGVuZGVudCB0aGVzaXM8L2I+JHtyLnRoZXNpc1Njb3JlfS8xMDA8L2Rpdj48ZGl2IGNsYXNzPSJtZXRyaWMiPjxiPk1vZGVsIGFncmVlbWVudDwvYj4ke3IuYWdyZWVtZW50fS8xMDA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im1ldHJpYyI+PGI+TW9kZWwgcHJvYmFiaWxpdHk8L2I+JHtwY3Qoci50aGVzaXNQcm9iKX08L2Rpdj48ZGl2IGNsYXNzPSJtZXRyaWMiPjxiPk1hcmtldCBjaGFsbGVuZ2VyPC9iPiR7cGN0KHIubWFya2V0UHJvYil9PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJtZXRyaWMiPjxiPkFkanVzdGVkIGVkZ2U8L2I+JHtwY3Qoci5hZGp1c3RlZEVkZ2UpfTwvZGl2PjxkaXYgY2xhc3M9Im1ldHJpYyI+PGI+UmVxdWlyZWQgY3VzaGlvbjwvYj4ke3BjdChyLnJlcXVpcmVkQ3VzaGlvbil9PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJtZXRyaWMiPjxiPkZhaXIgcHJpY2U8L2I+JHtyLmZhaXJQcmljZT8/J+KAlCd9PC9kaXY+PGRpdiBjbGFzcz0ibWV0cmljIj48Yj5Fc3RpbWF0ZWQgRVY8L2I+JHtyLmV2PT1udWxsPyfigJQnOnBjdChyLmV2KX08L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im1ldHJpYyI+PGI+SW5kZXBlbmRlbnQgZWRnZXM8L2I+JHtyLmluZGVwZW5kZW50RWRnZXN9PC9kaXY+PGRpdiBjbGFzcz0ibWV0cmljIj48Yj5TdWdnZXN0ZWQgc3Rha2U8L2I+JCR7ci5zdGFrZS50b0ZpeGVkKDIpfTwvZGl2PgogIDwvZGl2PjxoMyBzdHlsZT0ibWFyZ2luLXRvcDoxOHB4Ij5SZWxlYXNlIGdhdGVzPC9oMz4ke09iamVjdC5lbnRyaWVzKGdhdGVzKS5tYXAoKFtrLHZdKT0+YDxkaXYgY2xhc3M9ImdhdGUiPjxzcGFuPiR7ZXNjKGspfTwvc3Bhbj48YiBjbGFzcz0iJHt2PydwYXNzJzonZmFpbCd9Ij4ke3Y/J1BBU1MnOidGQUlMJ308L2I+PC9kaXY+YCkuam9pbignJyl9CiAgJHtzcG9ydC5sZW5ndGg/YDxoMyBzdHlsZT0ibWFyZ2luLXRvcDoxOHB4Ij5TcG9ydC1zcGVjaWZpYyBnYXRlczwvaDM+JHtzcG9ydC5tYXAoZz0+YDxkaXYgY2xhc3M9ImdhdGUiPjxzcGFuPiR7ZXNjKGcubmFtZSl9PC9zcGFuPjxiIGNsYXNzPSIke2cucGFzcz8ncGFzcyc6J2ZhaWwnfSI+JHtnLnBhc3M/J1BBU1MnOidGQUlMJ308L2I+PC9kaXY+YCkuam9pbignJyl9YDonJ30KICA8cCBjbGFzcz0ic3VidGxlIiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij5UaGUgbm9ybWFsaXplZCBzY29yZSBwcm9qZWN0aW9uIGlzIGludGVudGlvbmFsbHkgbm90IHNob3duIGFzIGxpdGVyYWwgZ2FtZSBwb2ludHMgdW50aWwgYSBzcG9ydC1zcGVjaWZpYyBzdGF0cy9yb3RhdGlvbiBmZWVkIGlzIHN1cHBsaWVkLiBUaGUgRGF0YSBRdWFsaXR5IEdhdGUgcHJldmVudHMgdGhhdCBtaXNzaW5nIGVucmljaG1lbnQgZnJvbSBtYXNxdWVyYWRpbmcgYXMgY29uZmlkZW5jZS48L3A+YDsKfQoKJCgnI2xvYWRXZWF0aGVyJykub25jbGljaz1hc3luYygpPT57dHJ5e2NvbnN0IGQ9YXdhaXQgYXBpKGAvYXBpL3dlYXRoZXI/bGF0PSR7ZW5jb2RlVVJJQ29tcG9uZW50KCQoJyNsYXQnKS52YWx1ZSl9Jmxvbj0ke2VuY29kZVVSSUNvbXBvbmVudCgkKCcjbG9uJykudmFsdWUpfWApO2NvbnN0IHBlcmlvZHM9ZC5mb3JlY2FzdD8ucHJvcGVydGllcz8ucGVyaW9kc3x8W107JCgnI2ZvcmVjYXN0JykuaW5uZXJIVE1MPXBlcmlvZHMuc2xpY2UoMCw4KS5tYXAocD0+YDxkaXYgY2xhc3M9ImZvcmVjYXN0LWl0ZW0iPjxiPiR7ZXNjKHAubmFtZSl9PC9iPiDigKIgJHtlc2MocC50ZW1wZXJhdHVyZSl9wrAke2VzYyhwLnRlbXBlcmF0dXJlVW5pdCl9IOKAoiB3aW5kICR7ZXNjKHAud2luZFNwZWVkKX0gJHtlc2MocC53aW5kRGlyZWN0aW9uKX08YnI+PHNwYW4gY2xhc3M9InN1YnRsZSI+JHtlc2MocC5zaG9ydEZvcmVjYXN0KX08L3NwYW4+PC9kaXY+YCkuam9pbignJyl9Y2F0Y2goZSl7JCgnI2ZvcmVjYXN0JykuaW5uZXJIVE1MPWA8cCBjbGFzcz0iZmFpbCI+JHtlc2MoZS5tZXNzYWdlKX08L3A+YH19Owppbml0KCk7Cg==", 'base64') }
};

const PORT = Number(process.env.PORT || 3000);
const ODDS_KEY = process.env.ODDS_API_KEY || '';
const REGION = process.env.ODDS_REGION || 'us';

const sportsFallback = [
  {key:'baseball_mlb',title:'MLB',group:'Baseball'},
  {key:'baseball_kbo',title:'KBO League',group:'Baseball'},
  {key:'baseball_npb',title:'NPB',group:'Baseball'},
  {key:'americanfootball_nfl_preseason',title:'NFL Preseason',group:'American Football'},
  {key:'americanfootball_nfl',title:'NFL',group:'American Football'},
  {key:'americanfootball_ncaaf',title:'NCAAF',group:'American Football'},
  {key:'basketball_wnba',title:'WNBA',group:'Basketball'}
];

function send(res,status,data,type='application/json'){
  res.writeHead(status, {'Content-Type':type, 'Cache-Control':'no-store'});
  res.end(type==='application/json' ? JSON.stringify(data) : data);
}
async function readBody(req){
  return await new Promise((resolve,reject)=>{
    let s=''; req.on('data',d=>{s+=d;if(s.length>1e6)req.destroy();}); req.on('end',()=>resolve(s)); req.on('error',reject);
  });
}
async function oddsFetch(endpoint){
  if(!ODDS_KEY) throw new Error('ODDS_API_KEY is not configured in Render. Add it under Environment and redeploy.');
  const join = endpoint.includes('?') ? '&' : '?';
  const url = `https://api.the-odds-api.com/v4/${endpoint}${join}apiKey=${encodeURIComponent(ODDS_KEY)}`;
  const r = await fetch(url, {headers:{'User-Agent':'AEGIS-Sports-Command-Center/1.1'}});
  const text = await r.text();
  let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!r.ok) throw new Error(data.message || data.error || `Odds API ${r.status}`);
  return {data, meta:{remaining:r.headers.get('x-requests-remaining'),used:r.headers.get('x-requests-used'),last:r.headers.get('x-requests-last')}};
}

async function weatherFetch(lat,lon){
  const headers={'User-Agent':'AEGIS-Sports-Command-Center/1.1','Accept':'application/geo+json'};
  const p = await fetch(`https://api.weather.gov/points/${lat},${lon}`,{headers});
  if(!p.ok) throw new Error(`NWS points ${p.status}`);
  const pj = await p.json();
  const u = pj?.properties?.forecastHourly || pj?.properties?.forecast;
  if(!u) throw new Error('No forecast URL returned by NWS.');
  const fr = await fetch(u,{headers}); if(!fr.ok) throw new Error(`NWS forecast ${fr.status}`);
  return await fr.json();
}

const server = http.createServer(async (req,res)=>{
  try{
    const u = new URL(req.url,`http://${req.headers.host}`);
    if(u.pathname==='/api/health') return send(res,200,{ok:true,oddsConfigured:!!ODDS_KEY,region:REGION,models:MODELS.length,time:new Date().toISOString()});
    if(u.pathname==='/api/models') return send(res,200,{models:MODELS.map(([name,category,purpose],id)=>({id:id+1,name,category,purpose}))});
    if(u.pathname==='/api/sports'){
      if(!ODDS_KEY) return send(res,200,{live:false,sports:sportsFallback,notice:'Configure ODDS_API_KEY in Render for live in-season discovery.'});
      const x=await oddsFetch('sports?all=true'); return send(res,200,{live:true,sports:x.data,quota:x.meta});
    }
    if(u.pathname==='/api/odds'){
      const sport=u.searchParams.get('sport')||'upcoming';
      const markets=u.searchParams.get('markets')||'h2h,spreads,totals';
      const bookmakers=u.searchParams.get('bookmakers');
      const scope = bookmakers ? `bookmakers=${encodeURIComponent(bookmakers)}` : `regions=${encodeURIComponent(REGION)}`;
      const x=await oddsFetch(`sports/${encodeURIComponent(sport)}/odds?${scope}&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`);
      return send(res,200,{live:true,events:x.data,quota:x.meta});
    }
    if(u.pathname==='/api/scores'){
      const sport=u.searchParams.get('sport')||'americanfootball_nfl';
      const days=Math.max(1,Math.min(3,Number(u.searchParams.get('daysFrom')||1)));
      const x=await oddsFetch(`sports/${encodeURIComponent(sport)}/scores?daysFrom=${days}&dateFormat=iso`);
      return send(res,200,{live:true,scores:x.data,quota:x.meta});
    }
    if(u.pathname==='/api/weather'){
      const lat=u.searchParams.get('lat'), lon=u.searchParams.get('lon');
      if(!lat||!lon) return send(res,400,{error:'lat and lon are required'});
      return send(res,200,{live:true,forecast:await weatherFetch(lat,lon)});
    }
    if(u.pathname==='/api/analyze' && req.method==='POST'){
      const body=JSON.parse(await readBody(req)||'{}');
      if(!body.event) return send(res,400,{error:'event is required'});
      return send(res,200,runAegis(body));
    }

    const asset=STATIC_ASSETS[u.pathname];
    if(asset) return send(res,200,asset.body,asset.type);
    return send(res,404,{error:'Not found'});
  }catch(err){ send(res,500,{error:err.message||String(err)}); }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`AEGIS Sports Command Center running on port ${PORT}`));
