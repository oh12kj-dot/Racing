import {buildWorld as buildRealismWorld} from './world-realism.js';
import {SUZUKA_PIT} from './config.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildRealismWorld(THREE,TRACK,settings,circuitName),pit=W.runtimePit,garages=pit?.garageOpenings?.children||[];
  if(!pit?.root||!pit?.poseUF||!pit?.lanePoseUF||garages.length<10)return W;

  const total=Math.max(1,Number(W.total)||1),boxUF=team=>{let f=W.pitBoxFraction?.(team)??(SUZUKA_PIT.box0UF+team*SUZUKA_PIT.boxGapMeters/total);if(f<SUZUKA_PIT.entryUF)f+=1;return f;};
  const laneStartUF=boxUF(0)-50/total,laneEndUF=boxUF(9)+30/total;
  const oldRoot=W.scene.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');
  W.scene.updateMatrixWorld(true);

  function garageFrontWorld(team){
    const garage=garages[team],local=new THREE.Vector3(Number(garage?.userData?.frontLocal)||0,0,0);
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
    const uf=boxUF(team),work=W.pitPose(W.pitBoxS(team),team,'STOP'),front=garageFrontWorld(team),dir=front.clone().sub(work.p).setY(0);
    if(dir.lengthSq()<.01)continue;dir.normalize();
    const t=work.t.clone().setY(0).normalize(),start=work.p.clone().addScaledVector(dir,1.15),end=front.clone().addScaledVector(dir,-.55),halfLong=SUZUKA_PIT.boxGapMeters*.515,pts=[];
    for(const p of[start,end])for(const s of[-1,1])pts.push(p.clone().addScaledVector(t,s*halfLong));
    clearanceBoxes.push(makeBoxFromCorners(pts,Math.min(start.y,end.y)-.2,Math.max(start.y,end.y)+2.9));
  }

  function isKnownPitEntryBuilding(child){
    let found=false;
    child?.traverse?.(o=>{
      if(found||!o?.isMesh||o.visible===false||o.geometry?.type!=='BoxGeometry')return;
      const p=o.geometry.parameters||{};
      if(Math.abs((p.width||0)-9.0)<.10&&Math.abs((p.height||0)-7.2)<.10&&Math.abs((p.depth||0)-18)<.15)found=true;
    });
    return found;
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
    const names=[];
    if(!oldRoot)return{owner:'runtime-pit-building-clearance-v3',suppressed:0,remaining:0,names,laneStartUF,laneEndUF};
    W.scene.updateMatrixWorld(true);
    for(let i=0;i<oldRoot.children.length;i++){
      const child=oldRoot.children[i];
      if(child.visible===false)continue;
      if(!isKnownPitEntryBuilding(child)&&!childIntersectsClearance(child))continue;
      child.visible=false;child.userData.runtimePitSuppressed='pit-service-clearance-v3';names.push(child.name||`legacy-home-child-${i}`);
    }
    W.scene.updateMatrixWorld(true);
    let remaining=0;
    for(const child of oldRoot.children)if(child.visible!==false&&childIntersectsClearance(child))remaining++;
    return{owner:'runtime-pit-building-clearance-v3',suppressed:names.length,remaining,names,laneStartUF,laneEndUF,clearanceBoxes:clearanceBoxes.length};
  }
  const buildingClearanceAudit=suppressLegacyPitBuildings();

  // Each pit gets a floor slab derived from the real STOP position and the real
  // garage threshold. Adjacent slabs overlap slightly, so no terrain seam can be
  // visible between teams. The surface is raised above the legacy grass plane.
  const pavingRoot=new THREE.Group();pavingRoot.name='PIT_SERVICE_APRON_PAVING_RUNTIME';pit.root.add(pavingRoot);
  const pavingMaterial=new THREE.MeshStandardMaterial({color:0x5b6063,roughness:.97,metalness:.01,side:THREE.DoubleSide});
  const floors=[];
  for(let team=0;team<10;team++){
    const work=W.pitPose(W.pitBoxS(team),team,'STOP'),front=garageFrontWorld(team),dir=front.clone().sub(work.p).setY(0);
    if(dir.lengthSq()<.01)continue;dir.normalize();
    const tangent=work.t.clone().setY(0).normalize(),start=work.p.clone().addScaledVector(dir,1.32),end=front.clone().addScaledVector(dir,.18),halfLong=SUZUKA_PIT.boxGapMeters*.515;
    const startY=work.p.y+.145,endY=front.y+.145;
    const a=start.clone().addScaledVector(tangent,-halfLong),b=start.clone().addScaledVector(tangent,halfLong),c=end.clone().addScaledVector(tangent,-halfLong),d=end.clone().addScaledVector(tangent,halfLong);
    a.y=b.y=startY;c.y=d.y=endY;
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,d.x,d.y,d.z],3));
    g.setIndex([0,1,2,1,3,2]);g.computeVertexNormals();g.computeBoundingSphere();
    const m=new THREE.Mesh(g,pavingMaterial);m.name=`PIT_SERVICE_FLOOR_${String(team+1).padStart(2,'0')}`;m.receiveShadow=true;
    const length=start.distanceTo(end),mid=start.clone().lerp(end,.5);
    m.userData={owner:'runtime-pit-service-paving-v2',pitServicePaving:true,team,length,width:halfLong*2,start:[start.x,startY,start.z],end:[end.x,endY,end.z],mid:[mid.x,(startY+endY)*.5,mid.z]};
    pavingRoot.add(m);floors.push(m);
  }
  W.scene.updateMatrixWorld(true);

  // Confirm that the new pavement is not merely present underneath grass/terrain:
  // at three points in every bay it must be the first visible surface hit from above.
  function auditServicePaving(){
    const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),rows=[];
    for(let team=0;team<10;team++){
      const floor=floors.find(x=>x.userData.team===team),work=W.pitPose(W.pitBoxS(team),team,'STOP'),front=garageFrontWorld(team),dir=front.clone().sub(work.p).setY(0).normalize();
      for(const fraction of[.28,.55,.80]){
        const p=work.p.clone().addScaledVector(dir,1.32+(work.p.distanceTo(front)-1.14)*fraction);p.y=Math.max(work.p.y,front.y)+5;
        ray.set(p,down);
        const hits=ray.intersectObjects(W.scene.children,true).filter(h=>h.object?.visible!==false);
        const top=hits[0]?.object||null;
        rows.push({team,fraction,hit:!!top?.userData?.pitServicePaving,topName:top?.name||null,distance:hits[0]?.distance??null});
      }
    }
    return{owner:'runtime-pit-service-paving-audit-v2',hitCount:rows.filter(r=>r.hit).length,total:rows.length,rows};
  }
  const servicePavingAudit=auditServicePaving();

  pit.servicePaving=pavingRoot;pit.serviceFloors=floors;pit.servicePavingAudit=servicePavingAudit;pit.buildingClearanceAudit=buildingClearanceAudit;
  pit.garageFrontWorld=garageFrontWorld;pit.laneStartUF=laneStartUF;pit.laneEndUF=laneEndUF;

  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{},runtimePit={...(a.runtimePit||{})};
    return{
      ...a,version:'runtime-2026.09.15-r7',
      runtimePit:{...runtimePit,
        buildingClearanceOwner:buildingClearanceAudit.owner,
        suppressedLegacyBuildingGroups:buildingClearanceAudit.suppressed,
        legacyBuildingIntrusionsAfter:buildingClearanceAudit.remaining,
        buildingClearanceBoxes:buildingClearanceAudit.clearanceBoxes,
        servicePavingOwner:'runtime-pit-service-paving-v2',
        servicePavingFloors:floors.length,
        servicePavingTopHits:servicePavingAudit.hitCount,
        servicePavingTopTotal:servicePavingAudit.total
      },
      notes:[...(a.notes||[]),
        'legacy ground-level buildings are excluded using actual pit-lane and garage world coordinates',
        'ten overlapping raised service-floor slabs connect each working box to its actual garage threshold',
        'paving audit requires the new floor to be the topmost visible surface rather than buried under terrain'
      ]
    };
  };
  W.circuitAudit=W.auditCircuit();
  return W;
}
