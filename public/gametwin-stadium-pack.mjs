export const GAMETWIN_STADIUM_PACK_VERSION='1.7.0';
function addMesh(THREE,group,geo,mat,pos,rot=[0,0,0],shadow=true){const m=new THREE.Mesh(geo,mat);m.position.set(...pos);m.rotation.set(...rot);m.castShadow=shadow;m.receiveShadow=shadow;group.add(m);return m;}
function ownMat(THREE,color,rough=.72,metal=.03){const m=new THREE.MeshPhysicalMaterial({color,roughness:rough,metalness:metal,clearcoat:metal>.2?.15:.02});m.userData.gametwinStadiumPack=true;return m;}

export function buildGenericStadiumModules(THREE,group,{materials,quality='medium',profile={}}={}){
  const low=quality==='low',high=quality==='high',created=[];
  const concrete=materials?.concrete||ownMat(THREE,0x1b2c38),metal=materials?.metal||ownMat(THREE,0xb7c4cd,.3,.7),dark=ownMat(THREE,0x07131d,.48,.05),seat=ownMat(THREE,0x18364a,.68),padding=ownMat(THREE,0x0c405d,.5,.03),glass=ownMat(THREE,0x1f88b2,.12,.08);glass.transparent=true;glass.opacity=.38;
  // Dugouts
  for(const side of [-1,1]){
    created.push(addMesh(THREE,group,new THREE.BoxGeometry(76,10,18),dark,[side*86,5,23],[0,side*.14,0]));
    created.push(addMesh(THREE,group,new THREE.BoxGeometry(70,1,13),concrete,[side*86,.5,16],[0,side*.14,0]));
    if(!low)for(let i=-2;i<=2;i++)created.push(addMesh(THREE,group,new THREE.BoxGeometry(9,1.2,2.5),seat,[side*(86+i*7),2.1,22],[0,side*.14,0]));
  }
  // Bullpen zones beyond foul lines.
  for(const side of [-1,1]){
    created.push(addMesh(THREE,group,new THREE.BoxGeometry(62,.35,18),concrete,[side*215,.2,-165],[0,side*.18,0],false));
    const mound=addMesh(THREE,group,new THREE.CylinderGeometry(5.5,6,.42,24),materials?.dirt||concrete,[side*215,.22,-165]);created.push(mound);
  }
  // Foul poles with simple mesh flags.
  for(const side of [-1,1]){
    created.push(addMesh(THREE,group,new THREE.CylinderGeometry(.42,.42,68,8),metal,[side*236,34,-330]));
    created.push(addMesh(THREE,group,new THREE.BoxGeometry(6,9,.18),padding,[side*233,59,-330]));
  }
  // Center-field video board + ribbon panel.
  const board=addMesh(THREE,group,new THREE.BoxGeometry(high?150:120,58,5),dark,[0,64,-445]);created.push(board);
  const screen=addMesh(THREE,group,new THREE.PlaneGeometry(high?139:110,48),glass,[0,66,-442.3],[0,0,0],false);created.push(screen);
  // Concourse ribbon rings add depth to the bowl.
  if(!low)for(const [r,y] of [[470,36],[518,65]])for(let deg=-58;deg<=58;deg+=high?6:10){const a=deg*Math.PI/180,x=Math.sin(a)*r,z=-Math.cos(a)*r;const ribbon=addMesh(THREE,group,new THREE.BoxGeometry(high?46:58,2.3,3),padding,[x,y,z],[0,a,0],false);created.push(ribbon);}
  // Lighting trusses / towers.
  const towers=high?[[-275,118,-320],[275,118,-320],[-235,108,-75],[235,108,-75]]:[[-265,110,-300],[265,110,-300]];
  for(const [x,y,z] of towers){created.push(addMesh(THREE,group,new THREE.BoxGeometry(4,y,4),metal,[x,y/2,z]));const bar=addMesh(THREE,group,new THREE.BoxGeometry(46,4,3),metal,[x,y,z]);created.push(bar);if(!low)for(let i=-4;i<=4;i++){const lamp=addMesh(THREE,group,new THREE.BoxGeometry(3.6,2.2,1.2),glass,[x+i*4.8,y,z+2],[],false);created.push(lamp);}}
  // Backstop / safety glass zone behind plate.
  if(high){created.push(addMesh(THREE,group,new THREE.BoxGeometry(100,20,.6),glass,[0,14,42],[0,0,0],false));}
  // v1.5 broadcast-fidelity modules: batter's eye, camera wells and premium rail geometry.
  created.push(addMesh(THREE,group,new THREE.BoxGeometry(high?120:96,42,8),dark,[0,30,-398],[0,0,0]));
  for(const side of [-1,1]){created.push(addMesh(THREE,group,new THREE.BoxGeometry(18,5,10),dark,[side*28,2.8,31],[0,side*.08,0]));if(!low)created.push(addMesh(THREE,group,new THREE.CylinderGeometry(.35,.35,46,8),metal,[side*48,23,38]));}
  if(high)for(const side of [-1,1])for(let i=0;i<5;i++)created.push(addMesh(THREE,group,new THREE.BoxGeometry(14,.7,.7),metal,[side*(70+i*15),8+i*.35,34+i*2],[0,side*.08,0],false));
  // v1.7 depth layers: fascia, vomitory portals and layered concourse silhouettes.
  if(!low){for(const r of [438,486,534])for(let deg=-58;deg<=58;deg+=high?8:14){const a=deg*Math.PI/180,x=Math.sin(a)*r,z=-Math.cos(a)*r;created.push(addMesh(THREE,group,new THREE.BoxGeometry(high?32:44,3.2,5),dark,[x,28+(r-438)*.62,z],[0,a,0],false));}}
  if(high){for(const side of [-1,1])for(let i=0;i<4;i++){const x=side*(125+i*62),z=48+i*14;created.push(addMesh(THREE,group,new THREE.BoxGeometry(24,13,18),dark,[x,7,z],[0,side*.42,0],false));}}
  group.userData.gametwinStadiumPackVersion=GAMETWIN_STADIUM_PACK_VERSION;
  group.userData.gametwinStadiumModules=created.length;
  return {version:GAMETWIN_STADIUM_PACK_VERSION,count:created.length,high_detail:high};
}
