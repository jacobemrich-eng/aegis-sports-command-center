export const GAMETWIN_VISUAL_FIDELITY_VERSION='2.1.2';

const PATCH_FLAG=Symbol.for('aegis.gametwin.visual_fidelity.v2.1.2');
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number(n)||0));

function roleOf(rig){
  return String(rig?.userData?.role||'fielder').toLowerCase();
}

function addHumanDetail(rig,THREE){
  if(!rig||rig.userData?.gametwinVisualFidelity212)return;
  rig.userData.gametwinVisualFidelity212=true;

  const role=roleOf(rig);
  const direct=(rig.hips?.children||[]).filter(Boolean);
  const meshes=direct.filter(o=>o?.isMesh);
  const capsules=meshes.filter(o=>o.geometry?.type==='CapsuleGeometry');
  const spheres=meshes.filter(o=>o.geometry?.type==='SphereGeometry')
    .sort((a,b)=>(a.position?.y||0)-(b.position?.y||0));
  const torso=capsules[0]||null;
  const head=spheres[0]||null;

  // Reduce the toy-cylinder read: narrower torso, less bulky limbs, more natural spacing.
  if(torso)torso.scale.set(.78,1.08,.82);
  if(rig.leftShoulder){
    rig.leftShoulder.position.x=-.98;
    rig.leftShoulder.scale.set(.86,1.03,.86);
  }
  if(rig.rightShoulder){
    rig.rightShoulder.position.x=.98;
    rig.rightShoulder.scale.set(.86,1.03,.86);
  }
  if(rig.leftHip){
    rig.leftHip.position.x=-.43;
    rig.leftHip.scale.set(.84,1.08,.84);
  }
  if(rig.rightHip){
    rig.rightHip.position.x=.43;
    rig.rightHip.scale.set(.84,1.08,.84);
  }

  // Waist/belt break gives the torso a more human silhouette.
  if(rig.hips&&!rig.userData.gametwinWaist212){
    const waistMat=(rig.uniformMaterial?.clone?.())||
      new THREE.MeshPhysicalMaterial({color:0xdde5eb,roughness:.72,metalness:0});
    waistMat.roughness=.78;
    waistMat.metalness=0;
    waistMat.userData={...(waistMat.userData||{}),gametwinVisualOnly:true};
    const waist=new THREE.Mesh(new THREE.CylinderGeometry(.78,.86,.34,16),waistMat);
    waist.position.set(0,.02,0);
    waist.castShadow=true;
    waist.name='GameTwinVisualWaist212';
    rig.hips.add(waist);
    rig.userData.gametwinWaist212=true;
  }

  // Add small hands to prevent arms from ending as blunt capsules.
  const skinMat=head?.material||new THREE.MeshPhysicalMaterial({
    color:0xe9c09e,roughness:.68,metalness:0
  });
  for(const arm of [rig.leftShoulder,rig.rightShoulder]){
    if(!arm||arm.userData?.gametwinHand212)continue;
    const hand=new THREE.Mesh(new THREE.SphereGeometry(.235,12,8),skinMat);
    hand.position.set(0,-2.18,.02);
    hand.scale.set(.86,1.05,.78);
    hand.castShadow=true;
    hand.name='GameTwinVisualHand212';
    arm.add(hand);
    arm.userData.gametwinHand212=true;
  }

  // Glove silhouette for defenders/pitchers/catchers.
  if(['fielder','pitcher','catcher'].includes(role)&&rig.leftShoulder&&!rig.userData.gametwinGlove212){
    const gloveMat=new THREE.MeshPhysicalMaterial({
      color:0x7b4a2d,roughness:.58,metalness:0,clearcoat:.06
    });
    gloveMat.userData={gametwinVisualOnly:true};
    const glove=new THREE.Mesh(new THREE.SphereGeometry(.34,12,8),gloveMat);
    glove.position.set(-.03,-2.22,.18);
    glove.scale.set(1.22,.78,.58);
    glove.rotation.z=.18;
    glove.castShadow=true;
    glove.name='GameTwinVisualGlove212';
    rig.leftShoulder.add(glove);
    rig.userData.gametwinGlove212=true;
  }

  // Remove floating labels that make the scene read like a debug view.
  if(rig.nameTag){
    if(['fielder','runner','catcher','umpire'].includes(role)){
      rig.nameTag.visible=false;
    }else{
      rig.nameTag.position.y=7.25;
      rig.nameTag.scale.set(4.6,1.05,1);
    }
  }

  // Small role-level scale corrections.
  const scaleFactor=
    role==='batter'?.94:
    role==='pitcher'?.96:
    role==='catcher'?.92:
    role==='umpire'?.93:
    1;
  if(scaleFactor!==1){
    const sx=Math.sign(rig.scale?.x||1)||1;
    rig.scale.set(Math.abs(rig.scale.x||1)*scaleFactor*sx,
                  Math.abs(rig.scale.y||1)*scaleFactor,
                  Math.abs(rig.scale.z||1)*scaleFactor);
  }
}

function normalizePlateCluster(scene){
  const batter=scene?.batterRig;
  const catcher=scene?.catcherRig;
  const umpire=scene?.umpireRig;
  if(!batter||!catcher||!umpire)return;

  const left=String(batter.userData?.handedness||'R').toUpperCase()==='L';
  batter.position.x=left?4.55:-4.55;
  batter.position.y=.15;
  batter.position.z=.45;

  catcher.position.set(0,.18,4.15);
  umpire.position.set(.08,.20,7.15);

  catcher.rotation.y=0;
  umpire.rotation.y=0;
}

function addFieldDepth(scene,THREE){
  if(!scene?.worldGroup||scene.worldGroup.userData?.gametwinFieldDepth212)return;
  scene.worldGroup.userData.gametwinFieldDepth212=true;

  const group=new THREE.Group();
  group.name='GameTwinFieldDepth212';
  group.userData.gametwinVisualOnly=true;

  // Restore the inner infield grass so the whole diamond no longer reads as one flat dirt plate.
  if(scene.materials?.grass){
    const infieldGrass=new THREE.Mesh(
      new THREE.CircleGeometry(49,64),
      scene.materials.grass
    );
    infieldGrass.rotation.x=-Math.PI/2;
    infieldGrass.position.set(0,.025,-63.64);
    infieldGrass.receiveShadow=true;
    infieldGrass.name='GameTwinInnerInfieldGrass212';
    group.add(infieldGrass);
  }

  // Stronger home-plate dirt halo.
  const dirtMat=new THREE.MeshPhysicalMaterial({
    color:0xa4673d,roughness:.98,metalness:0
  });
  dirtMat.userData={gametwinVisualOnly:true};
  const homeDirt=new THREE.Mesh(new THREE.CircleGeometry(12.5,48),dirtMat);
  homeDirt.rotation.x=-Math.PI/2;
  homeDirt.position.set(0,.038,-.35);
  homeDirt.receiveShadow=true;
  group.add(homeDirt);

  // Batter boxes.
  const chalk=new THREE.LineBasicMaterial({
    color:0xf4f2df,transparent:true,opacity:.86
  });
  const rect=(x1,x2,z1,z2)=>{
    const pts=[
      new THREE.Vector3(x1,.085,z1),
      new THREE.Vector3(x2,.085,z1),
      new THREE.Vector3(x2,.085,z2),
      new THREE.Vector3(x1,.085,z2),
      new THREE.Vector3(x1,.085,z1)
    ];
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      chalk
    );
  };
  group.add(rect(-7.1,-3.15,-2.75,4.35));
  group.add(rect(3.15,7.1,-2.75,4.35));

  // A subtle mound landing ring gives depth without changing simulation geometry.
  const moundRingMat=new THREE.MeshBasicMaterial({
    color:0xc98a55,transparent:true,opacity:.30,depthWrite:false
  });
  const moundRing=new THREE.Mesh(
    new THREE.RingGeometry(8.6,10.2,40),
    moundRingMat
  );
  moundRing.rotation.x=-Math.PI/2;
  moundRing.position.set(0,.72,-60.5);
  group.add(moundRing);

  scene.worldGroup.add(group);
}

function tuneLighting(scene){
  if(!scene)return;
  if(scene.renderer)scene.renderer.toneMappingExposure=scene.isNight?.86:.93;
  if(scene.ambient)scene.ambient.intensity=scene.isNight?.94:1.14;
  if(scene.sun)scene.sun.intensity=scene.isNight?.14:2.34;
  if(scene.fillLight)scene.fillLight.intensity=scene.isNight?1.00:.64;
  if(scene.gtPolishRim)scene.gtPolishRim.intensity=scene.isNight?.30:.20;

  if(Array.isArray(scene.stadiumLights)){
    for(const light of scene.stadiumLights){
      if(light?.isLight&&Number.isFinite(light.intensity)){
        light.intensity=Math.min(light.intensity,scene.isNight?4.7:2.2);
      }
    }
  }
}

export function applyGameTwinVisualFidelity(SceneClass,THREE){
  const proto=SceneClass?.prototype;
  if(!proto||proto[PATCH_FLAG])return SceneClass;
  proto[PATCH_FLAG]=true;

  const baseCameraPreset=proto.cameraPreset;
  proto.cameraPreset=function(mode='broadcast'){
    // Broadcast: true center-field TV framing.
    if(mode==='broadcast')return {
      pos:[0,18.6,-104],
      target:[0,3.75,1.1],
      fov:36.5
    };

    // Batter: wider OTS view so hitter no longer fills/blocks the frame.
    if(mode==='batter')return {
      pos:[-10.8,7.8,15.0],
      target:[0,3.7,-61.0],
      fov:50
    };

    // Pitcher: closer/lower mound camera with plate still clearly visible.
    if(mode==='pitcher')return {
      pos:[4.0,9.8,-78.5],
      target:[0,3.6,1.1],
      fov:42
    };

    // Stadium: upper-deck establishing shot instead of drone/surveillance height.
    if(mode==='stadium')return {
      pos:[0,98,178],
      target:[0,6.2,-152],
      fov:47
    };

    // Ball track: lower and more cinematic.
    if(mode==='ball_track')return {
      pos:[0,49,102],
      target:[0,12,-184],
      fov:46
    };

    if(mode==='plate_low')return {
      pos:[-11.8,5.6,18.8],
      target:[0,3.35,-62],
      fov:47
    };

    return baseCameraPreset.call(this,mode);
  };

  const baseBuildActors=proto.buildActors;
  proto.buildActors=function(){
    const out=baseBuildActors.call(this);
    for(const rig of this.allRigs?.()||[])addHumanDetail(rig,THREE);
    normalizePlateCluster(this);
    return out;
  };

  const baseUpdateNames=proto.updateNames;
  if(typeof baseUpdateNames==='function'){
    proto.updateNames=function(...args){
      const out=baseUpdateNames.apply(this,args);
      for(const rig of this.allRigs?.()||[])addHumanDetail(rig,THREE);
      normalizePlateCluster(this);
      return out;
    };
  }

  const baseBuildField=proto.buildField;
  proto.buildField=function(field={}){
    const out=baseBuildField.call(this,field);
    addFieldDepth(this,THREE);
    return out;
  };

  const baseAddLights=proto.addLights;
  proto.addLights=function(){
    const out=baseAddLights.call(this);
    tuneLighting(this);
    return out;
  };

  const baseApplyEnvironment=proto.applyEnvironment;
  proto.applyEnvironment=function(){
    const out=baseApplyEnvironment.call(this);
    tuneLighting(this);
    if(this.scene?.fog){
      this.scene.fog.near=Math.max(250,Number(this.scene.fog.near)||250);
      this.scene.fog.far=Math.max(860,Number(this.scene.fog.far)||860);
    }
    return out;
  };

  const baseVisualStatus=proto.visualFidelityStatus;
  proto.visualFidelityStatus=function(){
    const base=typeof baseVisualStatus==='function'
      ?(baseVisualStatus.call(this)||{})
      :{};
    return {
      ...base,
      version:'2.1.2-visual-fidelity',
      visual_fidelity_pass:'broadcast-framing-player-proportions-field-depth',
      broadcast_centerfield_camera:true,
      batter_ots_camera:true,
      pitcher_mound_camera:true,
      stadium_upperdeck_camera:true,
      home_plate_collision_spacing:true,
      human_silhouette_pass:true,
      floating_debug_labels_reduced:true,
      inner_infield_grass:true,
      batter_boxes:true,
      lighting_integration:true,
      presentation_only:true,
      predictive_authority:false,
      aegis_weight:0,
      release_eligible:false
    };
  };

  return SceneClass;
}
