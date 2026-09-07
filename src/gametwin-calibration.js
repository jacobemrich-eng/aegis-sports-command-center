'use strict';

const audit=require('./gametwin-audit');
const results=require('./gametwin-results');
const storeLib=require('./gametwin-audit-store');

const VERSION='0.4.0-calibration-runner';

function createCalibrationRunner(options={}){
  const store=options.store||storeLib.createMemoryAuditStore(),resultsClient=options.resultsClient||results.createResultsClient(options),quotesProvider=options.quotesProvider||(async()=>[]),closingQuotesProvider=options.closingQuotesProvider||(async()=>[]),aegisForecastProvider=options.aegisForecastProvider||null;
  async function record({spec,projection,quotes=null,book=null,metadata={}}){const q=quotes||await quotesProvider(spec.gamePk,spec,projection),aegis=aegisForecastProvider?await aegisForecastProvider(spec.gamePk,spec,projection,q):null,snapshot=audit.createSnapshot({spec,projection,quotes:q,aegisForecasts:aegis,book,metadata});await store.save(snapshot);return snapshot;}
  async function grade(snapshot){const result=await resultsClient.finalResult(snapshot.gamePk);if(!result.final)return audit.gradeSnapshot(snapshot,result);const close=await closingQuotesProvider(snapshot.gamePk,snapshot,result),graded=audit.gradeSnapshot(snapshot,result,{closingQuotes:close||[]});await store.update(graded);return graded;}
  async function gradeAll(){const rows=await store.list(),out=[];for(const row of rows){if(row?.grade?.status==='FINAL'){out.push(row);continue;}out.push(await grade(row));}return out;}
  async function report(){return audit.summarizeAudit(await store.list());}
  return {VERSION,store,record,grade,gradeAll,report};
}

module.exports={VERSION,createCalibrationRunner};
