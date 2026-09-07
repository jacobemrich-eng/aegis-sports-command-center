export const GAMETWIN_MATERIAL_VERSION='1.7.0';

function canvasTexture(THREE,size,paint,{repeat=[1,1],srgb=true}={}){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d');paint(c,size);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(...repeat);tex.anisotropy=4;if(srgb)tex.colorSpace=THREE.SRGBColorSpace;tex.needsUpdate=true;return tex;
}
function hashNoise(x,y,seed=0){const n=Math.sin((x+seed)*12.9898+(y-seed)*78.233)*43758.5453;return n-Math.floor(n);}
function grayTexture(THREE,size,paint,{repeat=[1,1]}={}){return canvasTexture(THREE,size,paint,{repeat,srgb:false});}

export function materialClass(name=''){
  const n=String(name).toLowerCase();
  if(/jersey|uniform|fabric|cloth|pants|sock/.test(n))return 'fabric';
  if(/skin|face|hand|arm/.test(n))return 'skin';
  if(/glove|leather/.test(n))return 'leather';
  if(/helmet|plastic|guard|gear/.test(n))return 'gear';
  if(/metal|mask|rail|truss/.test(n))return 'metal';
  if(/shoe|rubber|cleat/.test(n))return 'rubber';
  if(/grass|turf/.test(n))return 'grass';
  if(/dirt|clay|mound/.test(n))return 'dirt';
  if(/concrete|cement|stand/.test(n))return 'concrete';
  return 'generic';
}

export function materialFinish(name='',quality='medium'){
  const high=quality==='high',low=quality==='low',type=materialClass(name);
  const map={
    fabric:{roughness:high?.62:.68,metalness:0,clearcoat:.015,envMapIntensity:.72},
    skin:{roughness:high?.58:.68,metalness:0,clearcoat:.025,envMapIntensity:.68},
    leather:{roughness:high?.48:.58,metalness:0,clearcoat:.08,envMapIntensity:.8},
    gear:{roughness:.24,metalness:.08,clearcoat:.7,clearcoatRoughness:.12,envMapIntensity:1.0},
    metal:{roughness:.28,metalness:.72,clearcoat:.12,envMapIntensity:high?1.3:1.05},
    rubber:{roughness:.62,metalness:0,clearcoat:.05,envMapIntensity:.55},
    grass:{roughness:.94,metalness:0,envMapIntensity:.55},
    dirt:{roughness:.98,metalness:0,envMapIntensity:.45},
    concrete:{roughness:.82,metalness:.025,envMapIntensity:.58},
    generic:{roughness:low?.72:.62,metalness:.02,envMapIntensity:high?1.05:.82}
  };
  return {type,...map[type]};
}

export function applyMaterialFidelity(material,{quality='medium'}={}){
  if(!material)return material;const f=materialFinish(material.name||'',quality);
  for(const k of ['roughness','metalness','clearcoat','clearcoatRoughness','envMapIntensity'])if(k in f&&k in material)material[k]=f[k];
  material.userData={...(material.userData||{}),gametwinMaterialClass:f.type,gametwinFidelityVersion:GAMETWIN_MATERIAL_VERSION};material.needsUpdate=true;return material;
}

export function createGameTwinMaterials(THREE,{quality='medium'}={}){
  const high=quality==='high',low=quality==='low',texSize=high?384:low?128:256;
  const grassMap=canvasTexture(THREE,texSize,(c,s)=>{
    c.fillStyle='#1f6c3c';c.fillRect(0,0,s,s);const stripes=12,w=s/stripes;for(let i=0;i<stripes;i++){c.fillStyle=i%2?'rgba(64,148,83,.16)':'rgba(5,55,28,.12)';c.fillRect(i*w,0,w,s);}const img=c.getImageData(0,0,s,s);for(let y=0;y<s;y+=2)for(let x=0;x<s;x+=2){const n=(hashNoise(x,y,2)-.5)*12,idx=(y*s+x)*4;img.data[idx]=Math.max(0,Math.min(255,img.data[idx]+n));img.data[idx+1]=Math.max(0,Math.min(255,img.data[idx+1]+n));img.data[idx+2]=Math.max(0,Math.min(255,img.data[idx+2]+n));}c.putImageData(img,0,0);
  },{repeat:high?[10,10]:[6,6]});
  const grassBump=grayTexture(THREE,high?256:128,(c,s)=>{const im=c.createImageData(s,s);for(let y=0;y<s;y++)for(let x=0;x<s;x++){const blade=(x+y)%5===0?28:0,v=112+Math.floor(hashNoise(x,y,7)*75)+blade,i=(y*s+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=Math.min(255,v);im.data[i+3]=255;}c.putImageData(im,0,0);},{repeat:high?[18,18]:[10,10]});
  const dirtMap=canvasTexture(THREE,high?256:160,(c,s)=>{c.fillStyle='#925d35';c.fillRect(0,0,s,s);for(let i=0;i<(high?6000:2400);i++){const x=(hashNoise(i,3,4)*s),y=(hashNoise(i,9,8)*s),v=92+Math.floor(hashNoise(i,11,5)*70);c.fillStyle=`rgba(${v+45},${v},${Math.max(35,v-30)},${.05+hashNoise(i,13,1)*.12})`;const r=.3+hashNoise(i,17,9)*1.3;c.fillRect(x,y,r,r);}}, {repeat:[8,8]});
  const dirtBump=grayTexture(THREE,128,(c,s)=>{const im=c.createImageData(s,s);for(let y=0;y<s;y++)for(let x=0;x<s;x++){const v=92+Math.floor(hashNoise(x,y,13)*130),i=(y*s+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255;}c.putImageData(im,0,0);},{repeat:[12,12]});
  const concreteBump=grayTexture(THREE,96,(c,s)=>{const im=c.createImageData(s,s);for(let y=0;y<s;y++)for(let x=0;x<s;x++){const v=110+Math.floor(hashNoise(x,y,21)*48),i=(y*s+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255;}c.putImageData(im,0,0);},{repeat:[8,8]});
  const pack={
    grass:new THREE.MeshPhysicalMaterial({color:0xffffff,map:grassMap,bumpMap:grassBump,bumpScale:high?.09:.055,roughness:.94,metalness:0,clearcoat:0}),
    dirt:new THREE.MeshPhysicalMaterial({color:0xffffff,map:dirtMap,bumpMap:dirtBump,bumpScale:high?.16:.1,roughness:.98,metalness:0}),
    wall:new THREE.MeshPhysicalMaterial({color:0x15364a,roughness:.56,metalness:.06,clearcoat:.08,clearcoatRoughness:.72}),
    chalk:new THREE.MeshPhysicalMaterial({color:0xf7f5e8,roughness:.72,metalness:0}),
    concrete:new THREE.MeshPhysicalMaterial({color:0x1b2c38,bumpMap:concreteBump,bumpScale:.07,roughness:.8,metalness:.035}),
    metal:new THREE.MeshPhysicalMaterial({color:0xc6d1d8,roughness:.3,metalness:.74,clearcoat:.1}),
    water:new THREE.MeshPhysicalMaterial({color:0x177da4,roughness:.12,metalness:.1,transmission:.05,clearcoat:.8,clearcoatRoughness:.15,transparent:true,opacity:.9}),
    helmet:new THREE.MeshPhysicalMaterial({color:0x111923,roughness:.18,metalness:.12,clearcoat:1,clearcoatRoughness:.08}),
    leather:new THREE.MeshPhysicalMaterial({color:0x9b673d,roughness:.52,metalness:0,clearcoat:.08}),
    ball:new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.28,metalness:0,clearcoat:.45,clearcoatRoughness:.16,emissive:0xffffff,emissiveIntensity:.025}),
    dispose(){for(const m of Object.values(this)){if(m?.isMaterial){for(const k of ['map','bumpMap','normalMap','roughnessMap'])m[k]?.dispose?.();m.dispose?.();}}}
  };
  for(const m of Object.values(pack))if(m?.isMaterial)m.userData={...(m.userData||{}),gametwinShared:true,gametwinFidelityVersion:GAMETWIN_MATERIAL_VERSION};
  return pack;
}
