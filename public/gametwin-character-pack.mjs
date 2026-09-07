export const GAMETWIN_CHARACTER_PACK_VERSION='1.7.0';

export const CHARACTER_PROFILES=Object.freeze({
  batter:{height:1.00,shoulders:1.04,role:'batter',helmet:true,bat:true,glove:false,catcherGear:false,umpireGear:false},
  pitcher:{height:1.02,shoulders:1.00,role:'pitcher',helmet:false,bat:false,glove:true,catcherGear:false,umpireGear:false},
  fielder:{height:1.00,shoulders:1.00,role:'fielder',helmet:false,bat:false,glove:true,catcherGear:false,umpireGear:false},
  runner:{height:.99,shoulders:.98,role:'runner',helmet:true,bat:false,glove:false,catcherGear:false,umpireGear:false},
  catcher:{height:.98,shoulders:1.06,role:'catcher',helmet:true,bat:false,glove:true,catcherGear:true,umpireGear:false},
  umpire:{height:1.01,shoulders:1.08,role:'umpire',helmet:false,bat:false,glove:false,catcherGear:false,umpireGear:true}
});

export const ROLE_ANIMATION_REQUIREMENTS=Object.freeze({
  batter:['idle','swing','run'],pitcher:['idle','pitch'],fielder:['idle','run','field','throw','catch'],runner:['idle','run'],catcher:['idle','catch','throw'],umpire:['idle']
});

export const ROLE_ANIMATION_PREFERRED=Object.freeze({
  batter:['stance_left','stance_right','swing_load','swing_contact','swing_follow','trot','celebrate','react_strikeout','react_out'],
  pitcher:['pitch_set','pitch_lift','pitch_drive','pitch_follow','celebrate'],
  fielder:['throw_infield','throw_outfield','celebrate'],
  runner:['slide','trot','celebrate'],
  catcher:['receive','throw_catcher','celebrate'],
  umpire:['stance_left','stance_right']
});

export const ANIMATION_ALIASES=Object.freeze({
  idle:['idle','ready','stance'],stance_left:['stance_left','stance_l','left_stance','idle'],stance_right:['stance_right','stance_r','right_stance','idle'],
  pitch:['pitch','pitching','throw_pitch'],pitch_set:['pitch_set','set','pitch'],pitch_lift:['pitch_lift','leg_lift','pitch'],pitch_drive:['pitch_drive','delivery','pitch'],pitch_follow:['pitch_follow','follow_through','pitch'],
  swing:['swing','bat','hit'],swing_load:['swing_load','load','swing'],swing_contact:['swing_contact','contact','swing'],swing_follow:['swing_follow','follow_through','swing'],
  run:['run','sprint','jog'],trot:['trot','jog','run'],slide:['slide','feet_first_slide','run'],field:['field','fielding','ground_ball'],
  throw:['throw','relay','release'],throw_infield:['throw_infield','infield_throw','throw'],throw_outfield:['throw_outfield','crow_hop','throw'],throw_catcher:['throw_catcher','catcher_throw','throw'],
  catch:['catch','receive'],receive:['receive','catcher_receive','catch'],tag:['tag','tag_play'],celebrate:['celebrate','reaction_win','idle'],react_strikeout:['react_strikeout','strikeout_reaction','idle'],react_out:['react_out','out_reaction','idle'],crouch:['crouch','catcher_idle'],mask:['mask','umpire_idle']
});

function mat(THREE,color,{roughness=.55,metalness=.02,clearcoat=0}={}){return new THREE.MeshPhysicalMaterial({color,roughness,metalness,clearcoat,clearcoatRoughness:.18,sheen:roughness>.5?.12:0,sheenRoughness:.75});}
function mesh(THREE,geo,material,parent,pos=[0,0,0],rot=[0,0,0],shadow=true){const m=new THREE.Mesh(geo,material);m.position.set(...pos);m.rotation.set(...rot);m.castShadow=shadow;m.receiveShadow=shadow;parent.add(m);return m;}

export function roleProfile(role='fielder'){return CHARACTER_PROFILES[role]||CHARACTER_PROFILES.fielder;}

export function roleAssetKind(role='fielder'){
  if(role==='catcher')return 'catcher';
  if(role==='umpire')return 'umpire';
  if(role==='pitcher')return 'pitcher';
  if(role==='batter')return 'batter';
  if(role==='runner')return 'runner';
  return 'fielder';
}

export function createUniformPalette(THREE,{primary=0x55c9ff,secondary=0xf4f7fb,accent=0x0c1722,skin=0xf1c9a5,umpire=false}={}){
  return {
    jersey:mat(THREE,umpire?0x10161d:primary,{roughness:.66,clearcoat:.03}),
    trim:mat(THREE,umpire?0x2a3037:secondary,{roughness:.58}),
    pants:mat(THREE,umpire?0x171c22:0xe6ebef,{roughness:.77}),
    socks:mat(THREE,accent,{roughness:.68}),
    skin:mat(THREE,skin,{roughness:.76}),
    leather:mat(THREE,0x70462f,{roughness:.63,clearcoat:.07}),
    gear:mat(THREE,0x111a24,{roughness:.28,metalness:.08,clearcoat:.72}),
    metal:mat(THREE,0xb7c4cd,{roughness:.3,metalness:.72}),
    rubber:mat(THREE,0x080c10,{roughness:.58})
  };
}

export function decorateProceduralPlayer(THREE,rig,{role='fielder',primary=0x55c9ff,secondary=0xf4f7fb,accent=0x0c1722,skin=0xf1c9a5,number=''}={}){
  const p=roleProfile(role),pal=createUniformPalette(THREE,{primary,secondary,accent,skin,umpire:role==='umpire'});rig.userData.characterRole=role;rig.userData.characterPackVersion=GAMETWIN_CHARACTER_PACK_VERSION;
  const hips=rig.hips||rig;
  // jersey shoulder piping and belt create visual separation from the older capsule look.
  mesh(THREE,new THREE.TorusGeometry(1.02,.055,6,22),pal.trim,hips,[0,1.85,0],[Math.PI/2,0,0]);
  mesh(THREE,new THREE.TorusGeometry(.82,.06,6,22),pal.gear,hips,[0,.15,0],[Math.PI/2,0,0]);
  // simple jersey number plate - custom/generic, no team marks.
  const plate=mesh(THREE,new THREE.BoxGeometry(.72,.78,.045),pal.trim,hips,[0,1.15,.94],[0,0,0],false);plate.userData.jerseyNumber=String(number||'');
  // socks / lower-leg contrast.
  for(const leg of [rig.leftHip,rig.rightHip])if(leg)mesh(THREE,new THREE.CylinderGeometry(.31,.29,.8,10),pal.socks,leg,[0,-2.05,0]);
  if(p.glove&&rig.leftShoulder){const glove=mesh(THREE,new THREE.SphereGeometry(.42,10,8),pal.leather,rig.leftShoulder,[0,-2.05,.08]);glove.scale.set(1.25,.72,.46);rig.glove=glove;}
  if(p.helmet&&rig.hips){const brim=mesh(THREE,new THREE.BoxGeometry(.85,.08,.38),pal.gear,rig.hips,[0,3.68,.56],[.08,0,0]);rig.helmetBrim=brim;}
  if(role==='catcher'){
    const chest=mesh(THREE,new THREE.BoxGeometry(1.75,2.25,.32),pal.gear,hips,[0,1.25,.92]);chest.rotation.x=-.08;rig.chestProtector=chest;
    for(const leg of [rig.leftHip,rig.rightHip])if(leg){const shin=mesh(THREE,new THREE.BoxGeometry(.5,1.45,.22),pal.gear,leg,[0,-1.55,.42]);shin.rotation.x=.05;}
    const mask=mesh(THREE,new THREE.SphereGeometry(.82,10,8),pal.metal,hips,[0,3.46,.18]);mask.scale.set(1.03,1.02,.82);mask.material.wireframe=true;rig.mask=mask;
  }else if(role==='umpire'){
    const chest=mesh(THREE,new THREE.BoxGeometry(1.82,2.05,.28),pal.gear,hips,[0,1.35,.88]);rig.chestProtector=chest;
    const mask=mesh(THREE,new THREE.SphereGeometry(.8,10,8),pal.metal,hips,[0,3.5,.16]);mask.scale.set(1.02,1,.8);mask.material.wireframe=true;rig.mask=mask;
  }
  if(role==='batter'&&rig.bat){rig.bat.material=mat(THREE,0xc29a68,{roughness:.34,clearcoat:.22});}
  // v1.5 high-fidelity procedural fallback details: hands, forearm guards, knee separation and cleat soles.
  for(const arm of [rig.leftShoulder,rig.rightShoulder])if(arm){const hand=mesh(THREE,new THREE.SphereGeometry(.26,12,9),pal.skin,arm,[0,-2.03,0]);hand.scale.set(.9,1.08,.72);}
  for(const leg of [rig.leftHip,rig.rightHip])if(leg){const knee=mesh(THREE,new THREE.SphereGeometry(.31,10,8),pal.pants,leg,[0,-1.27,0]);knee.scale.set(1.03,.82,.9);const sole=mesh(THREE,new THREE.BoxGeometry(.58,.12,.92),pal.rubber,leg,[0,-2.78,.34]);sole.rotation.x=.02;}
  if(role==='batter'&&rig.leftShoulder){const guard=mesh(THREE,new THREE.BoxGeometry(.48,.7,.16),pal.gear,rig.leftShoulder,[0,-1.3,.34]);guard.rotation.x=-.08;rig.elbowGuard=guard;}
  rig.scale.multiplyScalar(p.height||1);
  return rig;
}

export function resolveAnimationName(available,name){
  const set=new Set((available||[]).map(x=>String(x).toLowerCase()));
  for(const candidate of ANIMATION_ALIASES[name]||[name])if(set.has(candidate))return candidate;
  return null;
}
