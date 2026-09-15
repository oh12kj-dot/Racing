import {buildWorld as buildFacilityWorld} from './world-suzuka-facilities.js';

// Circuit-wide Suzuka scenery layer. The existing world owns racing physics,
// barriers and pit geometry; this module adds visual-only landmarks around the
// complete lap so the circuit reads as Suzuka from TV, chase and helicopter cams.
export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildFacilityWorld(THREE,TRACK,settings,circuitName);
  if(String(circuitName||'').toUpperCase()!=='SUZUKA')return W;

  const total=W.total,wrap=f=>((f%1)+1)%1,root=new THREE.Group();
  root.name='SUZUKA_FULL_SCENE_RUNTIME';root.userData={owner:'runtime-suzuka-full-scene-v2',visualOnly:true};W.scene.add(root);
  const records=[],GROUND_Y=-.22,TRACK_LANDSCAPE_HALF=31.2;
  const trackPts=[];for(let i=0;i<1200;i++){const p=W.sample(total*i/1200).p;trackPts.push({x:p.x,z:p.z});}
  const minTrackDistSq=(x,z)=>{let best=Infinity;for(const p of trackPts){const dx=x-p.x,dz=z-p.z,d=dx*dx+dz*dz;if(d<best)best=d;}return best;};
  const safeLinear=(uf,offset,length,clearance=12)=>{const q=W.sample(wrap(uf)*total,offset),half=Math.max(1,length*.5);for(const k of[-1,-.5,0,.5,1]){const x=q.p.x+q.t.x*half*k,z=q.p.z+q.t.z*half*k;if(minTrackDistSq(x,z)<clearance*clearance)return false;}return true;};
  let groundedFarObjects=0,skippedUnsafeObjects=0,rejectedTrees=0;
  const concrete=new THREE.MeshStandardMaterial({color:0xc8ccca,roughness:.88});
  const concreteDark=new THREE.MeshStandardMaterial({color:0x6f7779,roughness:.88});
  const asphalt=new THREE.MeshStandardMaterial({color:0x45494a,roughness:.97});
  const metal=new THREE.MeshStandardMaterial({color:0x858d90,roughness:.48,metalness:.62});
  const dark=new THREE.MeshStandardMaterial({color:0x202527,roughness:.82});
  const glass=new THREE.MeshPhysicalMaterial({color:0x294956,roughness:.18,transparent:true,opacity:.72,metalness:.04,clearcoat:.35});
  const white=new THREE.MeshStandardMaterial({color:0xe9eae6,roughness:.80});
  const red=new THREE.MeshStandardMaterial({color:0xc92d31,roughness:.70});
  const green=new THREE.MeshStandardMaterial({color:0x315b38,roughness:.94});
  const green2=new THREE.MeshStandardMaterial({color:0x496d43,roughness:.94});
  const water=new THREE.MeshPhysicalMaterial({color:0x315e6c,roughness:.25,transparent:true,opacity:.78,metalness:.02});
  const yellow=new THREE.MeshStandardMaterial({color:0xd8b83b,roughness:.65});

  function anchor(uf,offset,name){const q=W.sample(wrap(uf)*total,offset),g=new THREE.Group();g.name=name;g.position.copy(q.p);const far=Math.abs(offset)>TRACK_LANDSCAPE_HALF;if(far){g.position.y=GROUND_Y;groundedFarObjects++;}g.rotation.y=Math.atan2(q.t.x,q.t.z);g.userData={sourceUF:wrap(uf),sourceOffset:offset,groundedToFlatTerrain:far};root.add(g);return g;}
  function mesh(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,name=''){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.receiveShadow=true;if(name)m.name=name;parent.add(m);return m;}
  function record(name,type,uf,offset,extra={}){records.push({name,type,uf,offset,...extra});}
  function simpleBuilding(name,uf,offset,width,height,length,mat=concrete){const g=anchor(uf,offset,`SUZUKA_${name}`);mesh(g,new THREE.BoxGeometry(width,height,length),mat,0,height*.5,0);mesh(g,new THREE.BoxGeometry(width+.5,.25,length+.5),white,0,height+.12,0);mesh(g,new THREE.BoxGeometry(.14,Math.min(1.7,height*.28),length*.72),glass,-width*.505,height*.63,0);record(name,'building',uf,offset);return g;}
  function grandstand(name,uf,offset,length=38,rows=5,side=1){if(!safeLinear(uf,offset,length,12)){skippedUnsafeObjects++;record(name,'grandstand-skipped',uf,offset,{reason:'track-clearance'});return null;}const g=anchor(uf,offset,`SUZUKA_${name}`);for(let r=0;r<rows;r++){const x=-side*r*1.75,y=.52+r*.74;mesh(g,new THREE.BoxGeometry(3.8,.42,length),r%2?concrete:concreteDark,x,y,0);for(let z=-length*.42;z<=length*.42;z+=5.4)mesh(g,new THREE.BoxGeometry(.10,.62,.10),metal,x-side*1.5,y+.48,z);}mesh(g,new THREE.BoxGeometry(7.0,.30,length+1.0),white,-side*(rows-1)*.95,rows*.76+1.2,0,0,0,-side*.10);record(name,'grandstand',uf,offset,{rows});return g;}
  function gate(name,uf,offset){const g=anchor(uf,offset,`SUZUKA_${name}`);mesh(g,new THREE.BoxGeometry(.7,5.5,.7),concreteDark,0,2.75,-5.5);mesh(g,new THREE.BoxGeometry(.7,5.5,.7),concreteDark,0,2.75,5.5);mesh(g,new THREE.BoxGeometry(.75,.8,12),dark,0,5.15,0);record(name,'gate',uf,offset);return g;}
  function cameraTower(name,uf,offset){if(!safeLinear(uf,offset,2,10.5)){skippedUnsafeObjects++;record(name,'camera-skipped',uf,offset,{reason:'track-clearance'});return;}const g=anchor(uf,offset,`SUZUKA_${name}`);mesh(g,new THREE.BoxGeometry(1.7,.22,1.7),metal,0,7,0);for(const [x,z] of[[-.65,-.65],[.65,-.65],[-.65,.65],[.65,.65]])mesh(g,new THREE.CylinderGeometry(.055,.07,7,6),metal,x,3.5,z);mesh(g,new THREE.BoxGeometry(.8,.45,.65),dark,0,7.42,0);record(name,'camera',uf,offset);}
  function marshalPost(name,uf,offset){if(!safeLinear(uf,offset,4.2,10.5)){skippedUnsafeObjects++;record(name,'marshal-skipped',uf,offset,{reason:'track-clearance'});return;}const g=anchor(uf,offset,`SUZUKA_${name}`);mesh(g,new THREE.BoxGeometry(2.8,1.1,3.8),concreteDark,0,.55,0);mesh(g,new THREE.BoxGeometry(3.2,.18,4.2),white,0,1.18,0);mesh(g,new THREE.BoxGeometry(.12,.9,2.2),yellow,-1.46,1.65,0);record(name,'marshal',uf,offset);}
  function bridge(name,uf){const g=anchor(uf,0,`SUZUKA_${name}`),half=(W.roadWidth||14.4)*.5+3.3;mesh(g,new THREE.BoxGeometry(.55,6.4,.55),metal,-half,3.2,0);mesh(g,new THREE.BoxGeometry(.55,6.4,.55),metal,half,3.2,0);mesh(g,new THREE.BoxGeometry(half*2+1,.65,1.0),dark,0,6.0,0);record(name,'bridge',uf,0);return g;}
  function pad(name,uf,offset,width,length){const g=anchor(uf,offset,`SUZUKA_${name}`);mesh(g,new THREE.BoxGeometry(width,.07,length),asphalt,0,.035,0);record(name,'area',uf,offset);return g;}

  // Spectator landmarks around the complete lap. Fractions follow the circuit
  // order: T1/T2 -> S curves -> Dunlop -> Degner -> Hairpin -> Spoon -> West
  // Straight -> 130R -> Chicane -> final corner. A whole-circuit clearance test
  // prevents a figure-eight neighbour from running through a grandstand.
  grandstand('FIRST_CORNER_GRANDSTAND',.035,-34,64,6,-1);
  grandstand('S_CURVE_GRANDSTAND',.105,34,46,5,1);
  grandstand('GYAKU_BANK_GRANDSTAND',.165,-31,38,5,-1);
  grandstand('DUNLOP_VIEWING',.215,35,32,4,1);
  grandstand('DEGNER_VIEWING',.305,-32,34,4,-1);
  grandstand('HAIRPIN_GRANDSTAND',.425,34,44,5,1);
  grandstand('SPOON_GRANDSTAND',.615,-38,52,5,-1);
  grandstand('WEST_STRAIGHT_VIEWING',.735,37,62,4,1);
  grandstand('130R_GRANDSTAND',.845,-35,46,5,-1);
  grandstand('CHICANE_GRANDSTAND',.925,34,58,6,1);

  // Named race-control and access landmarks documented on official Suzuka maps.
  simpleBuilding('WEST_CONTROL_TOWER',.695,45,8,9,13,concreteDark);
  gate('FIRST_CORNER_GATE',.055,-67);gate('GYAKU_BANK_GATE',.175,-70);gate('WEST_MOTORSPORTS_GATE',.535,72);gate('SPOON_GATE',.625,-76);gate('CHICANE_GATE',.925,70);
  bridge('S_CURVE_PEDESTRIAN_BRIDGE',.135);bridge('DEGNER_CROSSOVER_BRIDGE',.335);bridge('WEST_COURSE_BRIDGE',.705);bridge('CHICANE_SIGN_BRIDGE',.905);

  // The iconic Ferris wheel and the amusement-park/hotel campus give the east
  // side its recognizable skyline from helicopter and main-straight cameras.
  const wheel=anchor(.020,-132,'SUZUKA_FERRIS_WHEEL');
  mesh(wheel,new THREE.TorusGeometry(18,.62,8,48),white,0,20,0,0,Math.PI/2,0,'FERRIS_WHEEL_RING');
  mesh(wheel,new THREE.CylinderGeometry(.42,.62,19,8),metal,-7.0,8.8,0,0,0,-.42);mesh(wheel,new THREE.CylinderGeometry(.42,.62,19,8),metal,7.0,8.8,0,0,0,.42);
  mesh(wheel,new THREE.CylinderGeometry(.55,.55,4.5,10),metal,0,20,0,0,0,Math.PI/2);
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2,y=20+Math.cos(a)*18,z=Math.sin(a)*18;mesh(wheel,new THREE.BoxGeometry(2.0,1.55,1.45),i%3===0?red:i%3===1?yellow:white,0,y,z);}
  record('FERRIS_WHEEL','park',.020,-132,{iconic:true});
  const park=pad('SUZUKA_CIRCUIT_PARK',.045,-135,76,100);for(let i=0;i<9;i++){const x=-28+(i%3)*28,z=-32+Math.floor(i/3)*31;mesh(park,new THREE.CylinderGeometry(4.5,5.5,3.2,10),i%2?white:red,x,1.6,z);mesh(park,new THREE.ConeGeometry(6.2,4.2,10),i%2?red:yellow,x,5.25,z);}record('AMUSEMENT_RIDES','park',.045,-135);
  simpleBuilding('HOTEL_THE_MAIN',.075,-185,18,10,52,white);simpleBuilding('HOTEL_NORTH',.095,-175,15,7,38,concrete);simpleBuilding('HOTEL_WEST',.112,-165,15,7,34,concrete);simpleBuilding('HOTEL_SOUTH',.058,-178,15,7,38,concrete);
  const camp=pad('FAMILY_CAMP',.145,-145,72,82);for(let i=0;i<12;i++){const x=-28+(i%4)*18,z=-28+Math.floor(i/4)*27;mesh(camp,new THREE.ConeGeometry(4.1,3.0,4),i%2?white:green2,x,1.5,z,0,Math.PI*.25,0);}record('FAMILY_CAMP_TENTS','camp',.145,-145);
  simpleBuilding('STEC_TRAFFIC_EDUCATION_CENTER',.185,-145,24,6,58,concreteDark);
  gate('MAIN_GATE',.030,-205);

  // Fan-zone and west-course support areas.
  const ferrisFan=pad('FERRIS_WHEEL_FANZONE',.028,-92,50,64);for(let i=0;i<8;i++)mesh(ferrisFan,new THREE.BoxGeometry(5,2.6,4.2),i%2?red:white,-18+(i%4)*12,1.3,-16+Math.floor(i/4)*30);record('FERRIS_WHEEL_FANZONE_STALLS','fan-zone',.028,-92);
  const westFan=pad('WEST_FANZONE',.675,82,54,70);for(let i=0;i<10;i++)mesh(westFan,new THREE.BoxGeometry(4.5,2.4,4),i%3===0?yellow:i%2?white:red,-20+(i%5)*10,1.2,-17+Math.floor(i/5)*34);record('WEST_FANZONE_STALLS','fan-zone',.675,82);
  const parking=pad('WEST_COURSE_PARKING',.560,105,88,120);for(let i=0;i<36;i++){const x=-35+(i%6)*14,z=-48+Math.floor(i/6)*19;mesh(parking,new THREE.BoxGeometry(1.9,.85,4.1),i%4===0?red:i%4===1?white:i%4===2?dark:concreteDark,x,.47,z);}record('PARKED_VEHICLES','parking',.560,105,{count:36});

  // The pond is a useful aerial landmark on the official course guide.
  const pond=anchor(.515,92,'SUZUKA_POND');mesh(pond,new THREE.CircleGeometry(23,32),water,0,.04,0,-Math.PI/2,0,0);record('POND','landscape',.515,92);

  // Continuous service-road hints on both sides make the remote parts of the lap
  // feel like an operated circuit rather than an isolated ribbon of asphalt.
  for(let i=0;i<32;i++){
    const uf=(i+.5)/32,side=i%2?1:-1,off=side*(26+(i%5)*2.3);
    if(!safeLinear(uf,off,34,11.5)){skippedUnsafeObjects++;record(`SERVICE_ROAD_${i+1}`,'service-road-skipped',uf,off,{reason:'track-clearance'});continue;}
    const g=anchor(uf,off,`SUZUKA_SERVICE_ROAD_${i+1}`);mesh(g,new THREE.BoxGeometry(4.2,.045,34),asphalt,0,.023,0);record(`SERVICE_ROAD_${i+1}`,'service-road',uf,off);
  }

  // Marshal and broadcast infrastructure distributed around every sector.
  const marshalFractions=[.025,.075,.125,.18,.235,.29,.345,.405,.465,.525,.585,.645,.705,.765,.825,.875,.925,.970];
  marshalFractions.forEach((uf,i)=>marshalPost(`MARSHAL_POST_${String(i+1).padStart(2,'0')}`,uf,(i%2?1:-1)*(18+(i%3)*2.5)));
  const cameraFractions=[.045,.115,.205,.285,.365,.445,.535,.625,.715,.805,.885,.955];
  cameraFractions.forEach((uf,i)=>cameraTower(`TV_CAMERA_TOWER_${String(i+1).padStart(2,'0')}`,uf,(i%2?1:-1)*(24+(i%4)*2)));

  // Lightweight instancing provides the wooded Suzuka perimeter without hundreds
  // of individual draw calls. Candidates are checked against every centre-line
  // sample, not just the segment that spawned them, because Suzuka is a figure 8.
  const treeTarget=180,treeData=[];
  for(let i=0;i<treeTarget*4&&treeData.length<treeTarget;i++){
    let uf=(i+.31)/(treeTarget*1.35);uf=wrap(uf);if(uf>.965||uf<.055)uf=.055+(uf%.91);const side=i%2?1:-1,offset=side*(42+(i*17%29)),q=W.sample(wrap(uf)*total,offset),scale=.78+((i*37)%31)/100;
    if(minTrackDistSq(q.p.x,q.p.z)<19*19){rejectedTrees++;continue;}
    treeData.push({q,offset,scale,seed:i});
  }
  const treeCount=treeData.length,trunkGeo=new THREE.CylinderGeometry(.16,.24,2.4,5),crownGeo=new THREE.ConeGeometry(1.75,4.7,6);
  const trunks=new THREE.InstancedMesh(trunkGeo,dark,treeCount),crowns=new THREE.InstancedMesh(crownGeo,green,treeCount),dummy=new THREE.Object3D();
  trunks.name='SUZUKA_PERIMETER_TREE_TRUNKS';crowns.name='SUZUKA_PERIMETER_TREE_CROWNS';
  treeData.forEach(({q,offset,scale,seed},i)=>{
    const baseY=Math.abs(offset)>TRACK_LANDSCAPE_HALF?GROUND_Y:q.p.y;
    dummy.position.set(q.p.x,baseY+1.2*scale,q.p.z);dummy.rotation.set(0,(seed*2.399)%6.28,0);dummy.scale.set(scale,scale,scale);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    dummy.position.set(q.p.x,baseY+4.05*scale,q.p.z);dummy.rotation.set(0,(seed*1.731)%6.28,0);dummy.scale.set(scale,scale,scale);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate=true;crowns.instanceMatrix.needsUpdate=true;root.add(trunks,crowns);record('PERIMETER_TREE_BELT','landscape',.5,0,{instances:treeCount,rejected:rejectedTrees,minTrackClearance:19});

  W.scene.updateMatrixWorld(true);
  const byType=records.reduce((a,x)=>(a[x.type]=(a[x.type]||0)+1,a),{}),names=records.map(x=>x.name);
  W.suzukaFullScene={root,owner:'runtime-suzuka-full-scene-v2',visualOnly:true,count:records.length,byType,landmarks:records.map(x=>({...x})),treeInstances:treeCount,treeRejected:rejectedTrees,groundedFarObjects,skippedUnsafeObjects,minTreeTrackClearance:19,courseCoverage:{start:0,end:1,sectors:18}};
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{const a=priorAudit?priorAudit():{};return{...a,version:'runtime-2026.09.15-r14',suzukaFullScene:{owner:W.suzukaFullScene.owner,count:records.length,byType:{...byType},treeInstances:treeCount,treeRejected:rejectedTrees,groundedFarObjects,skippedUnsafeObjects,minTreeTrackClearance:19,names},notes:[...(a.notes||[]),'Circuit-wide Suzuka scenery now uses whole-track clearance checks for trees and repeated trackside objects, and far facilities are grounded to the flat terrain instead of inheriting bridge elevation.']};};
  W.circuitAudit=W.auditCircuit();
  return W;
}