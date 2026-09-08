'use strict';

(function(){
  const THREE_URL='https://unpkg.com/three@0.185.1/build/three.module.min.js';
  const LOCAL_URL='/gametwin-3d.mjs?v=2.1.1';
  const POLISH_URL='/gametwin-polish-v2.1.1.mjs?v=2.1.1';
  window.GameTwin3DStatus={state:'LOADING',three_version:'0.185.1',renderer:'Three.js WebGL',visual_fidelity:'2.1.1-polish',cinematic_gameplay:'1.8.0',broadcast_director:'1.9.0',broadcast_experience:'2.0.0',deployment_readiness:'2.1.0',pbr:true,glb_ready:true,bundled_assets:true,asset_manifest:'local-v1.7',character_pack:'1.7.0',stadium_pack:'1.7.0',polish_pass:'camera-character-lighting-field'};
  function canWebGL(){
    try{
      const c=document.createElement('canvas');
      return !!(window.WebGL2RenderingContext&&c.getContext('webgl2'));
    }catch{return false;}
  }
  if(!canWebGL()){
    window.GameTwin3DStatus={state:'FALLBACK',reason:'WebGL2 unavailable',three_version:'0.185.1',renderer:'v0.6 Canvas2D',visual_fidelity:'2.1.1-polish',broadcast_experience:'2.0.0',deployment_readiness:'2.1.0'};
    window.GameTwin3DReady=Promise.resolve(false);
    return;
  }
  window.GameTwin3DReady=Promise.all([import(THREE_URL),import(LOCAL_URL),import(POLISH_URL)])
    .then(([THREE,mod,polish])=>{
      const SceneClass=mod.createGameTwinBroadcastScene3D(THREE);
      window.GameTwinBroadcastScene3D=polish.applyGameTwinPolish(SceneClass,THREE);
      window.GameTwin3DStatus={state:'READY',three_version:THREE.REVISION||'185',renderer:'Three.js WebGL',visual_fidelity:'2.1.1-polish',cinematic_gameplay:'1.8.0',broadcast_director:'1.9.0',broadcast_experience:'2.0.0',deployment_readiness:'2.1.0',pbr:true,glb_ready:true,bundled_assets:true,asset_manifest:'local-v1.7',character_pack:'1.7.0',stadium_pack:'1.7.0',polish_pass:'camera-character-lighting-field'};
      window.dispatchEvent(new CustomEvent('gametwin3dready',{detail:window.GameTwin3DStatus}));
      return true;
    })
    .catch(error=>{
      console.warn('GameTwin 3D unavailable; using v0.6 broadcast fallback.',error);
      window.GameTwin3DStatus={state:'FALLBACK',reason:error?.message||'3D module load failed',three_version:'0.185.1',renderer:'v0.6 Canvas2D',visual_fidelity:'2.1.1-polish',broadcast_experience:'2.0.0',deployment_readiness:'2.1.0'};
      window.dispatchEvent(new CustomEvent('gametwin3dfallback',{detail:window.GameTwin3DStatus}));
      return false;
    });
})();
