'use strict';

const fs=require('fs');const path=require('path');

const VERSION='2.1.0-installer';
function patchServerText(input){
  let s=String(input);
  // GameTwin pins Three.js to one exact version. The version-scoped path permits both core and GLTFLoader modules.
  if(s.includes("script-src 'self';"))s=s.replace("script-src 'self';","script-src 'self' https://unpkg.com/three@0.185.1/;");
  if(!s.includes('createGameTwinService')){
    const anchor="const heartbeat = require('./src/heartbeat');";
    if(!s.includes(anchor))throw new Error('AEGIS server hook anchor not found: heartbeat import');
    s=s.replace(anchor,anchor+"\nconst { createGameTwinService } = require('./src/gametwin-service');\nconst gametwin = createGameTwinService({ aegisStore: store });");
  }
  if(!s.includes('AEGIS GAMETWIN API HOOK')){
    const anchor="    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);";
    if(!s.includes(anchor))throw new Error('AEGIS server hook anchor not found: URL parser');
    s=s.replace(anchor,anchor+"\n\n    // AEGIS GAMETWIN API HOOK — shadow-only; browser-session auth required.\n    if(u.pathname.startsWith('/api/gametwin/')){\n      if(!requireAuth(req,res))return;\n      const gtRoute=await gametwin.api.route(req,u);\n      if(gtRoute.handled)return send(res,gtRoute.status,gtRoute.body);\n    }");
  }
  if(!s.includes('AEGIS GAMETWIN AUTOPILOT HOOK')){
    const old="      const result=await autopilot.tick({force,sports:sport?[sport]:body.sports,reason:body.reason||'scheduled autopilot'});\n      return send(res,200,result);";
    if(!s.includes(old))throw new Error('AEGIS server hook anchor not found: autopilot tick');
    const neu="      const result=await autopilot.tick({force,sports:sport?[sport]:body.sports,reason:body.reason||'scheduled autopilot'});\n      // AEGIS GAMETWIN AUTOPILOT HOOK — enqueue only; GameTwin circuit breaker is isolated from AEGIS.\n      let gametwinShadow=null;\n      try{const mlbCard=await autopilot.latestCard('baseball_mlb');if(mlbCard)gametwinShadow=gametwin.queueAegisCard(mlbCard);}\n      catch(e){gametwinShadow={queued:false,error:e.message,mode:'shadow',aegis_weight:0};}\n      return send(res,200,{...result,gametwin_shadow:gametwinShadow});";
    s=s.replace(old,neu);
  }
  if(!s.includes('AEGIS GAMETWIN MANUAL-SCAN HOOK')){
    const old="      try{out.persistence=await autopilot.captureScan(sport,out,events,'manual in-depth scan');}catch(e){out.persistence={saved:false,error:e.message};}\n      return send(res,200,out);";
    if(!s.includes(old))throw new Error('AEGIS server hook anchor not found: manual scan persistence');
    const neu="      try{out.persistence=await autopilot.captureScan(sport,out,events,'manual in-depth scan');}catch(e){out.persistence={saved:false,error:e.message};}\n      // AEGIS GAMETWIN MANUAL-SCAN HOOK — MLB only, shadow-only.\n      if(sport==='baseball_mlb'){try{out.gametwin_shadow=gametwin.queueAegisCard(out);}catch(e){out.gametwin_shadow={queued:false,error:e.message,mode:'shadow',aegis_weight:0};}}\n      return send(res,200,out);";
    s=s.replace(old,neu);
  }
  return s;
}
function patchIndexText(input){
  let s=String(input);
  // Normalize prior GameTwin v1.x/v2.x integration blocks before applying v2.1.0.
  s=s.replace(/<!-- AEGIS GAMETWIN V[12]\.[0-9.]+ COMMAND CENTER CSS -->\s*<link rel="stylesheet" href="\/gametwin-command-center\.css\?v=[12]\.[0-9.]+">\s*/g,'');
  s=s.replace(/<!-- AEGIS GAMETWIN V[12]\.[0-9.]+ COMMAND CENTER JS -->\s*<script src="\/gametwin-broadcast\.js\?v=[12]\.[0-9.]+" defer><\/script>\s*(?:<script src="\/gametwin-asset-manifest\.js\?v=[12]\.[0-9.]+" defer><\/script>\s*)?<script src="\/gametwin-3d-loader\.js\?v=[12]\.[0-9.]+" defer><\/script>\s*<script src="\/gametwin-command-center\.js\?v=[12]\.[0-9.]+" defer><\/script>\s*/g,'');
  if(!s.includes('AEGIS GAMETWIN V2.1.0 COMMAND CENTER CSS')){
    const anchor='</head>';if(!s.includes(anchor))throw new Error('AEGIS index hook anchor not found: </head>');
    s=s.replace(anchor,'<!-- AEGIS GAMETWIN V2.1.0 COMMAND CENTER CSS -->\n<link rel="stylesheet" href="/gametwin-command-center.css?v=2.1.0">\n'+anchor);
  }
  if(!s.includes('AEGIS GAMETWIN V2.1.0 COMMAND CENTER JS')){
    const anchor='</body>';if(!s.includes(anchor))throw new Error('AEGIS index hook anchor not found: </body>');
    const scripts='<!-- AEGIS GAMETWIN V2.1.0 COMMAND CENTER JS -->\n<script src="/gametwin-broadcast.js?v=2.1.0" defer></script>\n<script src="/gametwin-asset-manifest.js?v=2.1.0" defer></script>\n<script src="/gametwin-3d-loader.js?v=2.1.0" defer></script>\n<script src="/gametwin-command-center.js?v=2.1.0" defer></script>\n';
    s=s.replace(anchor,scripts+anchor);
  }
  return s;
}
function copyMatching(from,to,prefix){fs.mkdirSync(to,{recursive:true});for(const name of fs.readdirSync(from)){if(!name.startsWith(prefix))continue;const src=path.join(from,name),dst=path.join(to,name);if(fs.statSync(src).isFile())fs.copyFileSync(src,dst);}}
function copyTree(from,to){if(!fs.existsSync(from))return;fs.mkdirSync(to,{recursive:true});for(const name of fs.readdirSync(from)){const src=path.join(from,name),dst=path.join(to,name),st=fs.statSync(src);if(st.isDirectory())copyTree(src,dst);else fs.copyFileSync(src,dst);}}
function safeBackup(file,suffix){const backup=file+suffix;if(!fs.existsSync(backup))fs.copyFileSync(file,backup);return backup;}
function preflight(target){
  target=path.resolve(target);const server=path.join(target,'server.js'),index=path.join(target,'public','index.html'),packageFile=path.join(target,'package.json'),checks=[];
  checks.push({id:'server.js',ok:fs.existsSync(server)});checks.push({id:'public/index.html',ok:fs.existsSync(index)});
  let aegisVersion=null;if(fs.existsSync(packageFile)){try{aegisVersion=JSON.parse(fs.readFileSync(packageFile,'utf8')).version||null;}catch{}}
  checks.push({id:'aegis_version_8.9.3',ok:aegisVersion==='8.9.3',value:aegisVersion});
  if(fs.existsSync(server)){const text=fs.readFileSync(server,'utf8');checks.push({id:'heartbeat_anchor',ok:text.includes("const heartbeat = require('./src/heartbeat');")||text.includes('createGameTwinService')});checks.push({id:'url_anchor',ok:text.includes("const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);")||text.includes('AEGIS GAMETWIN API HOOK')});}
  if(fs.existsSync(index)){const text=fs.readFileSync(index,'utf8');checks.push({id:'index_head_anchor',ok:text.includes('</head>')});checks.push({id:'index_body_anchor',ok:text.includes('</body>')});}
  const ok=checks.every(x=>x.ok);return {version:VERSION,target,compatible:ok,checks,write_performed:false,aegis_weight:0,release_eligible:false};
}
function install(target){
  target=path.resolve(target);const pkg=path.resolve(__dirname,'..'),server=path.join(target,'server.js'),index=path.join(target,'public','index.html'),packageFile=path.join(target,'package.json');
  if(!fs.existsSync(server))throw new Error(`server.js not found in ${target}`);if(!fs.existsSync(index))throw new Error(`public/index.html not found in ${target}`);
  if(fs.existsSync(packageFile)){const v=JSON.parse(fs.readFileSync(packageFile,'utf8')).version;if(v&&v!=='8.9.3')throw new Error(`GameTwin v2.1 installer expects AEGIS 8.9.3; found ${v}`);}
  copyMatching(path.join(pkg,'src'),path.join(target,'src'),'gametwin');copyMatching(path.join(pkg,'tests'),path.join(target,'tests'),'gametwin');copyMatching(path.join(pkg,'public'),path.join(target,'public'),'gametwin');copyTree(path.join(pkg,'public','gametwin-assets'),path.join(target,'public','gametwin-assets'));
  const serverBefore=fs.readFileSync(server,'utf8'),serverAfter=patchServerText(serverBefore);if(serverAfter!==serverBefore){safeBackup(server,'.pre-gametwin-v1.0.bak');fs.writeFileSync(server,serverAfter);}
  const indexBefore=fs.readFileSync(index,'utf8'),indexAfter=patchIndexText(indexBefore);if(indexAfter!==indexBefore){safeBackup(index,'.pre-gametwin-v1.0.bak');fs.writeFileSync(index,indexAfter);}
  return {version:VERSION,target,server_patched:serverAfter!==serverBefore,index_patched:indexAfter!==indexBefore,integrated_game_lab:true,shadow_url:'/gametwin.html',pilot_enabled_by_default:true,aegis_weight:0,release_eligible:false};
}
if(require.main===module){try{const preflightOnly=process.argv.includes('--preflight'),target=process.argv.find(x=>x!=='--preflight'&&x!==process.argv[0]&&x!==process.argv[1])||process.cwd();const out=preflightOnly?preflight(target):install(target);console.log(JSON.stringify(out,null,2));if(preflightOnly&&!out.compatible)process.exitCode=2;}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={VERSION,patchServerText,patchIndexText,preflight,install};
