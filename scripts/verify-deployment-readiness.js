'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));
const required=[
  'public/gametwin.html','public/gametwin-production.css','public/gametwin-production-ui.js','public/gametwin-readiness.mjs','public/gametwin-3d.mjs','public/gametwin-3d-loader.js','public/gametwin-asset-manifest.js','public/gametwin-assets/ASSET_SHA256.json','scripts/install-into-aegis-v8.9.3.js'
];
const errors=[],warnings=[];
for(const f of required)if(!exists(f))errors.push(`missing:${f}`);
const pkg=JSON.parse(read('package.json'));if(!['2.1.0','8.9.3'].includes(pkg.version))errors.push(`package_version:${pkg.version}`);
const html=read('public/gametwin.html');for(const token of ['gametwin-production.css?v=2.1.0','gametwin-3d-loader.js?v=2.1.2','gametwin-production-ui.js?v=2.1.0'])if(!html.includes(token))errors.push(`cache_bust_missing:${token}`);
const installer=read('scripts/install-into-aegis-v8.9.3.js');if(!installer.includes("const VERSION='2.1.0-installer'"))errors.push('installer_version');
const firewallSrc=['src/gametwin-shadow.js','src/gametwin-aegis-bridge.js','src/gametwin-viewmodel.js','src/gametwin-pilot.js'].map(read).join('\n');if(!/aegis_weight\s*:\s*0/.test(firewallSrc)||!/release_eligible\s*:\s*false/.test(firewallSrc))errors.push('shadow_firewall_missing');
const manifest=read('public/gametwin-asset-manifest.js');const urls=[...manifest.matchAll(/['"](\/gametwin-assets\/[^'"]+\.glb)['"]/g)].map(m=>m[1]);if(!urls.length)errors.push('asset_manifest_empty');
for(const u of urls){const rel='public'+u;if(!exists(rel))errors.push(`asset_missing:${u}`);const size=exists(rel)?fs.statSync(path.join(root,rel)).size:0;if(size>1_500_000)warnings.push(`asset_large:${u}:${size}`);}
if(/https?:\/\//.test(manifest))errors.push('remote_asset_url_in_bundled_manifest');
const production=read('public/gametwin-production-ui.js');if(!production.includes('gametwin-readiness.mjs?v=2.1.0'))errors.push('readiness_ui_not_wired');
const three=read('public/gametwin-3d.mjs');if(!three.includes('createFramePerformanceMonitor'))errors.push('performance_monitor_not_wired');
const out={version:'2.1.0',ok:errors.length===0,required_files:required.length,asset_urls:urls.length,errors,warnings,shadow_only:true,aegis_weight:0,release_eligible:false};
console.log(JSON.stringify(out,null,2));if(errors.length)process.exitCode=1;
