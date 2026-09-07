'use strict';

const audit=require('./gametwin-audit');
const broadcast=require('./gametwin-broadcast');
const market=require('./gametwin-market');
const viewmodel=require('./gametwin-viewmodel');

const VERSION='1.7.0-dashboard-service';
const FAMILY_LABELS={moneyline:'Moneyline',run_line:'Run Line',total:'Totals',pitcher_prop:'Pitcher Props',batter_prop:'Batter Props'};

function pct(x){return Number.isFinite(Number(x))?Math.round(Number(x)*1000)/10:null;}
function compactFamily(name,row={}){return {family:name,label:FAMILY_LABELS[name]||name,n:row.n||0,binary_n:row.binary_n||0,brier:row.brier??null,aegis_brier:row.aegis_brier??null,closing_market_brier:row.closing_market_brier??null,roi:row.roi??null,avg_devig_clv_probability:row.avg_devig_clv_probability??null,wins:row.wins||0,losses:row.losses||0,pushes:row.pushes||0};}
function familyFilteredSnapshots(rows,family){
  return (rows||[]).map(s=>{
    if(s?.grade?.status!=='FINAL')return null;
    const forecasts=(s.grade.forecasts||[]).filter(r=>r.family===family);
    if(!forecasts.length)return null;
    return {...s,grade:{...s.grade,forecasts}};
  }).filter(Boolean);
}
function gameCard(row){
  if(!row)return null;
  return {gamePk:row.gamePk,status:row.status,away:row.away,home:row.home,venue:row.venue,weather:row.weather,simulations:row.simulations,projected_score:row.projected_score,win_probability:row.win_probability,fair_moneyline:row.fair_moneyline,markets:row.markets,top_hr:row.top_hr,pitcher_projections:row.pitcher_projections,data_quality:row.data_quality,audit_snapshot_id:row.audit_snapshot_id,integration:row.integration,representative_game:row.representative_game||null,broadcast_context:row.broadcast_context||null};
}

function latestModelComparison(card,snapshots=[]){
  const latest=(snapshots||[])[0];
  if(!card||!latest)return {available:false,source:'no_matched_snapshot'};
  const rows=(latest.forecasts||[]).filter(r=>r.family==='moneyline'&&r.quote);
  function side(name){
    const r=rows.find(x=>market.sameName(x.quote?.selection,name));if(!r)return null;
    const gt=Number(r.fair_probability),ag=Number(r.aegis_probability),mk=Number(r.market_devig_probability??r.book_implied_probability);
    return {selection:name,gametwin:Number.isFinite(gt)?gt:null,aegis:Number.isFinite(ag)?ag:null,market:Number.isFinite(mk)?mk:null,price:Number.isFinite(Number(r.quote?.price))?Number(r.quote.price):null,book:r.quote?.book||null};
  }
  let home=side(card.home),away=side(card.away);
  const complement=x=>x==null?null:Math.max(0,Math.min(1,1-x));
  if(home&&!away)away={selection:card.away,gametwin:complement(home.gametwin),aegis:complement(home.aegis),market:complement(home.market),price:null,book:home.book};
  if(away&&!home)home={selection:card.home,gametwin:complement(away.gametwin),aegis:complement(away.aegis),market:complement(away.market),price:null,book:away.book};
  const available=!!(home||away)&&[home,away].filter(Boolean).some(x=>Number.isFinite(x.gametwin)&&Number.isFinite(x.aegis));
  return {available,source:'latest_matched_pregame_moneyline',snapshot_id:latest.snapshot_id||null,captured_at:latest.captured_at||null,book:home?.book||away?.book||null,away,home};
}
function createDashboardService(options={}){
  const runtime=options.runtime;
  if(!runtime?.auditStore||!runtime?.stateStore)throw new Error('GameTwin dashboard requires production runtime');
  async function calibration(family=null){
    const rows=await runtime.auditStore.list();
    const report=family?audit.summarizeAudit(familyFilteredSnapshots(rows,family)):audit.summarizeAudit(rows);
    const families=Object.entries(report.by_family||{}).map(([name,row])=>compactFamily(name,row)).sort((a,b)=>b.binary_n-a.binary_n);
    return {...report,family:family||'all',families,integration:{mode:'shadow',aegis_weight:0,release_eligible:false,automatic_weight_changes:false}};
  }
  async function status(){
    const [st,cal,slate,pilot]=await Promise.all([runtime.stateStore.status(),calibration(),runtime.stateStore.latestSlate(),runtime.pilot?.status?runtime.pilot.status():Promise.resolve(null)]);
    const runtimeState=String(st.runtime?.state||'IDLE').toUpperCase();
    const operationalHealth=pilot?.health==='RED'||runtimeState==='DEGRADED'?'RED':pilot?.health==='PAUSED'?'PAUSED':pilot?.health==='YELLOW'?'YELLOW':pilot?.health==='COLLECTING'?'COLLECTING':'GREEN';
    return {version:VERSION,model_version:runtime.VERSION,mode:'shadow',aegis_weight:0,release_eligible:false,operational_health:operationalHealth,pilot,visual_broadcast:{version:broadcast.VERSION,presentation_only:true,cameras:['auto','broadcast','batter','pitcher','stadium','ball','base']},runtime:st.runtime,latest_slate:slate?{date:slate.date,summary:slate.summary,saved_at:slate.saved_at,card_version:slate.meta?.card_version||slate.production?.card_version||null}:null,calibration:{final_games:cal.final_games,forecasts:cal.forecasts,overall:cal.overall,comparisons:cal.comparisons,score_mae:cal.score_mae,governance:cal.governance},errors:st.errors||[]};
  }
  async function slate(date=null){const row=await runtime.stateStore.latestSlate(date);if(!row)return {date:date||null,games:[],summary:{total:0,ready:0,provisional:0,errors:0},integration:{mode:'shadow',aegis_weight:0,release_eligible:false}};return {...row,games:(row.games||[]).map(gameCard)};}
  async function game(gamePk){
    const row=await runtime.stateStore.game(gamePk),snapshots=(await runtime.auditStore.list()).filter(s=>Number(s.gamePk)===Number(gamePk)).sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at));
    const card=gameCard(row),comparison=latestModelComparison(card,snapshots);if(card)card.model_comparison=comparison;const visual=card?broadcast.buildBroadcast(card):null,view_model=card?viewmodel.buildGameViewModel(card,visual,snapshots):null;return {game:card,broadcast:visual,view_model,model_comparison:comparison,snapshots:snapshots.map(s=>({snapshot_id:s.snapshot_id,captured_at:s.captured_at,book:s.book,teams:s.teams,projection:s.projection,forecasts:s.forecasts,grade:s.grade||null,integration:s.integration,metadata:s.metadata})),integration:{mode:'shadow',aegis_weight:0,release_eligible:false}};
  }
  async function overview(){
    const [st,sl,cal]=await Promise.all([status(),slate(),calibration()]);
    return {status:st,slate:sl,calibration:cal};
  }
  async function operations(){const s=await status();return {version:VERSION,mode:'shadow',aegis_weight:0,release_eligible:false,health:s.operational_health,pilot:s.pilot,runtime:s.runtime,latest_slate:s.latest_slate,errors:s.errors};}
  return {VERSION,status,slate,game,calibration,overview,operations};
}

module.exports={VERSION,FAMILY_LABELS,pct,compactFamily,familyFilteredSnapshots,gameCard,latestModelComparison,createDashboardService};
