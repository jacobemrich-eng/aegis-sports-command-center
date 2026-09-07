'use strict';

const VERSION='0.6.0-state';

function ensureGameTwin(state){
  state.gametwin=state.gametwin&&typeof state.gametwin==='object'?state.gametwin:{};
  const g=state.gametwin;
  g.runtime=g.runtime&&typeof g.runtime==='object'?g.runtime:{};
  g.latest_slates=g.latest_slates&&typeof g.latest_slates==='object'?g.latest_slates:{};
  g.latest_games=g.latest_games&&typeof g.latest_games==='object'?g.latest_games:{};
  g.errors=Array.isArray(g.errors)?g.errors:[];
  return g;
}
function compactGame(row){
  if(!row)return row;
  if(row.status!=='READY')return row;
  return {
    gamePk:row.gamePk,date:row.date,away:row.away,home:row.home,venue:row.venue,weather:row.weather,
    simulations:row.simulations,projected_score:row.projected_score,win_probability:row.win_probability,
    fair_moneyline:row.fair_moneyline,markets:row.markets,top_hr:row.top_hr,pitcher_projections:row.pitcher_projections,
    matchup_intelligence:row.matchup_intelligence,data_quality:row.data_quality,audit_snapshot_id:row.audit_snapshot_id,
    audit_recorded:row.audit_recorded,integration:row.integration,broadcast_context:row.broadcast_context||null,
    representative_game:row.representative_game?{final:row.representative_game.final,innings:row.representative_game.innings,play_by_play:row.representative_game.play_by_play}:null
  };
}
function createGameTwinStateStore(aegisStore,options={}){
  if(!aegisStore||typeof aegisStore.load!=='function'||typeof aegisStore.mutate!=='function')throw new Error('GameTwin state store requires AEGIS load/mutate');
  const errorCap=Math.max(10,Math.min(250,Number(options.errorCap||80)));
  async function saveSlate(report,meta={}){
    await aegisStore.mutate(state=>{const g=ensureGameTwin(state),date=String(report.date||meta.date||'').slice(0,10);g.latest_slates[date]={...report,games:(report.games||[]).map(compactGame),saved_at:new Date().toISOString(),meta};for(const row of report.games||[])if(row.gamePk)g.latest_games[String(row.gamePk)]=compactGame(row);const slateKeys=Object.keys(g.latest_slates).sort();while(slateKeys.length>14)delete g.latest_slates[slateKeys.shift()];const gameKeys=Object.keys(g.latest_games);while(gameKeys.length>60)delete g.latest_games[gameKeys.shift()];g.runtime.last_scan_at=new Date().toISOString();g.runtime.last_scan_date=date;g.runtime.last_scan_summary=report.summary||null;g.runtime.last_error=null;g.updated_at=new Date().toISOString();return date;});return report;
  }
  async function runtimePatch(patch){await aegisStore.mutate(state=>{const g=ensureGameTwin(state);Object.assign(g.runtime,patch,{updated_at:new Date().toISOString()});g.updated_at=new Date().toISOString();});}
  async function recordError(error,meta={}){const row={at:new Date().toISOString(),message:error?.message||String(error),meta};await aegisStore.mutate(state=>{const g=ensureGameTwin(state);g.errors.push(row);g.errors=g.errors.slice(-errorCap);g.runtime.last_error=row.message;g.runtime.last_error_at=row.at;g.updated_at=row.at;});return row;}
  async function latestSlate(date=null){const s=await aegisStore.load(),g=ensureGameTwin(s);if(date)return g.latest_slates[String(date).slice(0,10)]||null;const keys=Object.keys(g.latest_slates).sort();return keys.length?g.latest_slates[keys[keys.length-1]]:null;}
  async function game(gamePk){const s=await aegisStore.load(),g=ensureGameTwin(s);return g.latest_games[String(gamePk)]||null;}
  async function status(){const s=await aegisStore.load(),g=ensureGameTwin(s);return {version:VERSION,mode:'shadow',aegis_weight:0,release_eligible:false,runtime:g.runtime||{},updated_at:g.updated_at||null,errors:(g.errors||[]).slice(-8)};}
  return {VERSION,saveSlate,runtimePatch,recordError,latestSlate,game,status};
}

module.exports={VERSION,ensureGameTwin,compactGame,createGameTwinStateStore};
