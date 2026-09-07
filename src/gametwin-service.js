'use strict';

const storeLib=require('./gametwin-audit-store');
const runtimeLib=require('./gametwin-runtime');
const dashboardLib=require('./gametwin-dashboard');
const apiLib=require('./gametwin-api');

const VERSION='1.0.0-service';

function createGameTwinService({aegisStore,...options}={}){
  if(!aegisStore)throw new Error('GameTwin service requires existing AEGIS store');
  const auditStore=options.auditStore||storeLib.createAegisStateAuditStore(aegisStore,{cap:options.auditCap||1200});
  const runtime=runtimeLib.createProductionShadowRuntime({aegisStore,auditStore,...options});
  const dashboard=dashboardLib.createDashboardService({runtime});
  const api=apiLib.createGameTwinApi({runtime,dashboard,aegisStore});
  return {VERSION,runtime,dashboard,api,pilot:runtime.pilot,queueAegisCard:(card,opts)=>runtime.queueCard(card,opts),grade:()=>runtime.gradeNow()};
}

module.exports={VERSION,createGameTwinService};
