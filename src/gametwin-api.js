'use strict';

const VERSION='1.0.0-api';

function json(status,body){return {handled:true,status,body};}
function parseGamePk(path){const m=String(path||'').match(/^\/api\/gametwin\/game\/(\d+)$/);return m?Number(m[1]):null;}
function parseFamily(path){const m=String(path||'').match(/^\/api\/gametwin\/calibration\/([a-z_]+)$/i);return m?m[1].toLowerCase():null;}
function createGameTwinApi(options={}){
  const runtime=options.runtime,dashboard=options.dashboard,aegisStore=options.aegisStore;
  if(!runtime||!dashboard||!aegisStore)throw new Error('GameTwin API requires runtime, dashboard and AEGIS store');
  async function route(req,u){
    const method=String(req?.method||'GET').toUpperCase(),path=u?.pathname||'';
    if(!path.startsWith('/api/gametwin/'))return {handled:false};
    try{
      if(method==='GET'&&path==='/api/gametwin/status')return json(200,await dashboard.status());
      if(method==='GET'&&path==='/api/gametwin/overview')return json(200,await dashboard.overview());
      if(method==='GET'&&path==='/api/gametwin/operations')return json(200,await dashboard.operations());
      if(method==='GET'&&path==='/api/gametwin/slate')return json(200,await dashboard.slate(u.searchParams?.get('date')||null));
      const gamePk=parseGamePk(path);if(method==='GET'&&gamePk)return json(200,await dashboard.game(gamePk));
      if(method==='GET'&&path==='/api/gametwin/calibration')return json(200,await dashboard.calibration());
      const family=parseFamily(path);if(method==='GET'&&family)return json(200,await dashboard.calibration(family));
      if(method==='POST'&&path==='/api/gametwin/grade')return json(200,await runtime.gradeNow());
      if(method==='POST'&&path==='/api/gametwin/pilot/pause')return json(200,{ok:true,pilot:await runtime.pilot.setEnabled(false)});
      if(method==='POST'&&path==='/api/gametwin/pilot/resume')return json(200,{ok:true,pilot:await runtime.pilot.setEnabled(true)});
      if(method==='POST'&&path==='/api/gametwin/pilot/reset')return json(200,{ok:true,pilot:await runtime.pilot.resetCircuit()});
      if(method==='POST'&&path==='/api/gametwin/scan'){
        const state=await aegisStore.load(),card=state.latest_cards?.baseball_mlb;
        if(!card)return json(409,{ok:false,error:'No saved MLB AEGIS card is available for shadow scanning.'});
        const date=u.searchParams?.get('date')||null,result=await runtime.processCard(card,{force:true,date});return json(result?.error?503:200,result);
      }
      return json(404,{error:'GameTwin endpoint not found'});
    }catch(error){return json(500,{error:error.message,mode:'shadow',aegis_weight:0,release_eligible:false});}
  }
  return {VERSION,route};
}

module.exports={VERSION,json,parseGamePk,parseFamily,createGameTwinApi};
