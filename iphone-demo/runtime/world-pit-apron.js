import {buildWorld as buildRealismWorld} from './world-realism.js';
import {SUZUKA_PIT,BUILDING_LAYOUT} from './config.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildRealismWorld(THREE,TRACK,settings,circuitName),pit=W.runtimePit;
  if(!pit?.root||!pit?.poseUF||!pit?.lanePoseUF)return W;

  const total=Math.max(1,Number(W.total)||1),wrap=f=>((f%1)+1)%1;
  const boxUF=team=>{let f=W.pitBoxFraction?.(team)??(SUZUKA_PIT.box0UF+team*SUZUKA_PIT.boxGapMeters/total);if(f<SUZUKA_PIT.entryUF)f+=1;return f;};
  const serviceMarginMeters=14;
  const serviceStartUF=boxUF(0)-serviceMarginMeters/total;
  const serviceEndUF=boxUF(9)+serviceMarginMeters/total;
  const garageFrontOutward=BUILDING_LAYOUT.garageCenterOffset-BUILDING_LAYOUT.garageDepth*.5;

  // Keep every legacy ground-level structure out of the whole usable pit/service
  // corridor. Previous revisions only hid objects with a few exact dimensions,
  // which left other V42 buildings (notably the large pit-entry facility) visible.
  const clearInnerOffset=-SUZUKA_PIT.laneHalfWidth-.35;
  const clearOuterOffset=garageFrontOutward-.75;
  const clearCenterOffset=(clearInnerOffset+clearOuterOffset)*.5;
  const clearRadius=(clearOuterOffset-clearInnerOffset)*.5;
  const oldRoot=W.scene.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');

  function horizontalDistanceSqToBox(p,box){
    const dx=p.x<box.min.x?box.min.x-p.x:p.x>box.max.x?p.x-box.max.x:0;
    const dz=p.z<box.min.z?box.min.z-p.z:p.z>box.max.z?p.z-box.max.z:0;
    return dx*dx+dz*dz;
  }
  function meshIntrudesServiceCorridor(mesh){
    if(!mesh?.isMesh||mesh.visible===false||!mesh.geometry)return false;
    const box=new THREE.Box3().setFromObject(mesh);
    if(box.isEmpty())return false;
    for(let n=0;n<=72;n++){
      const uf=serviceStartUF+(serviceEndUF-serviceStartUF)*n/72,q=pit.lanePoseUF(uf,clearCenterOffset),baseY=q.p.y;
      // Only ground-level pieces can physically occupy the lane/apron. Elevated
      // hospitality structures are intentionally left in place.
      if(box.min.y>baseY+2.8||box.max.y<baseY+.02)continue;
      if(horizontalDistanceSqToBox(q.p,box)<=clearRadius*clearRadius)return true;
    }
    return false;
  }
  function childIntrudesServiceCorridor(child){
    let hit=false;
    child?.traverse?.(o=>{if(!hit&&meshIntrudesServiceCorridor(o))hit=true;});
    return hit;
  }
  function suppressLegacyPitBuildings(){
    const suppressed=[];
    if(!oldRoot)return{owner:'runtime-pit-building-clearance-v2',suppressed:0,remaining:0,names:[],clearInnerOffset,clearOuterOffset,serviceStartUF,serviceEndUF};
    W.scene.updateMatrixWorld(true);
    for(let i=0;i<oldRoot.children.length;i++){
      const child=oldRoot.children[i];
      if(child.visible===false||!childIntrudesServiceCorridor(child))continue;
      child.visible=false;
      child.userData.runtimePitSuppressed='pit-service-corridor-intrusion';
      suppressed.push(child.name||`legacy-home-child-${i}`);
    }
    W.scene.updateMatrixWorld(true);
    let remaining=0;
    for(const child of oldRoot.children)if(child.visible!==false&&childIntrudesServiceCorridor(child))remaining++;
    return{owner:'runtime-pit-building-clearance-v2',suppressed:suppressed.length,remaining,names:suppressed,clearInnerOffset,clearOuterOffset,serviceStartUF,serviceEndUF};
  }
  const buildingClearanceAudit=suppressLegacyPitBuildings();

  // Pave continuously from the outer edge of the working boxes to slightly
  // underneath the garage threshold. This intentionally overlaps both surfaces
  // so terrain can never show through as a crack between pit lane and building.
  const pavingInnerOffset=(pit.workLaneShift??3.55)+1.35;
  const pavingOuterOffset=garageFrontOutward+.12;
  const pavingY=.079;
  const pavingMaterial=new THREE.MeshStandardMaterial({color:0x555b5f,roughness:.96,metalness:.015,side:THREE.DoubleSide});
  const pavingSamples=Math.max(72,Math.ceil((serviceEndUF-serviceStartUF)*total/2.1)),pos=[],ind=[];
  for(let i=0;i<pavingSamples;i++){
    const uf=serviceStartUF+(serviceEndUF-serviceStartUF)*i/(pavingSamples-1),q=pit.poseUF(uf);
    const inner=q.p.clone().addScaledVector(q.side,pavingInnerOffset),outer=q.p.clone().addScaledVector(q.side,pavingOuterOffset);
    inner.y+=pavingY;outer.y+=pavingY;
    pos.push(inner.x,inner.y,inner.z,outer.x,outer.y,outer.z);
  }
  for(let i=0;i<pavingSamples-1;i++){const a=i*2,b=a+1,c=(i+1)*2,d=c+1;ind.push(a,b,c,b,d,c);}
  const pavingGeo=new THREE.BufferGeometry();
  pavingGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  pavingGeo.setIndex(ind);pavingGeo.computeVertexNormals();pavingGeo.computeBoundingSphere();
  const servicePaving=new THREE.Mesh(pavingGeo,pavingMaterial);
  servicePaving.name='PIT_SERVICE_APRON_PAVING_RUNTIME';servicePaving.receiveShadow=true;
  servicePaving.userData={
    owner:'runtime-pit-service-paving-v1',pitServicePaving:true,
    startUF:serviceStartUF,endUF:serviceEndUF,innerOffset:pavingInnerOffset,outerOffset:pavingOuterOffset,
    width:pavingOuterOffset-pavingInnerOffset,garageFrontOutward,overlapIntoGarage:pavingOuterOffset-garageFrontOutward
  };
  pit.root.add(servicePaving);W.scene.updateMatrixWorld(true);

  function auditServicePaving(){
    const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),rows=[];
    for(let team=0;team<10;team++){
      const uf=boxUF(team),q=pit.lanePoseUF(uf,(pavingInnerOffset+pavingOuterOffset)*.5),origin=q.p.clone();origin.y+=6;
      ray.set(origin,down);
      const hit=ray.intersectObject(servicePaving,false)[0];
      rows.push({team,uf,hit:!!hit,distance:hit?.distance??null});
    }
    return{owner:'runtime-pit-service-paving-audit-v1',hitCount:rows.filter(r=>r.hit).length,total:rows.length,rows};
  }
  const servicePavingAudit=auditServicePaving();

  pit.servicePaving=servicePaving;
  pit.servicePavingAudit=servicePavingAudit;
  pit.buildingClearanceAudit=buildingClearanceAudit;
  pit.serviceStartUF=serviceStartUF;pit.serviceEndUF=serviceEndUF;
  pit.garageFrontOutward=garageFrontOutward;

  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{},runtimePit={...(a.runtimePit||{})};
    return{
      ...a,
      version:'runtime-2026.09.15-r6',
      runtimePit:{
        ...runtimePit,
        buildingClearanceOwner:buildingClearanceAudit.owner,
        suppressedLegacyBuildingGroups:buildingClearanceAudit.suppressed,
        legacyBuildingIntrusionsAfter:buildingClearanceAudit.remaining,
        buildingClearInnerOffset:clearInnerOffset,
        buildingClearOuterOffset:clearOuterOffset,
        servicePavingOwner:servicePaving.userData.owner,
        servicePavingInnerOffset:pavingInnerOffset,
        servicePavingOuterOffset:pavingOuterOffset,
        servicePavingWidth:pavingOuterOffset-pavingInnerOffset,
        servicePavingRayHits:servicePavingAudit.hitCount,
        servicePavingRayTotal:servicePavingAudit.total
      },
      notes:[
        ...(a.notes||[]),
        'legacy ground-level pit buildings are spatially excluded from the complete pit/service corridor',
        'continuous paved service apron overlaps the working-box edge and garage threshold so terrain cannot show through'
      ]
    };
  };
  W.circuitAudit=W.auditCircuit();
  return W;
}
