export const GAMETWIN_POLISH_VERSION='2.1.1';

const PATCH_FLAG=Symbol.for('aegis.gametwin.polish.v2.1.1');
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number(n)||0));

function patchRig(rig){
  if(!rig||rig.userData?.gametwinPolish211)return;
  rig.userData.gametwinPolish211=true;
  const role=String(rig.userData?.role||'fielder');

  if(rig.uniformMaterial){
    rig.uniformMaterial.roughness=.79;
    rig.uniformMaterial.metalness=0;
    if('sheen' in rig.uniformMaterial)rig.uniformMaterial.sheen=.055;
    if('clearcoat' in rig.uniformMaterial)rig.uniformMaterial.clearcoat=.025;
    rig.uniformMaterial.needsUpdate=true;
  }

  const direct=(rig.hips?.children||[]).filter(o=>o?.isMesh);
  const torso=direct.find(o=>o.geometry?.type==='CapsuleGeometry');
  const spheres=direct.filter(o=>o.geometry?.type==='SphereGeometry').sort((a,b)=>(a.position?.y||0)-(b.position?.y||0));
  const head=spheres[0],cap=spheres[1];
  if(torso)torso.scale.set(.84,1.06,.88);
  if(head){head.scale.set(.88,.94,.88);head.position.y=3.52;}
  if(cap){cap.scale.set(.91,.90,.91);cap.position.y=3.76;}

  if(rig.leftShoulder){rig.leftShoulder.position.x=-1.02;rig.leftShoulder.scale.set(.91,1.04,.91);}
  if(rig.rightShoulder){rig.rightShoulder.position.x=1.02;rig.rightShoulder.scale.set(.91,1.04,.91);}
  if(rig.leftHip){rig.leftHip.position.x=-.47;rig.leftHip.scale.set(.90,1.10,.90);}
  if(rig.rightHip){rig.rightHip.position.x=.47;rig.rightHip.scale.set(.90,1.10,.90);}
  if(rig.nameTag){rig.nameTag.position.y=7.45;rig.nameTag.scale.set(8.0,1.78,1);}

  const baseSetPose=typeof rig.setPose==='function'?rig.setPose.bind(rig):null;
  if(baseSetPose){
    rig.setPose=(kind,t=0)=>{
      baseSetPose(kind,t);
      if(!rig.hips)return;
      if(role==='catcher'){
        if(kind==='idle'){rig.hips.position.y=1.92;rig.hips.rotation.x=.23;rig.leftHip.rotation.x=.62;rig.rightHip.rotation.x=.62;rig.leftShoulder.rotation.x=-.48;rig.rightShoulder.rotation.x=-.48;}
        else if(kind==='receive'||kind==='catch'){rig.hips.position.y=Math.min(rig.hips.position.y,2.05);rig.hips.rotation.x+=.08;}
      }else if(role==='umpire'){
        if(kind==='idle'){rig.hips.position.y=2.18;rig.hips.rotation.x=.13;rig.leftHip.rotation.x=.46;rig.rightHip.rotation.x=.46;rig.leftShoulder.rotation.x=-.30;rig.rightShoulder.rotation.x=-.30;}
      }else if(role==='pitcher'&&kind==='idle'){
        rig.hips.position.y=2.84;
      }else if(role==='batter'&&(kind==='stance_left'||kind==='stance_right')){
        rig.hips.position.y=2.76;
      }
    };
    rig.setPose('idle',0);
  }
}

function addFieldPolish(scene,THREE){
  if(!scene?.worldGroup||scene.worldGroup.userData?.gametwinFieldPolish211)return;
  scene.worldGroup.userData.gametwinFieldPolish211=true;
  const group=new THREE.Group();group.userData.gametwinPolish211=true;
  const stripeDepths=[150,186,222,258,294,330,366];
  stripeDepths.forEach((depth,i)=>{
    const width=Math.min(560,depth*1.48);
    const mat=new THREE.MeshStandardMaterial({
      color:i%2?0x1e5f39:0x3d8551,
      roughness:1,
      metalness:0,
      transparent:true,
      opacity:.075,
      depthWrite:false
    });
    const stripe=new THREE.Mesh(new THREE.PlaneGeometry(width,27),mat);
    stripe.rotation.x=-Math.PI/2;
    stripe.position.set(0,.018,-depth);
    stripe.receiveShadow=true;
    group.add(stripe);
  });
  const rubber=new THREE.Mesh(new THREE.BoxGeometry(2.0,.12,.48),new THREE.MeshStandardMaterial({color:0xf4f1df,roughness:.92}));
  rubber.position.set(0,.68,-60.5);rubber.rotation.y=0;group.add(rubber);
  const plate=new THREE.Mesh(new THREE.CircleGeometry(1.15,5),new THREE.MeshStandardMaterial({color:0xf4f1df,roughness:.92}));
  plate.rotation.x=-Math.PI/2;plate.rotation.z=Math.PI/2;plate.position.set(0,.055,.18);group.add(plate);
  scene.worldGroup.add(group);
}

function addRimLight(scene,THREE){
  if(scene.gtPolishRim||!scene.scene)return;
  const rim=new THREE.DirectionalLight(0xb8d7ff,.38);
  rim.position.set(145,72,-110);
  scene.scene.add(rim);
  scene.gtPolishRim=rim;
}

export function applyGameTwinPolish(SceneClass,THREE){
  const proto=SceneClass?.prototype;
  if(!proto||proto[PATCH_FLAG])return SceneClass;
  proto[PATCH_FLAG]=true;

  const baseCameraPreset=proto.cameraPreset;
  proto.cameraPreset=function(mode='broadcast'){
    if(mode==='batter')return {pos:[-10.5,8.2,16.5],target:[0,4.15,-63],fov:50};
    if(mode==='pitcher')return {pos:[4.2,11.8,-84],target:[0,4.0,1],fov:44};
    if(mode==='stadium')return {pos:[0,172,245],target:[0,8,-175],fov:43};
    if(mode==='ball_track')return {pos:[0,60,118],target:[0,14,-190],fov:44};
    if(mode==='plate_low')return {pos:[-11,4.8,13.5],target:[0,3.2,-64],fov:49};
    return baseCameraPreset.call(this,mode);
  };

  const baseAddLights=proto.addLights;
  proto.addLights=function(){
    const out=baseAddLights.call(this);
    if(this.renderer)this.renderer.toneMappingExposure=.96;
    if(this.ambient){this.ambient.intensity=1.24;this.ambient.color?.setHex?.(0xc9e2f5);this.ambient.groundColor?.setHex?.(0x263421);}
    if(this.sun){this.sun.intensity=2.75;this.sun.color?.setHex?.(0xfff0d7);this.sun.position.set(-145,225,95);}
    if(this.fillLight){this.fillLight.intensity=.50;this.fillLight.color?.setHex?.(0xbad8ff);}
    addRimLight(this,THREE);
    return out;
  };

  const baseEnvironment=proto.applyEnvironment;
  proto.applyEnvironment=function(){
    const out=baseEnvironment.call(this);
    addRimLight(this,THREE);
    if(this.isNight){
      if(this.renderer)this.renderer.toneMappingExposure=.88;
      if(this.ambient)this.ambient.intensity=.88;
      if(this.sun)this.sun.intensity=.16;
      if(this.fillLight)this.fillLight.intensity=.92;
      if(this.gtPolishRim)this.gtPolishRim.intensity=.50;
    }else{
      if(this.renderer)this.renderer.toneMappingExposure=.96;
      if(this.ambient)this.ambient.intensity=1.24;
      if(this.sun)this.sun.intensity=2.75;
      if(this.fillLight)this.fillLight.intensity=.50;
      if(this.gtPolishRim)this.gtPolishRim.intensity=.34;
    }
    if(this.scene?.fog){this.scene.fog.near=275;this.scene.fog.far=900;}
    return out;
  };

  const baseBuildActors=proto.buildActors;
  proto.buildActors=function(){
    const out=baseBuildActors.call(this);
    for(const rig of this.allRigs?.()||[])patchRig(rig);
    return out;
  };

  const baseBuildField=proto.buildField;
  proto.buildField=function(field={}){
    const out=baseBuildField.call(this,field);
    addFieldPolish(this,THREE);
    return out;
  };

  const baseVisualStatus=proto.visualFidelityStatus;
  proto.visualFidelityStatus=function(){
    const base=baseVisualStatus.call(this)||{};
    return {
      ...base,
      version:'2.1.1-polish',
      polish_pass:'camera-character-lighting-field',
      batter_camera_offset:true,
      pitcher_camera_pullback:true,
      stadium_camera_lowered:true,
      player_proportion_polish:true,
      catcher_umpire_pose_polish:true,
      lighting_rebalance:true,
      field_mow_pattern:true,
      predictive_authority:false,
      aegis_weight:0,
      release_eligible:false
    };
  };

  return SceneClass;
}
