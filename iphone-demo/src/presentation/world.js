import * as THREE from 'three';

const ROAD_Y=.02;
const WHEEL_RADIUS=.34;
const WHEEL_CENTER_Y=.32;
const CAR_BASE_Y=ROAD_Y+WHEEL_RADIUS-WHEEL_CENTER_Y;

function roadGeometry(track,start=0,end=track.total,width=15,samples=720,offset=0){
  const pos=[],uv=[],idx=[];
  for(let i=0;i<=samples;i++){
    const s=start+(end-start)*(i/samples);
    const q=track.sample(s,offset),half=width*.5;
    pos.push(q.x+q.nx*half,ROAD_Y,q.z+q.nz*half,q.x-q.nx*half,ROAD_Y,q.z-q.nz*half);
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
function barrierGeometry(track,side,start,end,height=.88,samples=180){
  const pos=[],idx=[];
  const count=Math.max(8,Math.round(samples*(end-start)/track.total));
  for(let i=0;i<=count;i++){
    const s=start+(end-start)*(i/count);
    const center=track.sample(s),lateral=side*(center.halfWidth+.10),q=track.sample(s,lateral);
    pos.push(q.x,ROAD_Y,q.z,q.x,ROAD_Y+height,q.z);
    if(i<count){const k=i*2;idx.push(k,k+2,k+1,k+2,k+3,k+1);}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx);g.computeVertexNormals();return g;
}
function crossingS(start,end,fromLane,toLane,boundaryLane){
  const span=Math.max(1,end-start),delta=toLane-fromLane;
  if(Math.abs(delta)<1e-6)return start;
  const u=Math.max(0,Math.min(1,(boundaryLane-fromLane)/delta));
  return start+span*u;
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
  const wheelGeo=new THREE.CylinderGeometry(WHEEL_RADIUS,WHEEL_RADIUS,.22,10);wheelGeo.rotateZ(Math.PI/2);
  for(const x of [-car.width*.47,car.width*.47])for(const z of [-car.length*.27,car.length*.27]){
    const w=new THREE.Mesh(wheelGeo,dark);w.position.set(x,WHEEL_CENTER_Y,z);g.add(w);
  }
  g.userData.carId=car.id;
  return g;
}
export function createWorld(container,track,cars){
  const drySky=new THREE.Color(0x9db6c8),wetSky=new THREE.Color(0x687784);
  const dryRoad=new THREE.Color(0x25282c),wetRoad=new THREE.Color(0x15191d);
  const dryPit=new THREE.Color(0x2c3035),wetPit=new THREE.Color(0x181c20);
  const dryGrass=new THREE.Color(0x496b3f),wetGrass=new THREE.Color(0x354f35);
  const scene=new THREE.Scene();scene.background=drySky.clone();scene.fog=new THREE.FogExp2(drySky.clone(),.0014);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(container.clientWidth,container.clientHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xddeeff,0x36523d,2.0));
  const sun=new THREE.DirectionalLight(0xffffff,2.6);sun.position.set(-80,160,50);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-220;sun.shadow.camera.right=220;sun.shadow.camera.top=220;sun.shadow.camera.bottom=-220;scene.add(sun);
  const grassMat=new THREE.MeshStandardMaterial({color:dryGrass,roughness:1});
  const grass=new THREE.Mesh(new THREE.PlaneGeometry(760,620),grassMat);
  grass.rotation.x=-Math.PI/2;grass.position.y=-.035;grass.receiveShadow=true;scene.add(grass);
  const mainRoadWidth=track.sample(0).halfWidth*2;
  const roadMat=new THREE.MeshStandardMaterial({color:dryRoad,roughness:.93,metalness:.02});
  const road=new THREE.Mesh(roadGeometry(track,0,track.total,mainRoadWidth,900),roadMat);road.receiveShadow=true;scene.add(road);
  scene.add(lineGeometry(track,7.1,0xffffff,.75),lineGeometry(track,-7.1,0xffffff,.75),lineGeometry(track,0,0x202225,.25));
  const pit=track.pit,pitRoadWidth=7.2,pitRoadCenter=(pit.fastLane+pit.workingLane)*.5;
  const pitRoadMat=new THREE.MeshStandardMaterial({color:dryPit,roughness:.9,metalness:.02});
  const pitRoad=new THREE.Mesh(roadGeometry(track,pit.entryStart,pit.mergeEnd,pitRoadWidth,260,pitRoadCenter),pitRoadMat);pitRoad.receiveShadow=true;scene.add(pitRoad);
  const wallMat=new THREE.MeshStandardMaterial({color:0xd6d7d8,roughness:.65});

  // Vehicle physics constrains TRACK cars at halfWidth. Render that physical
  // boundary so a real barrier contact never looks like a collision with an
  // invisible wall. The pit-side wall keeps two deliberate openings exactly
  // where PIT_ENTRY and MERGE trajectories cross the main-track boundary.
  const barrierHeight=.88,barrierLateral=track.sample(0).halfWidth+.10;
  const entryCross=crossingS(pit.entryStart,pit.speedLine,pit.approachLane,pit.fastLane,-track.sample(0).halfWidth);
  const mergeCross=crossingS(pit.mergeStart,pit.mergeEnd,pit.fastLane,-2.2,-track.sample(0).halfWidth);
  const openingHalf=12;
  const barrierOpenings=[
    {kind:'pit-entry',start:Math.max(0,entryCross-openingHalf),end:Math.min(track.total,entryCross+openingHalf)},
    {kind:'pit-merge',start:Math.max(0,mergeCross-openingHalf),end:Math.min(track.total,mergeCross+openingHalf)}
  ];
  const barrierSections=[
    {side:1,start:0,end:track.total},
    {side:-1,start:0,end:barrierOpenings[0].start},
    {side:-1,start:barrierOpenings[0].end,end:barrierOpenings[1].start},
    {side:-1,start:barrierOpenings[1].end,end:track.total}
  ].filter(s=>s.end-s.start>2);
  const barrierMat=new THREE.MeshStandardMaterial({color:0xb9bdc2,roughness:.72,metalness:.12,side:THREE.DoubleSide});
  const barriers=[];
  for(const section of barrierSections){
    const mesh=new THREE.Mesh(barrierGeometry(track,section.side,section.start,section.end,barrierHeight,720),barrierMat);
    mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.userData={kind:'track-barrier',...section};scene.add(mesh);
    barriers.push({mesh,...section});
  }

  const garages=new Map();
  const teamCount=cars.reduce((max,car)=>Math.max(max,Number.isFinite(car.teamId)?car.teamId:-1),-1)+1;
  const garageLateral=pit.workingLane-4.4,garageWidth=4.5,garageDepth=5.2;
  for(let teamId=0;teamId<teamCount;teamId++){
    const s=pit.boxStart+teamId*pit.boxSpacing,q=track.sample(s,garageLateral);
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(garageWidth,2.6,garageDepth),wallMat);
    mesh.position.set(q.x,1.3,q.z);mesh.rotation.y=q.heading;
    mesh.userData={kind:'pit-garage',teamId,boxS:s,lateral:garageLateral};scene.add(mesh);
    garages.set(teamId,{mesh,teamId,s,lateral:garageLateral,width:garageWidth,depth:garageDepth});
  }
  const carGroups=new Map();
  for(const car of cars){const m=carMesh(car);m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});carGroups.set(car.id,m);scene.add(m);}

  // The start structure must read as a grounded gantry from every spectator
  // camera. A crossbar by itself looked like a floating black plank in TV/HELI
  // views, so keep its supports just outside the road corridor.
  const startQ=track.sample(0,0),gantryMat=new THREE.MeshStandardMaterial({color:0x181a1d,roughness:.62});
  const gantryHeight=6.5,gantrySpan=18,gantrySupportLateral=Math.max(mainRoadWidth*.5+.75,8.2);
  const gantry=new THREE.Group();gantry.userData={kind:'start-gantry'};
  const gantryCrossbar=new THREE.Mesh(new THREE.BoxGeometry(gantrySpan,.55,.45),gantryMat);
  gantryCrossbar.position.set(startQ.x,gantryHeight,startQ.z);gantryCrossbar.rotation.y=startQ.heading;gantryCrossbar.castShadow=true;gantry.add(gantryCrossbar);
  const gantrySupports=[];
  for(const lateral of [-gantrySupportLateral,gantrySupportLateral]){
    const q=track.sample(0,lateral),support=new THREE.Mesh(new THREE.BoxGeometry(.52,gantryHeight,.52),gantryMat);
    support.position.set(q.x,gantryHeight*.5,q.z);support.rotation.y=startQ.heading;support.castShadow=true;support.userData={kind:'start-gantry-support',lateral};
    gantry.add(support);gantrySupports.push(support);
  }
  scene.add(gantry);

  function update(snapshot){
    const weather=snapshot.environment;
    const wetness=Math.max(0,Math.min(1,weather?.wetness??0));
    const visibility=Math.max(.35,Math.min(1,weather?.visibility??1));
    roadMat.color.copy(dryRoad).lerp(wetRoad,wetness);roadMat.roughness=.93-.55*wetness;roadMat.metalness=.02+.16*wetness;
    pitRoadMat.color.copy(dryPit).lerp(wetPit,wetness);pitRoadMat.roughness=.90-.50*wetness;pitRoadMat.metalness=.02+.14*wetness;
    grassMat.color.copy(dryGrass).lerp(wetGrass,wetness);
    scene.background.copy(drySky).lerp(wetSky,wetness);scene.fog.color.copy(scene.background);scene.fog.density=.0014+(1-visibility)*.0042;
    sun.intensity=2.6-wetness*.9;
    for(const car of snapshot.cars){const q=track.sample(car.s,car.lane),m=carGroups.get(car.id);if(!m)continue;m.position.set(q.x,CAR_BASE_Y,q.z);m.rotation.y=Number.isFinite(car.yaw)?car.yaw:q.heading;m.visible=!car.retired;}
  }
  function resize(){renderer.setSize(container.clientWidth,container.clientHeight,false);renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));}
  return{scene,renderer,carGroups,garages,barriers,gantry:{group:gantry,crossbar:gantryCrossbar,supports:gantrySupports},weatherMaterials:{road:roadMat,pitRoad:pitRoadMat,grass:grassMat},worldGeometry:{mainRoadWidth,pitRoadWidth,pitRoadCenter,garageLateral,barrierHeight,barrierLateral,barrierSections:barrierSections.map(s=>({...s})),barrierOpenings:barrierOpenings.map(o=>({...o})),gantrySupportLateral,gantryHeight,roadY:ROAD_Y,carBaseY:CAR_BASE_Y,wheelRadius:WHEEL_RADIUS,wheelCenterY:WHEEL_CENTER_Y},update,resize};
}
