import * as THREE from 'three';

function roadGeometry(track,start=0,end=track.total,width=15,samples=720,offset=0){
  const pos=[],uv=[],idx=[];
  for(let i=0;i<=samples;i++){
    const s=start+(end-start)*(i/samples);
    const q=track.sample(s,offset),half=width*.5;
    pos.push(q.x+q.nx*half,.02,q.z+q.nz*half,q.x-q.nx*half,.02,q.z-q.nz*half);
    uv.push(0,i/samples*30,1,i/samples*30);
    if(i<samples){const k=i*2;idx.push(k,k+2,k+1,k+2,k+3,k+1);}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx);g.computeVertexNormals();return g;
}
function lineGeometry(track,lateral,color,opacity=.7){
  const pts=[];
  for(let i=0;i<=500;i++){const q=track.sample(track.total*i/500,lateral);pts.push(new THREE.Vector3(q.x,.055,q.z));}
  const g=new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity}));
}
function carMesh(car){
  const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:car.color,roughness:.38,metalness:.34});
  const dark=new THREE.MeshStandardMaterial({color:0x111318,roughness:.55,metalness:.15});
  const body=new THREE.Mesh(new THREE.BoxGeometry(car.width*.92,.55,car.length*.72),mat);
  body.position.y=.45;g.add(body);
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(car.width*.62,.42,car.length*.30),dark);
  cabin.position.set(0,.82,-car.length*.04);g.add(cabin);
  if(car.type==='formula'){
    body.scale.set(.72,.62,1);
    const nose=new THREE.Mesh(new THREE.BoxGeometry(.55,.22,car.length*.34),mat);nose.position.set(0,.38,car.length*.42);g.add(nose);
    const wing=new THREE.Mesh(new THREE.BoxGeometry(car.width*1.05,.08,.35),dark);wing.position.set(0,.28,car.length*.52);g.add(wing);
    const rear=new THREE.Mesh(new THREE.BoxGeometry(car.width*.95,.12,.28),dark);rear.position.set(0,.68,-car.length*.48);g.add(rear);
  }else if(['hyper','lmh','proto'].includes(car.type)){
    body.scale.set(.96,.62,1.02);cabin.scale.set(.72,.72,.82);
    const fin=new THREE.Mesh(new THREE.BoxGeometry(.08,.48,car.length*.24),dark);fin.position.set(0,1.0,-.25);g.add(fin);
  }
  const wheelGeo=new THREE.CylinderGeometry(.34,.34,.22,10);wheelGeo.rotateZ(Math.PI/2);
  for(const x of [-car.width*.47,car.width*.47])for(const z of [-car.length*.27,car.length*.27]){
    const w=new THREE.Mesh(wheelGeo,dark);w.position.set(x,.32,z);g.add(w);
  }
  g.userData.carId=car.id;
  return g;
}
export function createWorld(container,track,cars){
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x9db6c8);scene.fog=new THREE.FogExp2(0x9db6c8,.0014);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(container.clientWidth,container.clientHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xddeeff,0x36523d,2.0));
  const sun=new THREE.DirectionalLight(0xffffff,2.6);sun.position.set(-80,160,50);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-220;sun.shadow.camera.right=220;sun.shadow.camera.top=220;sun.shadow.camera.bottom=-220;scene.add(sun);
  const grass=new THREE.Mesh(new THREE.PlaneGeometry(760,620),new THREE.MeshStandardMaterial({color:0x496b3f,roughness:1}));
  grass.rotation.x=-Math.PI/2;grass.position.y=-.035;grass.receiveShadow=true;scene.add(grass);
  const road=new THREE.Mesh(roadGeometry(track,0,track.total,15.2,900),new THREE.MeshStandardMaterial({color:0x25282c,roughness:.93,metalness:.02}));road.receiveShadow=true;scene.add(road);
  scene.add(lineGeometry(track,7.1,0xffffff,.75),lineGeometry(track,-7.1,0xffffff,.75),lineGeometry(track,0,0x202225,.25));
  const pit=track.pit;
  const pitRoad=new THREE.Mesh(roadGeometry(track,pit.entryStart,pit.mergeEnd,7.2,260,(pit.fastLane+pit.workingLane)*.5),new THREE.MeshStandardMaterial({color:0x2c3035,roughness:.9}));pitRoad.receiveShadow=true;scene.add(pitRoad);
  const wallMat=new THREE.MeshStandardMaterial({color:0xd6d7d8,roughness:.65});
  for(let i=0;i<12;i++){
    const s=pit.boxStart+i*pit.boxSpacing,q=track.sample(s,pit.workingLane-4.4);
    const box=new THREE.Mesh(new THREE.BoxGeometry(4.5,2.6,5.2),wallMat);box.position.set(q.x,1.3,q.z);box.rotation.y=q.heading;scene.add(box);
  }
  const carGroups=new Map();
  for(const car of cars){const m=carMesh(car);m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});carGroups.set(car.id,m);scene.add(m);}
  const startQ=track.sample(0,0),gantry=new THREE.Mesh(new THREE.BoxGeometry(18,.55,.45),new THREE.MeshStandardMaterial({color:0x181a1d}));
  gantry.position.set(startQ.x,6.5,startQ.z);gantry.rotation.y=startQ.heading;scene.add(gantry);
  function update(snapshot){for(const car of snapshot.cars){const q=track.sample(car.s,car.lane),m=carGroups.get(car.id);if(!m)continue;m.position.set(q.x,.08,q.z);m.rotation.y=Number.isFinite(car.yaw)?car.yaw:q.heading;m.visible=!car.retired;}}
  function resize(){renderer.setSize(container.clientWidth,container.clientHeight,false);renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));}
  return{scene,renderer,carGroups,update,resize};
}
