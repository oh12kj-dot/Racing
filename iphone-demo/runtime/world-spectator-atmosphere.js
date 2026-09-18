import {buildWorld as buildPlacedWorld} from './world-placement-validator.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildPlacedWorld(THREE,TRACK,settings,circuitName),root=new THREE.Group();root.name='SPECTATOR_ATMOSPHERE_V2';W.scene.add(root);
  const total=Math.max(1,Number(W.total)||1),mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760;
  const crowdCount=mobile?72:132,cameraCount=mobile?5:9,marshalCount=mobile?8:14,serviceCount=mobile?2:4;
  const diagnostics={owner:'runtime-spectator-atmosphere-v2',crowdCount:0,cameraCount:0,marshalCount:0,serviceCount:0};
  const skin=new THREE.MeshStandardMaterial({color:0xc89a78,roughness:.9}),cloth=new THREE.MeshStandardMaterial({color:0x334d6a,roughness:.86}),orange=new THREE.MeshStandardMaterial({color:0xff6517,roughness:.82}),dark=new THREE.MeshStandardMaterial({color:0x1c2329,roughness:.78}),white=new THREE.MeshStandardMaterial({color:0xe5e7e8,roughness:.72}),glass=new THREE.MeshStandardMaterial({color:0x263b48,roughness:.28,metalness:.12});
  const crowdBodyGeo=new THREE.CapsuleGeometry(.14,.42,2,4),crowdHeadGeo=new THREE.SphereGeometry(.12,5,4),crowdBodies=new THREE.InstancedMesh(crowdBodyGeo,cloth,crowdCount),crowdHeads=new THREE.InstancedMesh(crowdHeadGeo,skin,crowdCount),dummy=new THREE.Object3D();
  crowdBodies.name='SPECTATOR_CROWD_BODIES_V2';crowdHeads.name='SPECTATOR_CROWD_HEADS_V2';root.add(crowdBodies,crowdHeads);
  for(let i=0;i<crowdCount;i++){
    const uf=.045+((i*.61803398875)%1)*.91,side=i%2?1:-1,offset=side*(30+(i%5)*2.1),q=W.sample(uf*total,offset),scale=.82+(i%7)*.025;
    dummy.position.set(q.p.x,q.p.y+.37*scale,q.p.z);dummy.rotation.set(0,Math.atan2(q.t.x,q.t.z)+(side>0?Math.PI:0),0);dummy.scale.set(scale,scale,scale);dummy.updateMatrix();crowdBodies.setMatrixAt(i,dummy.matrix);
    dummy.position.y=q.p.y+.82*scale;dummy.updateMatrix();crowdHeads.setMatrixAt(i,dummy.matrix);diagnostics.crowdCount++;
  }
  crowdBodies.instanceMatrix.needsUpdate=true;crowdHeads.instanceMatrix.needsUpdate=true;

  const flags=[];
  function flagPost(s,side,index){const q=W.sample(s,side*(18+(index%3)*2)),g=new THREE.Group();g.name=`MARSHAL_POST_V2_${index}`;g.position.copy(q.p);g.rotation.y=Math.atan2(q.t.x,q.t.z);root.add(g);const booth=new THREE.Mesh(new THREE.BoxGeometry(1.8,1.25,1.2),dark);booth.position.y=.63;g.add(booth);const m=new THREE.Mesh(new THREE.CapsuleGeometry(.13,.35,2,4),orange);m.position.set(.65,.72,.55);g.add(m);const pole=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,1.65,5),white);pole.position.set(.88,1.45,.55);g.add(pole);const fm=new THREE.MeshBasicMaterial({color:0x42d46a,side:THREE.DoubleSide}),flag=new THREE.Mesh(new THREE.PlaneGeometry(.65,.38),fm);flag.position.set(1.18,2.0,.55);g.add(flag);flags.push({flag,seed:index});diagnostics.marshalCount++;}
  for(let i=0;i<marshalCount;i++)flagPost(total*(.03+i/marshalCount),i%2?1:-1,i);

  function cameraPod(s,side,index){const q=W.sample(s,side*(24+(index%3)*3)),g=new THREE.Group();g.name=`TV_CAMERA_POD_V2_${index}`;g.position.copy(q.p);g.rotation.y=Math.atan2(q.t.x,q.t.z);root.add(g);const mast=new THREE.Mesh(new THREE.CylinderGeometry(.09,.13,2.6,6),dark);mast.position.y=1.3;g.add(mast);const head=new THREE.Mesh(new THREE.BoxGeometry(.55,.34,.78),dark);head.position.set(0,2.6,0);g.add(head);const lens=new THREE.Mesh(new THREE.CylinderGeometry(.13,.18,.32,8),glass);lens.rotation.x=Math.PI/2;lens.position.set(0,2.6,-.50);g.add(lens);diagnostics.cameraCount++;}
  for(let i=0;i<cameraCount;i++)cameraPod(total*(.07+i/cameraCount),i%2?1:-1,i);

  function serviceVehicle(s,side,index){const q=W.sample(s,side*(34+index*3)),g=new THREE.Group();g.name=`SERVICE_VEHICLE_V2_${index}`;g.position.copy(q.p);g.rotation.y=Math.atan2(q.t.x,q.t.z);root.add(g);const body=new THREE.Mesh(new THREE.BoxGeometry(2.0,.72,4.2),index%2?orange:white);body.position.y=.62;g.add(body);const cab=new THREE.Mesh(new THREE.BoxGeometry(1.85,.72,1.65),white);cab.position.set(0,1.18,-.70);g.add(cab);for(const x of[-.82,.82])for(const z of[-1.28,1.28]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.20,8),dark);wheel.rotation.z=Math.PI/2;wheel.position.set(x,.34,z);g.add(wheel);}diagnostics.serviceCount++;}
  for(let i=0;i<serviceCount;i++)serviceVehicle(total*(.18+i*.21),i%2?1:-1,i);

  const previousUpdate=W.updateTrackside?.bind(W);
  W.updateTrackside=(flag,race,standings=[])=>{
    previousUpdate?.(flag,race,standings);const t=Number(race?.t)||0,final=standings[0]&&standings[0].lap>=Math.max(0,(race?.lapsTarget||1)-1);
    for(const x of flags){x.flag.material.color.setHex(final?0xffffff:(flag==='SC'||flag==='VSC'||flag==='YELLOW')?0xffdd24:flag==='RED'?0xe52d2d:0x42d46a);x.flag.rotation.y=Math.sin(t*6.5+x.seed)*.14;x.flag.rotation.z=Math.sin(t*4.2+x.seed*.7)*.08;}
  };
  W.spectatorAtmosphere=diagnostics;
  const priorAudit=W.auditCircuit?.bind(W);W.auditCircuit=()=>{const a=priorAudit?priorAudit():{};return{...a,spectatorAtmosphere:{...diagnostics},notes:[...(a.notes||[]),'Trackside spectator atmosphere adds lightweight crowd, marshal, broadcast-camera and service-vehicle context without changing simulation geometry.']};};
  W.circuitAudit=W.auditCircuit();return W;
}
