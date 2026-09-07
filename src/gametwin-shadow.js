'use strict';

const gt = require('./gametwin');
const data = require('./gametwin-data');
const broadcast = require('./gametwin-broadcast');

const VERSION='0.6.0-production-shadow';

function topHitters(players={},limit=5){
  return Object.entries(players).map(([name,p])=>({name,...p})).sort((a,b)=>(b.HR_probability||0)-(a.HR_probability||0)).slice(0,limit);
}
function projectionSummary(spec,projection){
  return {
    gamePk:spec.gamePk,
    date:spec.date,
    away:spec.away.name,
    home:spec.home.name,
    venue:spec.venue?.name||null,
    weather:spec.environment,
    simulations:projection.simulations,
    projected_score:projection.projected_score,
    win_probability:projection.win_probability,
    fair_moneyline:projection.fair_moneyline,
    markets:projection.markets,
    top_hr:{away:topHitters(projection.players.away),home:topHitters(projection.players.home)},
    pitcher_projections:projection.pitchers,
    matchup_intelligence:spec.matchup_intelligence||null,
    representative_game:projection.representative_game,
    broadcast_context:broadcast.compactContext(spec),
    data_quality:spec.data_quality,
    integration:{aegis_weight:0,release_eligible:false,mode:'shadow'}
  };
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length||1)},()=>worker()));return out;
}
function createShadowScanner(options={}){
  const client=options.client||data.createDataClient(options),calibrationRunner=options.calibrationRunner||null;
  async function scanGame(gamePk,scanOptions={}){
    try{
      const spec=await client.buildGameSpec(gamePk);
      if(!spec.lineups_confirmed||!spec.probable_starters_confirmed){
        return {gamePk:Number(gamePk),status:'PROVISIONAL',reason:!spec.lineups_confirmed?'confirmed lineups unavailable':'probable starters unresolved',spec,data_quality:spec.data_quality,integration:{aegis_weight:0,release_eligible:false,mode:'shadow'}};
      }
      const projection=gt.runSimulations(spec,{simulations:scanOptions.simulations||25000,seed:scanOptions.seed||`gametwin|${gamePk}|${String(spec.date).slice(0,10)}`});
      let auditSnapshot=null;
      if(calibrationRunner){
        auditSnapshot=await calibrationRunner.record({spec,projection,book:scanOptions.book||null,metadata:{scan_date:String(spec.date).slice(0,10),source:'gametwin-shadow-scan',...(scanOptions.metadata||{})}});
      }
      return {status:'READY',...projectionSummary(spec,projection),audit_snapshot_id:auditSnapshot?.snapshot_id||null,audit_recorded:!!auditSnapshot};
    }catch(error){return {gamePk:Number(gamePk),status:'ERROR',error:error.message,integration:{aegis_weight:0,release_eligible:false,mode:'shadow'}};}
  }
  async function scanDate(date,scanOptions={}){
    const games=await client.slate(date),limit=Math.max(1,Math.min(6,Number(scanOptions.concurrency||3)));
    const rows=await mapLimit(games,limit,g=>scanGame(g.gamePk,scanOptions));
    const ready=rows.filter(r=>r.status==='READY').length,provisional=rows.filter(r=>r.status==='PROVISIONAL').length,errors=rows.filter(r=>r.status==='ERROR').length,auditRecorded=rows.filter(r=>r.audit_recorded).length;
    return {version:VERSION,date:String(date).slice(0,10),games:rows,summary:{total:rows.length,ready,provisional,errors,audit_recorded:auditRecorded},integration:{aegis_weight:0,release_eligible:false,mode:'shadow',reason:'Daily shadow scan only; production AEGIS release engine remains authoritative.'}};
  }
  return {VERSION,scanGame,scanDate};
}

module.exports={VERSION,topHitters,projectionSummary,mapLimit,createShadowScanner};
