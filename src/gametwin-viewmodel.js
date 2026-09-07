'use strict';

const VERSION='1.7.0-watch-analyze-viewmodel';

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp01(v){const n=finite(v);return n==null?null:Math.max(0,Math.min(1,n));}
function sideKey(x){return String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function sameSide(a,b){const x=sideKey(a),y=sideKey(b);return !!x&&!!y&&(x===y||x.includes(y)||y.includes(x));}
function cleanComparisonRow(row,expected){
  if(!row||!sameSide(row.selection,expected))return null;
  return {selection:expected,gametwin:clamp01(row.gametwin),aegis:clamp01(row.aegis),market:clamp01(row.market),price:finite(row.price),book:row.book||null};
}
function normalizedComparison(card={}){
  const c=card.model_comparison||{};
  const away=cleanComparisonRow(c.away,card.away),home=cleanComparisonRow(c.home,card.home);
  const available=!!c.available&&!!(away||home)&&[away,home].filter(Boolean).some(r=>r.gametwin!=null&&r.aegis!=null&&r.market!=null);
  return {available,market:'moneyline',book:c.book||away?.book||home?.book||null,captured_at:c.captured_at||null,away,home,source:c.source||null};
}
function signFromHalf(p){const n=finite(p);return n==null?null:n>=.5?1:-1;}
function disagreementStatus(comparison={}){
  if(!comparison.available)return {status:'COLLECTING',label:'Matched market comparison pending',severity:'neutral'};
  const focus=(comparison.away?.gametwin??0)>=.5?comparison.away:comparison.home;
  if(!focus)return {status:'COLLECTING',label:'Matched market comparison pending',severity:'neutral'};
  const gt=signFromHalf(focus.gametwin),ag=signFromHalf(focus.aegis),mk=signFromHalf(focus.market);
  if([gt,ag,mk].some(x=>x==null))return {status:'PARTIAL',label:'Partial matched comparison',severity:'neutral'};
  if(gt===ag&&ag===mk)return {status:'ALL_AGREE',label:'All agree',severity:'good',selection:focus.selection};
  if(gt===ag)return {status:'GT_AEGIS_VS_MARKET',label:'GameTwin + AEGIS vs Market',severity:'info',selection:focus.selection};
  if(gt===mk)return {status:'GT_MARKET_VS_AEGIS',label:'GameTwin + Market vs AEGIS',severity:'warn',selection:focus.selection};
  if(ag===mk)return {status:'AEGIS_MARKET_VS_GT',label:'AEGIS + Market vs GameTwin',severity:'warn',selection:focus.selection};
  return {status:'THREE_WAY_CONFLICT',label:'Three-way conflict',severity:'bad',selection:focus.selection};
}
function pitcherCard(row,side){if(!row)return null;return {side,name:row.name||`${side} starter`,ip:finite(row.IP),outs:finite(row.outs??row.outs_mean),k:finite(row.K??row.K_mean),bb:finite(row.BB??row.BB_mean),h:finite(row.H??row.H_mean),hr:finite(row.HR??row.HR_mean),er:finite(row.ER??row.ER_mean),pitches:finite(row.pitches??row.pitch_count),probabilities:row.probabilities||{}};}
function hitterLeaders(rows=[]){return rows.slice(0,5).map(x=>({name:x.name||x.player||'',hr_probability:clamp01(x.HR_probability??x.hr_probability),hit_probability:clamp01(x.hit_1_plus),tb_over_1_5:clamp01(x.TB_over_1_5)}));}
function shadowMarketRows(card,comparison){
  const rows=[];
  if(comparison?.away)rows.push({family:'moneyline',market:'ML',selection:card.away,line:null,gametwin:comparison.away.gametwin,aegis:comparison.away.aegis,market_probability:comparison.away.market,price:comparison.away.price,book:comparison.away.book,status:'SHADOW'});
  if(comparison?.home)rows.push({family:'moneyline',market:'ML',selection:card.home,line:null,gametwin:comparison.home.gametwin,aegis:comparison.home.aegis,market_probability:comparison.home.market,price:comparison.home.price,book:comparison.home.book,status:'SHADOW'});
  const m=card.markets||{};
  if(finite(m.away_minus_1_5)!=null)rows.push({family:'run_line',market:'RL',selection:card.away,line:-1.5,gametwin:clamp01(m.away_minus_1_5),aegis:null,market_probability:null,price:null,book:null,status:'SHADOW'});
  if(finite(m.home_minus_1_5)!=null)rows.push({family:'run_line',market:'RL',selection:card.home,line:-1.5,gametwin:clamp01(m.home_minus_1_5),aegis:null,market_probability:null,price:null,book:null,status:'SHADOW'});
  if(finite(m.over_8_5)!=null)rows.push({family:'total',market:'TOTAL',selection:'OVER',line:8.5,gametwin:clamp01(m.over_8_5),aegis:null,market_probability:null,price:null,book:null,status:'SHADOW'});
  if(finite(m.under_8_5)!=null)rows.push({family:'total',market:'TOTAL',selection:'UNDER',line:8.5,gametwin:clamp01(m.under_8_5),aegis:null,market_probability:null,price:null,book:null,status:'SHADOW'});
  return rows;
}
function buildGameViewModel(card={},broadcast=null,snapshots=[]){
  const comparison=normalizedComparison(card),disagreement=disagreementStatus(comparison),ctx=card.broadcast_context||broadcast||{};
  const environment={venue:card.venue||ctx.venue?.name||null,field:ctx.venue?.field||broadcast?.venue?.field||null,timezone:ctx.venue?.timezone||broadcast?.venue?.timezone||null,weather:{temperature_f:finite(card.weather?.temperature_f),wind_mph:finite(card.weather?.wind_mph),wind_direction_deg:finite(card.weather?.wind_direction_deg),precipitation_probability:finite(card.weather?.precipitation_probability),run_factor:finite(card.weather?.run_factor),verified:card.weather?.verified===true}};
  return {
    version:VERSION,
    game:{gamePk:card.gamePk||null,date:card.date||null,away:card.away||null,home:card.home||null,status:card.status||null,simulations:finite(card.simulations)||0},
    watch:{teams:{away:card.away||broadcast?.teams?.away||null,home:card.home||broadcast?.teams?.home||null},pregame_win_probability:{away:clamp01(card.win_probability?.away),home:clamp01(card.win_probability?.home)},representative_final:card.representative_game?.final||broadcast?.final||null,venue:environment.venue,weather:environment.weather,rosters:broadcast?.rosters||ctx?{away:ctx.away||broadcast?.rosters?.away||null,home:ctx.home||broadcast?.rosters?.home||null}:null,capabilities:broadcast?.capabilities||null},
    analyze:{projection:{score:{away:finite(card.projected_score?.away),home:finite(card.projected_score?.home),total:finite(card.projected_score?.total)},win_probability:{away:clamp01(card.win_probability?.away),home:clamp01(card.win_probability?.home)},fair_moneyline:card.fair_moneyline||null},model_comparison:comparison,disagreement,pitchers:[pitcherCard(card.pitcher_projections?.away,'away'),pitcherCard(card.pitcher_projections?.home,'home')].filter(Boolean),hitters:{away:hitterLeaders(card.top_hr?.away||[]),home:hitterLeaders(card.top_hr?.home||[])},environment,market_rows:shadowMarketRows(card,comparison),snapshots:{count:snapshots.length,last_captured_at:snapshots[0]?.captured_at||null}},
    governance:{mode:'shadow',aegis_weight:0,release_eligible:false,automatic_weight_changes:false,note:'GameTwin is an independent shadow model and cannot promote, size, parlay or release a bet.'}
  };
}

module.exports={VERSION,finite,clamp01,sameSide,normalizedComparison,disagreementStatus,pitcherCard,hitterLeaders,shadowMarketRows,buildGameViewModel};
