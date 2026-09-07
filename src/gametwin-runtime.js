'use strict';

const crypto=require('crypto');
const shadow=require('./gametwin-shadow');
const calibrationLib=require('./gametwin-calibration');
const auditStoreLib=require('./gametwin-audit-store');
const bridge=require('./gametwin-aegis-bridge');
const stateLib=require('./gametwin-state');
const market=require('./gametwin-market');
const pilotLib=require('./gametwin-pilot');

const VERSION='1.0.0-production-shadow-runtime';

function hash(text){return crypto.createHash('sha256').update(String(text||'')).digest('hex').slice(0,24);}
function etDate(iso=new Date().toISOString()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso)).reduce((o,x)=>(o[x.type]=x.value,o),{});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function mlbCard(card){return !!(card?.analyses||[]).some(a=>a?.event?.sport_key==='baseball_mlb');}
function sourceMarketFromQuote(q){const m=String(q.market||'').toLowerCase();if(['moneyline','ml','h2h'].includes(m))return 'h2h';if(['run_line','runline','spread','spreads'].includes(m))return 'spreads';if(['total','totals','game_total'].includes(m))return 'totals';return null;}
function closingQuotesFromAuditRows(rows,snapshot){
  const out=[];
  for(const qForecast of snapshot?.forecasts||[]){
    const q=qForecast.quote;if(!q)continue;const source=sourceMarketFromQuote(q);if(!source)continue;
    const candidates=(rows||[]).filter(r=>r.sport_key==='baseball_mlb'&&market.sameName(r.away_team,snapshot.teams?.away)&&market.sameName(r.home_team,snapshot.teams?.home)&&String(r.market||'').toLowerCase()===source&&market.sameName(r.selection,q.selection)&&Number(r.point??0)===Number(q.point??0));
    if(!candidates.length)continue;
    let best=null;
    for(const r of candidates){
      const snaps=Array.isArray(r.snapshots)?r.snapshots:[];
      for(const s of snaps){const t=Date.parse(s.at||0)||0,start=Date.parse(r.commence_time||snapshot.game_date||0)||Infinity;if(t>start)continue;if(!best||t>best.t)best={t,price:Number(s.price),book:s.book||r.book};}
      if(!best&&Number.isFinite(Number(r.price)))best={t:Date.parse(r.last_seen_at||0)||0,price:Number(r.price),book:r.book};
    }
    if(best&&Number.isFinite(best.price))out.push({...q,price:best.price,book:best.book||q.book||null,source:'aegis-closing-history'});
  }
  return out;
}
function createClosingQuotesProvider(aegisStore){return async(_gamePk,snapshot)=>{const s=await aegisStore.load();return closingQuotesFromAuditRows(s.audit||[],snapshot);};}

function createProductionShadowRuntime(options={}){
  const aegisStore=options.aegisStore;
  if(!aegisStore||typeof aegisStore.load!=='function'||typeof aegisStore.mutate!=='function')throw new Error('GameTwin production runtime requires existing AEGIS store');
  const auditStore=options.auditStore||auditStoreLib.createAegisStateAuditStore(aegisStore,{cap:options.auditCap||1200});
  const stateStore=options.stateStore||stateLib.createGameTwinStateStore(aegisStore);
  const closingQuotesProvider=options.closingQuotesProvider||createClosingQuotesProvider(aegisStore);
  const resultsClient=options.resultsClient||null;
  const simulations=Math.max(100,Math.min(100000,Number(options.simulations||process.env.GAMETWIN_SIMULATIONS||25000)));
  const concurrency=Math.max(1,Math.min(6,Number(options.concurrency||process.env.GAMETWIN_CONCURRENCY||3)));
  const targetBookKey=options.targetBookKey||'hardrockbet_fl';
  const gradeIntervalMs=Math.max(5*60000,Number(options.gradeIntervalMs||60*60000));
  const pilot=options.pilot||pilotLib.createPilotController({aegisStore,...(options.pilotOptions||{})});
  let queue=Promise.resolve(),lastQueuedFingerprint=null;

  async function canonicalRecord(runner,payload){
    const existing=(await auditStore.list()).filter(x=>Number(x.gamePk)===Number(payload.spec.gamePk)&&x.metadata?.production_shadow===true).sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at))[0];
    if(existing)return existing;
    return runner.record({...payload,metadata:{...(payload.metadata||{}),production_shadow:true,canonical_for_calibration:true,checkpoint:'confirmed-lineup-shadow'}});
  }
  function makeCalibration(card){
    const providers=bridge.providersFromCard(card,{targetBookKey});
    const base=calibrationLib.createCalibrationRunner({store:auditStore,resultsClient:resultsClient||undefined,closingQuotesProvider,quotesProvider:providers.quotesProvider,aegisForecastProvider:providers.aegisForecastProvider});
    return {...base,record:payload=>canonicalRecord(base,payload)};
  }
  async function maybeGrade(force=false){
    const st=await stateStore.status(),last=Date.parse(st.runtime?.last_grade_at||0)||0;if(!force&&Date.now()-last<gradeIntervalMs)return {skipped:true,reason:'grade interval'};
    const runner=calibrationLib.createCalibrationRunner({store:auditStore,resultsClient:resultsClient||undefined,closingQuotesProvider});
    const graded=await runner.gradeAll(),report=await runner.report();
    await stateStore.runtimePatch({last_grade_at:new Date().toISOString(),last_grade_count:graded.filter(x=>x?.grade?.status==='FINAL').length,last_calibration_summary:{final_games:report.final_games,forecasts:report.forecasts,governance:report.governance}});
    return {skipped:false,graded:graded.length,report};
  }
  async function processCard(card,runOptions={}){
    if(!mlbCard(card))return {skipped:true,reason:'not MLB card'};
    const gate=await pilot.gate();
    if(!runOptions.forcePilot&&gate.allowed===false)return {skipped:true,reason:gate.reason,pilot:gate.status,shadow_only:true,aegis_weight:0,release_eligible:false};
    const fingerprint=hash(bridge.cardFingerprint(card));
    const status=await stateStore.status();
    if(!runOptions.force&&status.runtime?.last_card_fingerprint===fingerprint){await maybeGrade(false);return {skipped:true,reason:'card already processed; grading checked',fingerprint};}
    await pilot.markStarted({fingerprint,card_version:card?.version||null});
    await stateStore.runtimePatch({state:'RUNNING',last_started_at:new Date().toISOString(),last_card_fingerprint_pending:fingerprint,mode:'shadow',aegis_weight:0,release_eligible:false});
    try{
      await maybeGrade(false);
      const first=(card.analyses||[]).find(a=>a?.event?.sport_key==='baseball_mlb'),date=runOptions.date||etDate(first?.event?.commence_time||card.generated_at);
      const calibration=makeCalibration(card),scanner=shadow.createShadowScanner({client:options.dataClient,calibrationRunner:calibration});
      const report=await scanner.scanDate(date,{simulations:runOptions.simulations||simulations,concurrency:runOptions.concurrency||concurrency,book:runOptions.book||'Hard Rock Bet',metadata:{production_shadow:true,card_version:card.version,card_generated_at:card.generated_at}});
      if((report.summary?.total||0)>0&&(report.summary?.ready||0)===0&&(report.summary?.errors||0)===report.summary.total)throw new Error('GameTwin shadow slate failed for every MLB game');
      report.production={version:VERSION,card_version:card.version||null,card_generated_at:card.generated_at||null,card_fingerprint:fingerprint,shadow_only:true,aegis_weight:0,release_eligible:false};
      await stateStore.saveSlate(report,{card_version:card.version||null,card_generated_at:card.generated_at||null,card_fingerprint:fingerprint});
      await stateStore.runtimePatch({state:'IDLE',last_success_at:new Date().toISOString(),last_card_fingerprint:fingerprint,last_card_fingerprint_pending:null,last_error:null});
      report.pilot=await pilot.recordSuccess({fingerprint,date,ready:report.summary?.ready||0,errors:report.summary?.errors||0});
      return report;
    }catch(error){await stateStore.recordError(error,{phase:'process-card',card_version:card?.version,card_generated_at:card?.generated_at});await stateStore.runtimePatch({state:'DEGRADED',last_card_fingerprint_pending:null});const pilotStatus=await pilot.recordFailure(error,{phase:'process-card',fingerprint});return {error:error.message,pilot:pilotStatus,shadow_only:true,aegis_weight:0,release_eligible:false};}
  }
  function queueCard(card,runOptions={}){
    if(!mlbCard(card))return {queued:false,reason:'not MLB card'};
    const fp=hash(bridge.cardFingerprint(card));
    if(!runOptions.force&&fp===lastQueuedFingerprint)return {queued:false,reason:'already queued',fingerprint:fp};
    lastQueuedFingerprint=fp;
    queue=queue.catch(()=>{}).then(()=>processCard(card,runOptions)).catch(async error=>{await stateStore.recordError(error,{phase:'queue'});return {error:error.message};});
    return {queued:true,fingerprint:fp,mode:'shadow',aegis_weight:0,release_eligible:false};
  }
  async function drain(){return queue;}
  async function gradeNow(){try{return await maybeGrade(true);}catch(error){await stateStore.recordError(error,{phase:'grade'});return {error:error.message};}}
  return {VERSION,simulations,concurrency,auditStore,stateStore,pilot,queueCard,processCard,drain,gradeNow,closingQuotesProvider};
}

module.exports={VERSION,hash,etDate,mlbCard,sourceMarketFromQuote,closingQuotesFromAuditRows,createClosingQuotesProvider,createProductionShadowRuntime};
