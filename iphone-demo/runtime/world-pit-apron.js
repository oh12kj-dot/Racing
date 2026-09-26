import {buildWorld as buildRealismWorld} from './world-realism.js';
import {SUZUKA_PIT,BUILDING_LAYOUT} from './config.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildRealismWorld(THREE,TRACK,settings,circuitName),pit=W.runtimePit;
  const legacyRuntimeGarageRoot=pit?.garageOpenings,legacyGarages=legacyRuntimeGarageRoot?.children||[];
  if(!pit?.root||!pit?.poseUF||!pit?.lanePoseUF||legacyGarages.length<10)return W;

  const total=Math.max(1,Number(W.total)||1),boxUF=team=>{let f=W.pitBoxFraction?.(team)??(SUZUKA_PIT.box0UF+team*SUZUKA_PIT.boxGapMeters/total);if(f<SUZUKA_PIT.entryUF)f+=1;return f;};
  const laneStartUF=boxUF(0)-50/total,laneEndUF=boxUF(9)+30/total;
  const oldRoot=W.scene.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');
  W.scene.updateMatrixWorld(true);

  function referenceGarageFrontWorld(team){
    const garage=legacyGarages[team],local=new THREE.Vector3(Number(garage?.userData?.frontLocal)||0,0,0);
    garage?.updateWorldMatrix?.(true,false);
    return garage?garage.localToWorld(local):pit.lanePoseUF(boxUF(team),0).p.clone();
  }
  function makeBoxFromCorners(points,minY,maxY){
    const b=new THREE.Box3().setFromPoints(points);b.min.y=minY;b.max.y=maxY;return b;
  }

  // Build exclusion boxes from the actual pit-lane centre and actual garage
  // entrances. No lateral-sign assumption is involved here.
  const clearanceBoxes=[];
  const laneStepMeters=7.5,laneSteps=Math.max(2,Math.ceil((laneEndUF-laneStartUF)*total/laneStepMeters));
  for(let i=0;i<=laneSteps;i++){
    const uf=laneStartUF+(laneEndUF-laneStartUF)*i/laneSteps,q=pit.poseUF(uf),halfLane=SUZUKA_PIT.laneHalfWidth+.65,halfLong=laneStepMeters*.62;
    const pts=[];
    for(const a of[-1,1])for(const b of[-1,1])pts.push(q.p.clone().addScaledVector(q.side,a*halfLane).addScaledVector(q.t,b*halfLong));
    clearanceBoxes.push(makeBoxFromCorners(pts,q.p.y-.2,q.p.y+2.9));
  }
  for(let team=0;team<10;team++){
    const work=W.pitPose(W.pitBoxS(team),team,'STOP'),front=referenceGarageFrontWorld(team),dir=front.clone().sub(work.p).setY(0);
    if(dir.lengthSq()<.01)continue;dir.normalize();
    const t=work.t.clone().setY(0).normalize(),start=work.p.clone().addScaledVector(dir,1.15),end=front.clone().addScaledVector(dir,-.55),halfLong=SUZUKA_PIT.boxGapMeters*.515,pts=[];
    for(const p of[start,end])for(const s of[-1,1])pts.push(p.clone().addScaledVector(t,s*halfLong));
    clearanceBoxes.push(makeBoxFromCorners(pts,Math.min(start.y,end.y)-.2,Math.max(start.y,end.y)+2.9));
  }

  function legacyBuildingKind(child){
    let kind=null;
    child?.traverse?.(o=>{
      if(kind||!o?.isMesh||!o.geometry)return;
      const p=o.geometry.parameters||{};
      if(o.geometry.type!=='BoxGeometry')return;
      const pitEntry=Math.abs((p.width||0)-9.0)<.10&&Math.abs((p.height||0)-7.2)<.10&&Math.abs((p.depth||0)-18)<.15;
      const hospitality=Math.abs((p.width||0)-(BUILDING_LAYOUT.garageDepth+.35))<.12
        &&Math.abs((p.height||0)-BUILDING_LAYOUT.hospitalityHeight)<.12
        &&(p.depth||0)>5&&(p.depth||0)<12;
      if(pitEntry)kind='legacy-pit-entry-building';
      else if(hospitality)kind='legacy-garage-hospitality-row';
    });
    return kind;
  }
  function childIntersectsClearance(child){
    let hit=false;
    child?.traverse?.(o=>{
      if(hit||!o?.isMesh||o.visible===false||!o.geometry)return;
      const b=new THREE.Box3().setFromObject(o);
      if(b.isEmpty())return;
      if(clearanceBoxes.some(c=>c.intersectsBox(b)))hit=true;
    });
    return hit;
  }
  function suppressLegacyPitBuildings(){
    const names=[],kinds={};
    if(!oldRoot)return{owner:'runtime-pit-building-clearance-v5',suppressed:0,remaining:0,names,kinds,laneStartUF,laneEndUF};
    W.scene.updateMatrixWorld(true);
    for(let i=0;i<oldRoot.children.length;i++){
      const child=oldRoot.children[i];
      if(child.visible===false)continue;
      const kind=legacyBuildingKind(child);
      if(!kind&&!childIntersectsClearance(child))continue;
      const reason=kind||'pit-service-clearance-intrusion';
      child.visible=false;child.userData.runtimePitSuppressed=reason;names.push(child.name||`legacy-home-child-${i}`);kinds[reason]=(kinds[reason]||0)+1;
    }
    W.scene.updateMatrixWorld(true);
    let remaining=0;
    for(const child of oldRoot.children)if(child.visible!==false&&childIntersectsClearance(child))remaining++;
    return{owner:'runtime-pit-building-clearance-v5',suppressed:names.length,remaining,names,kinds,laneStartUF,laneEndUF,clearanceBoxes:clearanceBoxes.length};
  }
  const buildingClearanceAudit=suppressLegacyPitBuildings();

  // The previous runtime garage lived under PIT_ALIGNED_ENTRANCES_RUNTIME. The
  // scene-quality controller treats that group as optional garage lighting and at
  // quality level 3 hides every MeshStandard child, leaving only floating PIT
  // signs. Preserve that old group for compatibility but suppress its rendering;
  // the structural building below is permanent circuit geometry and is therefore
  // deliberately outside that optional-quality group.
  legacyRuntimeGarageRoot.visible=false;
  legacyRuntimeGarageRoot.userData.runtimePitSuppressed='replaced-by-persistent-pit-building';

  function signTexture(text,bg='#20262b'){
    const c=document.createElement('canvas');c.width=512;c.height=112;const g=c.getContext('2d');
    g.fillStyle=bg;g.fillRect(0,0,c.width,c.height);g.fillStyle='#fff';
    g.font='900 48px -apple-system,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(text,256,58);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
  }
  function addSolid(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,front=false){
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.receiveShadow=true;m.castShadow=false;
    m.userData.pitGarageSolid=true;if(front)m.userData.pitGarageFrontSolid=true;parent.add(m);return m;
  }

  // Rebuild one permanent, correctly aligned garage/hospitality module for each
  // pit box. Local +X faces the lane and local -X goes deeper into the building,
  // so nothing structural can project into the service apron.
  const buildingRoot=new THREE.Group();buildingRoot.name='PIT_SERVICE_BUILDING_RUNTIME';pit.root.add(buildingRoot);
  const concrete=new THREE.MeshStandardMaterial({color:0xd7d9d7,roughness:.84,metalness:.02});
  const concreteDark=new THREE.MeshStandardMaterial({color:0x9da3a5,roughness:.90,metalness:.03});
  const interior=new THREE.MeshStandardMaterial({color:0x20262a,roughness:.88,metalness:.02});
  const roofMat=new THREE.MeshStandardMaterial({color:0xe7e9e6,roughness:.76,metalness:.08});
  const glass=new THREE.MeshPhysicalMaterial({color:0x23485b,roughness:.18,transparent:true,opacity:.72,clearcoat:.45,side:THREE.DoubleSide});
  const floorMat=new THREE.MeshStandardMaterial({color:0x3f4447,roughness:.92,metalness:.015});
  const teamColors=[0xe3312d,0x287de1,0xf2c52f,0xf3f3f3,0x20bd7b,0x9362df,0xed7b27,0x22aab8,0xe04a90,0xaeb6c1];
  const GARAGE_OPENING_WIDTH=8.0,GARAGE_OPENING_HEIGHT=3.35,GARAGE_BAY_WIDTH=Math.min(17.5,SUZUKA_PIT.boxGapMeters-.35),GARAGE_DEPTH=7.2;
  const rebuiltGarages=[];
  for(let team=0;team<10;team++){
    const work=W.pitPose(W.pitBoxS(team),team,'STOP'),front=referenceGarageFrontWorld(team),distance=work.p.distanceTo(front),g=new THREE.Group();
    g.name=`PIT_GARAGE_OPENING_${team+1}`;g.position.copy(front);g.position.y=work.p.y+.04;g.rotation.y=work.rotationY;
    const workEdgeToGarageFront=Math.max(0,distance-3.15*.5);
    g.userData={pitGarageOpening:true,persistentPitBuilding:true,team,frontLocal:0,openingWidth:GARAGE_OPENING_WIDTH,openingHeight:GARAGE_OPENING_HEIGHT,recessDepth:GARAGE_DEPTH,workCenterLocal:-distance,workEdgeToGarageFront};
    buildingRoot.add(g);rebuiltGarages.push(g);
    const teamMat=new THREE.MeshStandardMaterial({color:teamColors[team],roughness:.58,metalness:.02});
    const pierWidth=(GARAGE_BAY_WIDTH-GARAGE_OPENING_WIDTH)*.5,sideZ=GARAGE_OPENING_WIDTH*.5,pierZ=sideZ+pierWidth*.5;
    // Interior slab, back wall and side walls form a real open-front garage.
    addSolid(g,new THREE.BoxGeometry(GARAGE_DEPTH,.12,GARAGE_BAY_WIDTH),floorMat,-GARAGE_DEPTH*.5,.06,0);
    addSolid(g,new THREE.BoxGeometry(.28,GARAGE_OPENING_HEIGHT,GARAGE_BAY_WIDTH),interior,-GARAGE_DEPTH+.14,GARAGE_OPENING_HEIGHT*.5,0);
    addSolid(g,new THREE.BoxGeometry(GARAGE_DEPTH,GARAGE_OPENING_HEIGHT,.28),concrete,-GARAGE_DEPTH*.5,GARAGE_OPENING_HEIGHT*.5,-sideZ);
    addSolid(g,new THREE.BoxGeometry(GARAGE_DEPTH,GARAGE_OPENING_HEIGHT,.28),concrete,-GARAGE_DEPTH*.5,GARAGE_OPENING_HEIGHT*.5,sideZ);
    addSolid(g,new THREE.BoxGeometry(.34,GARAGE_OPENING_HEIGHT,pierWidth),concrete,-.17,GARAGE_OPENING_HEIGHT*.5,-pierZ,0,0,0,true);
    addSolid(g,new THREE.BoxGeometry(.34,GARAGE_OPENING_HEIGHT,pierWidth),concrete,-.17,GARAGE_OPENING_HEIGHT*.5,pierZ,0,0,0,true);
    addSolid(g,new THREE.BoxGeometry(.38,.72,GARAGE_OPENING_WIDTH+.64),teamMat,-.19,GARAGE_OPENING_HEIGHT+.36,0,0,0,0,true);
    addSolid(g,new THREE.BoxGeometry(GARAGE_DEPTH+.50,.18,GARAGE_BAY_WIDTH),concreteDark,-GARAGE_DEPTH*.5-.20,GARAGE_OPENING_HEIGHT+.12,0);
    // Permanent hospitality level: its lane-side face is exactly above the
    // garage threshold, never in front of it.
    addSolid(g,new THREE.BoxGeometry(GARAGE_DEPTH+.55,2.55,GARAGE_BAY_WIDTH),concrete,-GARAGE_DEPTH*.5-.22,5.10,0);
    const glassBand=new THREE.Mesh(new THREE.PlaneGeometry(GARAGE_BAY_WIDTH-1.0,1.22),glass);glassBand.rotation.y=Math.PI/2;glassBand.position.set(.07,5.18,0);g.add(glassBand);
    addSolid(g,new THREE.BoxGeometry(GARAGE_DEPTH+.85,.24,GARAGE_BAY_WIDTH+.10),roofMat,-GARAGE_DEPTH*.5-.30,6.52,0);
    // Sign faces the pit lane (+local X); the old sign used the opposite normal,
    // which is why its text appeared mirrored from the service lane.
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(5.9,.62),new THREE.MeshBasicMaterial({map:signTexture(`PIT ${String(team+1).padStart(2,'0')}`,`#${teamColors[team].toString(16).padStart(6,'0')}`),side:THREE.DoubleSide}));
    sign.rotation.y=Math.PI/2;sign.position.set(.025,GARAGE_OPENING_HEIGHT+.37,0);sign.userData.pitGarageSign=true;g.add(sign);
  }
  W.scene.updateMatrixWorld(true);

  function garageFrontWorld(team){
    const garage=rebuiltGarages[team];
    if(!garage)return referenceGarageFrontWorld(team);
    const p=new THREE.Vector3(Number(garage.userData?.frontLocal)||0,0,0);garage.updateWorldMatrix?.(true,false);return garage.localToWorld(p);
  }

  // Each pit gets a floor slab derived from the real STOP position and rebuilt
  // garage threshold. Adjacent slabs overlap slightly, so no terrain seam can be
  // visible between teams. The surface is raised above the legacy grass plane.
  const pavingRoot=new THREE.Group();pavingRoot.name='PIT_SERVICE_APRON_PAVING_RUNTIME';pit.root.add(pavingRoot);
  const pavingMaterial=new THREE.MeshStandardMaterial({color:0x5b6063,roughness:.97,metalness:.01,side:THREE.DoubleSide});
  const floors=[];
  for(let team=0;team<10;team++){
    const work=W.pitPose(W.pitBoxS(team),team,'STOP'),front=garageFrontWorld(team),dir=front.clone().sub(work.p).setY(0);
    if(dir.lengthSq()<.01)continue;dir.normalize();
    const tangent=work.t.clone().setY(0).normalize(),start=work.p.clone().addScaledVector(dir,1.05),end=front.clone().addScaledVector(dir,.48),halfLong=SUZUKA_PIT.boxGapMeters*.535;
    const startY=work.p.y+.155,endY=front.y+.155;
    const a=start.clone().addScaledVector(tangent,-halfLong),b=start.clone().addScaledVector(tangent,halfLong),c=end.clone().addScaledVector(tangent,-halfLong),d=end.clone().addScaledVector(tangent,halfLong);
    a.y=b.y=startY;c.y=d.y=endY;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,d.x,d.y,d.z],3));
    geo.setIndex([0,1,2,1,3,2]);geo.computeVertexNormals();geo.computeBoundingSphere();
    const m=new THREE.Mesh(geo,pavingMaterial);m.name=`PIT_SERVICE_FLOOR_${String(team+1).padStart(2,'0')}`;m.receiveShadow=true;
    const length=start.distanceTo(end),mid=start.clone().lerp(end,.5);
    m.userData={owner:'runtime-pit-service-paving-v4',pitServicePaving:true,team,length,width:halfLong*2,start:[start.x,startY,start.z],end:[end.x,endY,end.z],mid:[mid.x,(startY+endY)*.5,mid.z]};
    pavingRoot.add(m);floors.push(m);
  }
  W.scene.updateMatrixWorld(true);

  // Confirm that the new pavement is not merely present underneath grass/terrain:
  // across the full apron it must be the first visible surface hit from above.
  function auditServicePaving(){
    const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),rows=[];
    for(let team=0;team<10;team++){
      const work=W.pitPose(W.pitBoxS(team),team,'STOP'),front=garageFrontWorld(team),dir=front.clone().sub(work.p).setY(0);
      if(dir.lengthSq()<.01)continue;dir.normalize();
      const tangent=work.t.clone().setY(0).normalize(),distance=work.p.distanceTo(front);
      for(const fraction of[.16,.34,.52,.70,.88])for(const along of[-.38,0,.38]){
        const p=work.p.clone().addScaledVector(dir,1.05+(distance-.60)*fraction).addScaledVector(tangent,along*SUZUKA_PIT.boxGapMeters*.5);p.y=Math.max(work.p.y,front.y)+6;
        ray.set(p,down);
        const hits=ray.intersectObjects(W.scene.children,true).filter(h=>h.object?.visible!==false);
        const top=hits[0]?.object||null;
        rows.push({team,fraction,along,hit:!!top?.userData?.pitServicePaving,topName:top?.name||null,distance:hits[0]?.distance??null});
      }
    }
    return{owner:'runtime-pit-service-paving-audit-v4',hitCount:rows.filter(r=>r.hit).length,total:rows.length,rows};
  }
  function auditServiceBuilding(){
    const rows=rebuiltGarages.map((garage,team)=>{
      const work=W.pitPose(W.pitBoxS(team),team,'STOP'),front=garageFrontWorld(team),u=garage.userData||{};
      let visibleSolids=0,frontBlockers=0,signs=0;
      garage.traverse(o=>{
        if(o?.userData?.pitGarageSign&&o.visible!==false)signs++;
        if(!o?.isMesh||!o.userData?.pitGarageSolid||o.visible===false||o.geometry?.type!=='BoxGeometry')return;
        visibleSolids++;const p=o.geometry.parameters||{},hx=(p.width||0)*.5,hy=(p.height||0)*.5,hz=(p.depth||0)*.5;
        const crossesFront=(o.position.x-hx)<=.06&&(o.position.x+hx)>=-.36;
        const crossesCenter=(o.position.z-hz)<.16&&(o.position.z+hz)>-.16;
        const crossesUsableHeight=(o.position.y-hy)<GARAGE_OPENING_HEIGHT-.20&&(o.position.y+hy)>.25;
        if(crossesFront&&crossesCenter&&crossesUsableHeight)frontBlockers++;
      });
      return{team,visible:garage.visible!==false,opening:!!u.pitGarageOpening,visibleSolids,frontBlockers,signs,clearance:work.p.distanceTo(front),workEdgeToGarageFront:u.workEdgeToGarageFront};
    });
    return{owner:'runtime-pit-service-building-audit-v1',count:rows.length,visibleCount:rows.filter(r=>r.visible).length,solidCount:rows.reduce((n,r)=>n+r.visibleSolids,0),signCount:rows.reduce((n,r)=>n+r.signs,0),frontBlockers:rows.reduce((n,r)=>n+r.frontBlockers,0),rows};
  }
  const servicePavingAudit=auditServicePaving(),serviceBuildingAudit=auditServiceBuilding();

  pit.servicePaving=pavingRoot;pit.serviceFloors=floors;pit.servicePavingAudit=servicePavingAudit;pit.buildingClearanceAudit=buildingClearanceAudit;
  pit.serviceBuilding=buildingRoot;pit.serviceBuildingAudit=serviceBuildingAudit;pit.legacyGarageOpenings=legacyRuntimeGarageRoot;
  pit.garageOpenings=buildingRoot;pit.alignedEntrances=buildingRoot;pit.garageFrontWorld=garageFrontWorld;pit.laneStartUF=laneStartUF;pit.laneEndUF=laneEndUF;

  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{},runtimePit={...(a.runtimePit||{})};
    return{
      ...a,version:'runtime-2026.09.15-r9',
      runtimePit:{...runtimePit,
        buildingClearanceOwner:buildingClearanceAudit.owner,
        suppressedLegacyBuildingGroups:buildingClearanceAudit.suppressed,
        suppressedLegacyBuildingKinds:buildingClearanceAudit.kinds,
        legacyBuildingIntrusionsAfter:buildingClearanceAudit.remaining,
        buildingClearanceBoxes:buildingClearanceAudit.clearanceBoxes,
        persistentPitBuildingOwner:serviceBuildingAudit.owner,
        persistentPitBuildingBays:serviceBuildingAudit.count,
        persistentPitBuildingVisibleBays:serviceBuildingAudit.visibleCount,
        persistentPitBuildingSolids:serviceBuildingAudit.solidCount,
        persistentPitBuildingSigns:serviceBuildingAudit.signCount,
        persistentPitBuildingFrontBlockers:serviceBuildingAudit.frontBlockers,
        servicePavingOwner:'runtime-pit-service-paving-v4',
        servicePavingFloors:floors.length,
        servicePavingTopHits:servicePavingAudit.hitCount,
        servicePavingTopTotal:servicePavingAudit.total
      },
      notes:[...(a.notes||[]),
        'misaligned V42 pit-entry building and old garage/hospitality row are removed as complete legacy groups',
        'optional-quality legacy runtime garages are suppressed and replaced by permanent open-front pit-building geometry',
        'ten overlapping raised service-floor slabs connect each working box to its rebuilt garage threshold',
        'paving audit checks the new floor as the topmost visible surface at 150 points across the full service apron'
      ]
    };
  };
  W.circuitAudit=W.auditCircuit();
  return W;
}
