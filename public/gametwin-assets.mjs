import {applyMaterialFidelity} from './gametwin-materials.mjs?v=1.7.0';
import {actionPlayback,stabilizedRootY} from './gametwin-motion.mjs?v=1.7.0';
import {footPlacementOverlay} from './gametwin-animation.mjs?v=1.7.0';
export const GAMETWIN_ASSET_PIPELINE_VERSION='1.7.0';
export const DEFAULT_GAMETWIN_ASSET_MANIFEST=Object.freeze({
  generic_player:null,
  batter:null,
  pitcher:null,
  fielder:null,
  runner:null,
  catcher:null,
  umpire:null,
  generic_stadium:null,
  stadium_modules:null
});

const GLTF_LOADER_URL='https://unpkg.com/three@0.185.1/examples/jsm/loaders/GLTFLoader.js';
const SKELETON_UTILS_URL='https://unpkg.com/three@0.185.1/examples/jsm/utils/SkeletonUtils.js';
const ROLE_FALLBACK={batter:'generic_player',pitcher:'generic_player',fielder:'generic_player',runner:'generic_player',catcher:'generic_player',umpire:'generic_player'};
const CHARACTER_KINDS=new Set(['generic_player','batter','pitcher','fielder','runner','catcher','umpire']);
const QUALITY_ORDER={low:0,medium:1,high:2};
const DEFAULT_BUDGETS=Object.freeze({
  character:{low:45000,medium:95000,high:180000},
  stadium:{low:180000,medium:420000,high:850000},
  module:{low:90000,medium:220000,high:450000}
});

export function normalizeAssetDescriptor(value,kind='asset'){
  if(!value)return null;
  if(typeof value==='string')return {url:value,lods:{},kind,target_height_ft:null,anchor:'feet',max_triangles:null,required_animations:[],preferred_animations:[]};
  if(typeof value!=='object')return null;
  const lods={...(value.lods||{})};
  for(const q of ['low','medium','high'])if(typeof value[q]==='string'&&!lods[q])lods[q]=value[q];
  return {
    ...value,
    url:typeof value.url==='string'?value.url:null,
    lods,
    kind:value.kind||kind,
    target_height_ft:Number.isFinite(Number(value.target_height_ft))?Number(value.target_height_ft):null,
    anchor:value.anchor||'feet',
    max_triangles:value.max_triangles??null,
    required_animations:Array.isArray(value.required_animations)?value.required_animations.map(String):[],
    preferred_animations:Array.isArray(value.preferred_animations)?value.preferred_animations.map(String):[]
  };
}

export function chooseAssetUrl(value,quality='medium'){
  const d=normalizeAssetDescriptor(value);if(!d)return null;
  const q=QUALITY_ORDER[quality]==null?'medium':quality,l=d.lods||{};
  if(l[q])return l[q];
  if(d.url)return d.url;
  const preferred=q==='high'?['medium','low']:q==='medium'?['low','high']:['medium','high'];
  for(const k of preferred)if(l[k])return l[k];
  return null;
}

export function triangleBudget(kind='asset',quality='medium',descriptor=null){
  const d=normalizeAssetDescriptor(descriptor,kind),custom=d?.max_triangles;
  if(Number.isFinite(Number(custom)))return Number(custom);
  if(custom&&Number.isFinite(Number(custom[quality])))return Number(custom[quality]);
  const family=CHARACTER_KINDS.has(kind)?'character':kind==='generic_stadium'?'stadium':'module';
  return DEFAULT_BUDGETS[family][quality]||DEFAULT_BUDGETS[family].medium;
}

export function inspectScene(root){
  const stats={meshes:0,skinned_meshes:0,triangles:0,materials:0,textures:0,bones:0};
  const mats=new Set(),tex=new Set();
  root?.traverse?.(o=>{
    if(o.isMesh){stats.meshes++;if(o.isSkinnedMesh)stats.skinned_meshes++;const g=o.geometry,idx=g?.index?.count,pos=g?.attributes?.position?.count;stats.triangles+=Math.floor((idx||pos||0)/3);const arr=Array.isArray(o.material)?o.material:[o.material];for(const m of arr){if(!m)continue;mats.add(m);for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'])if(m[key])tex.add(m[key]);}}
    if(o.isBone)stats.bones++;
  });
  stats.materials=mats.size;stats.textures=tex.size;return stats;
}

export function validateAssetScene(root,{kind='asset',quality='medium',descriptor=null,animations=[]}={}){
  const stats=inspectScene(root),budget=triangleBudget(kind,quality,descriptor),errors=[],warnings=[];
  if(!root)errors.push('missing_scene');
  if(root&&stats.meshes===0)errors.push('no_meshes');
  if(stats.triangles>budget)errors.push(`triangle_budget_exceeded:${stats.triangles}>${budget}`);
  if(CHARACTER_KINDS.has(kind)&&stats.skinned_meshes===0)warnings.push('no_skinned_mesh');
  const d=normalizeAssetDescriptor(descriptor,kind),available=new Set((animations||[]).map(a=>String(a?.name||'').toLowerCase()));
  for(const required of d?.required_animations||[])if(!available.has(String(required).toLowerCase()))warnings.push(`missing_animation:${required}`);
  for(const preferred of d?.preferred_animations||[])if(!available.has(String(preferred).toLowerCase()))warnings.push(`missing_preferred_animation:${preferred}`);
  return {ok:errors.length===0,kind,quality,budget,stats,errors,warnings};
}

export function mapBaseballSkeleton(root){
  const bones={};root?.traverse?.(o=>{if(!o?.isBone)return;const n=String(o.name||'');for(const key of ['Root','Hips','LHip','LKnee','LAnkle','RHip','RKnee','RAnkle'])if(n.toLowerCase()===key.toLowerCase())bones[key]=o;});
  return bones;
}

export function createGameTwinAssetPipeline(THREE,{manifest=DEFAULT_GAMETWIN_ASSET_MANIFEST,quality='medium'}={}){
  class GameTwinAssetPipeline{
    constructor(){this.manifest={...DEFAULT_GAMETWIN_ASSET_MANIFEST,...(manifest||{})};this.quality=quality;this.cache=new Map();this.loaderPromise=null;this.skeletonPromise=null;this.failures=[];this.warnings=[];this.instances=0;this.loaded={};this.active_lods={};}
    setQuality(q){this.quality=QUALITY_ORDER[q]==null?'medium':q;}
    rawFor(kind){return this.manifest?.[kind]??this.manifest?.[ROLE_FALLBACK[kind]]??null;}
    descriptorFor(kind){const key=this.manifest?.[kind]?kind:ROLE_FALLBACK[kind]||kind;return normalizeAssetDescriptor(this.rawFor(kind),key);}
    has(kind){return !!chooseAssetUrl(this.rawFor(kind),this.quality);}
    urlFor(kind){return chooseAssetUrl(this.rawFor(kind),this.quality);}
    async loader(){
      if(!this.loaderPromise)this.loaderPromise=import(GLTF_LOADER_URL).then(mod=>new mod.GLTFLoader()).catch(err=>{this.failures.push({kind:'loader',error:String(err?.message||err)});return null;});
      return this.loaderPromise;
    }
    async skeletonUtils(){
      if(!this.skeletonPromise)this.skeletonPromise=import(SKELETON_UTILS_URL).catch(err=>{this.failures.push({kind:'skeleton_utils',error:String(err?.message||err)});return null;});
      return this.skeletonPromise;
    }
    prepare(root){
      if(!root)return root;
      const maxAniso=this.quality==='high'?8:this.quality==='medium'?4:2;
      root.traverse?.(o=>{
        if(o.isMesh){o.castShadow=this.quality!=='low';o.receiveShadow=true;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(!m)continue;if(m.map){m.map.colorSpace=THREE.SRGBColorSpace;m.map.anisotropy=Math.min(maxAniso,8);m.map.needsUpdate=true;}applyMaterialFidelity(m,{quality:this.quality});}}
      });
      return root;
    }
    async load(kind){
      const url=this.urlFor(kind);if(!url)return null;const descriptor=this.descriptorFor(kind),cacheKey=`${this.quality}|${url}`;if(this.cache.has(cacheKey))return this.cache.get(cacheKey);
      const task=(async()=>{const loader=await this.loader();if(!loader)return null;try{const gltf=await loader.loadAsync(url);this.prepare(gltf.scene);const validation=validateAssetScene(gltf.scene,{kind,quality:this.quality,descriptor,animations:gltf.animations||[]});if(!validation.ok){this.failures.push({kind,url,error:'asset_validation_failed',validation});return null;}if(validation.warnings.length)this.warnings.push({kind,url,warnings:validation.warnings});this.loaded[kind]={url,validation};this.active_lods[kind]=this.quality;return {...gltf,descriptor,validation,source_url:url};}catch(err){this.failures.push({kind,url,error:String(err?.message||err)});return null;}})();
      this.cache.set(cacheKey,task);return task;
    }
    async preload(kinds=[]){const unique=[...new Set(kinds)].filter(k=>this.has(k));const results=await Promise.all(unique.map(async kind=>[kind,!!(await this.load(kind))]));return Object.fromEntries(results);}
    async instantiate(kind){
      const gltf=await this.load(kind);if(!gltf?.scene)return null;
      let scene=null;try{const su=await this.skeletonUtils();scene=su?.clone?su.clone(gltf.scene):gltf.scene.clone(true);}catch{scene=gltf.scene.clone(true);}
      this.prepare(scene);this.instances++;
      const controller=this.createAnimationController({...gltf,scene},kind);
      return {scene,animations:gltf.animations||[],controller,source_kind:kind,descriptor:gltf.descriptor||this.descriptorFor(kind),validation:gltf.validation||null,source_url:gltf.source_url||this.urlFor(kind)};
    }
    createAnimationController(gltf,role='fielder'){
      if(!gltf?.scene||!gltf?.animations?.length)return null;
      const mixer=new THREE.AnimationMixer(gltf.scene),actions=new Map();for(const clip of gltf.animations){actions.set(String(clip.name||'').toLowerCase(),mixer.clipAction(clip));}
      const skeleton=mapBaseballSkeleton(gltf.scene),rootBone=skeleton.Root||skeleton.Hips||null,rootBase=rootBone?.position?.clone?.()||null;
      const legBase={};for(const side of ['L','R']){for(const key of ['Hip','Knee','Ankle']){const bone=skeleton[side+key];if(bone)legBase[side+key]={rotation:bone.rotation.clone(),position:bone.position.clone()};}}
      const ctl={mixer,actions,current:null,currentName:null,rootBone,rootBase,skeleton,role,footIKEnabled:true,footIKStrength:.42,
        play(name,opts=.18){const raw=String(name||'').toLowerCase(),base=actionPlayback(role,raw),cfg=typeof opts==='number'?{...base,fade:opts}:{...base,...(opts||{})},next=actions.get(raw);if(!next)return false;const fade=Number.isFinite(Number(cfg.fade))?Number(cfg.fade):.18,timeScale=Number.isFinite(Number(cfg.timeScale))?Number(cfg.timeScale):1,loop=cfg.loop!==false;next.enabled=true;next.clampWhenFinished=!loop;next.setLoop?.(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);next.setEffectiveTimeScale?.(timeScale);next.reset().play();if(ctl.current&&ctl.current!==next)ctl.current.crossFadeTo(next,fade,false);ctl.current=next;ctl.currentName=raw;return true;},
        applyFootIK(){if(!ctl.footIKEnabled||!skeleton.Hips)return;const skip=/pitch|slide|trot/.test(ctl.currentName||'');if(skip)return;for(const side of ['L','R']){const hip=skeleton[side+'Hip'],knee=skeleton[side+'Knee'],ankle=skeleton[side+'Ankle'];if(!hip||!knee||!ankle)continue;const hipBase=legBase[side+'Hip']?.rotation,kneeBase=legBase[side+'Knee']?.rotation;if(!hipBase||!kneeBase)continue;const ankleY=ankle.getWorldPosition(new THREE.Vector3()).y;const rootY=gltf.scene.getWorldPosition(new THREE.Vector3()).y;const over=footPlacementOverlay({ankleY,groundY:rootY,upper:Math.abs(knee.position.y)||1.42,lower:Math.abs(ankle.position.y)||1.3,lock:ctl.footIKStrength,side});hip.rotation.x+=over.hipCorrection*.35;knee.rotation.x+=over.kneeCorrection*.46;}},
        update(dt){mixer.update(dt);if(ctl.rootBone&&ctl.rootBase){const moving=/run|trot|slide/.test(ctl.currentName||''),lock=moving?.5:.9;ctl.rootBone.position.x=ctl.rootBase.x+(ctl.rootBone.position.x-ctl.rootBase.x)*(1-lock);ctl.rootBone.position.z=ctl.rootBase.z+(ctl.rootBone.position.z-ctl.rootBase.z)*(1-lock);ctl.rootBone.position.y=stabilizedRootY(ctl.rootBone.position.y,ctl.rootBase.y,dt,{responsiveness:18,maxStep:.045});}ctl.applyFootIK();},
        stop(){for(const a of actions.values())a.stop();ctl.current=null;ctl.currentName=null;}
      };
      return ctl;
    }
    status(){return {version:GAMETWIN_ASSET_PIPELINE_VERSION,quality:this.quality,configured:Object.fromEntries(Object.entries(this.manifest).map(([k,v])=>[k,!!v])),active_lods:{...this.active_lods},loaded:{...this.loaded},instances:this.instances,failures:[...this.failures],warnings:[...this.warnings]};}
  }
  return new GameTwinAssetPipeline();
}
