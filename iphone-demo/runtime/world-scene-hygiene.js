import {buildWorld as buildTerrainWorld} from './world-terrain.js';

// Final visual hygiene pass for the Suzuka runtime. The underlying world still
// owns race/pit physics; terrain is now the authoritative scenery ground datum.
export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildTerrainWorld(THREE,TRACK,settings,circuitName);
  if(String(circuitName||'').toUpperCase()!=='SUZUKA')return W;

  const scene=W.scene,total=Math.max(1,Number(W.total)||1),BASE_Y=Number(W.terrain?.baseY??-.22);
  const groundYAt=(x,z)=>typeof W.terrainHeightAt==='function'?W.terrainHeightAt(Number(x)||0,Number(z)||0):BASE_Y;
  let legacyTreesRemoved=0,legacyStandsRemoved=0,legacyGantriesRemoved=0,groundedObjects=0;

  const detach=o=>{if(!o?.parent)return false;o.parent.remove(o);o.geometry?.dispose?.();return true;};

  // Remove superseded procedural scenery. These signatures belong to the oldest
  // generic venue layer; dedicated Suzuka objects own the visible scene now.
  const legacyTreeParts=[];
  scene.traverse(o=>{
    if(!o?.isMesh||o.isInstancedMesh||!o.geometry)return;
    const p=o.geometry.parameters||{};
    const trunk=o.geometry.type==='CylinderGeometry'&&Math.abs((p.height||0)-5.5)<.08&&(p.radialSegments||0)===6;
    const crown=o.geometry.type==='IcosahedronGeometry'&&(p.radius||0)>3;
    if(trunk||crown)legacyTreeParts.push(o);
  });
  for(const o of legacyTreeParts)if(detach(o))legacyTreesRemoved++;

  for(const o of [...scene.children]){
    if(!o?.isGroup||o.name)continue;
    let oldStandTiers=0,gantryPosts=0,gantryBeam=0;
    o.traverse(x=>{
      if(!x?.isMesh||x.geometry?.type!=='BoxGeometry')return;
      const p=x.geometry.parameters||{};
      if(Math.abs((p.width||0)-38)<.08&&Math.abs((p.height||0)-1.2)<.08&&Math.abs((p.depth||0)-5)<.08)oldStandTiers++;
      if(Math.abs((p.width||0)-.5)<.04&&Math.abs((p.height||0)-7)<.08&&Math.abs((p.depth||0)-.5)<.04)gantryPosts++;
      if(Math.abs((p.width||0)-19)<.08&&Math.abs((p.height||0)-.65)<.05&&Math.abs((p.depth||0)-.7)<.05)gantryBeam++;
    });
    if(oldStandTiers>=5){o.parent?.remove(o);legacyStandsRemoved++;continue;}
    if(gantryPosts>=2&&gantryBeam>=1){o.parent?.remove(o);legacyGantriesRemoved++;}
  }

  // Ground remote scenery against the terrain height field. Bridges and race
  // equipment keep track-relative elevation because they intentionally span or
  // attach to the racing surface.
  const fullRoot=W.suzukaFullScene?.root;
  if(fullRoot){
    for(const o of fullRoot.children){
      if(!o?.isGroup||String(o.name||'').includes('BRIDGE'))continue;
      const y=groundYAt(o.position?.x,o.position?.z);
      if(Math.abs((o.position?.y??y)-y)>.02){o.position.y=y;groundedObjects++;}
    }
  }
  for(const row of W.suzukaFacilities?.facilities||[]){
    const o=row?.object,off=Math.abs(Number(row?.offset)||0);
    if(!o||off<28||row.type==='race-equipment')continue;
    const y=groundYAt(o.position?.x,o.position?.z);
    if(Math.abs((o.position?.y??y)-y)>.02){o.position.y=y;groundedObjects++;}
  }
  scene.updateMatrixWorld(true);

  for(const name of['SUZUKA_PERIMETER_TREE_TRUNKS','SUZUKA_PERIMETER_TREE_CROWNS']){
    const o=scene.getObjectByName?.(name);if(o?.parent){o.parent.remove(o);o.geometry?.dispose?.();}
  }

  const trackPts=[];
  for(let i=0;i<960;i++){
    const p=W.sample(total*i/960).p;trackPts.push({x:p.x,z:p.z});
  }
  const minTrackDistSq=(x,z)=>{
    let best=Infinity;
    for(const p of trackPts){const dx=x-p.x,dz=z-p.z,d=dx*dx+dz*dz;if(d<best)best=d;}
    return best;
  };

  const obstructionBoxes=[];
  const addBoxes=root=>{
    if(!root)return;
    for(const o of root.children){
      if(!o?.isGroup)continue;
      if(/SERVICE_ROAD|MARSHAL_POST|TV_CAMERA_TOWER/.test(String(o.name||'')))continue;
      const b=new THREE.Box3().setFromObject(o);if(!b.isEmpty())obstructionBoxes.push(b);
    }
  };
  addBoxes(fullRoot);addBoxes(W.suzukaFacilities?.root);
  const blocked=(x,z)=>obstructionBoxes.some(b=>x>b.min.x-4&&x<b.max.x+4&&z>b.min.z-4&&z<b.max.z+4);

  const targetTrees=168,maxCandidates=2200,trunkGeo=new THREE.CylinderGeometry(.16,.24,2.4,5),crownGeo=new THREE.ConeGeometry(1.75,4.7,6);
  const trunkMat=new THREE.MeshStandardMaterial({color:0x273028,roughness:.96}),crownMat=new THREE.MeshStandardMaterial({color:0x315b38,roughness:.94});
  const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,targetTrees),crowns=new THREE.InstancedMesh(crownGeo,crownMat,targetTrees),dummy=new THREE.Object3D();
  trunks.name='SUZUKA_PERIMETER_TREE_TRUNKS';crowns.name='SUZUKA_PERIMETER_TREE_CROWNS';
  let safeCount=0,minClearance=Infinity;
  for(let i=0;i<maxCandidates&&safeCount<targetTrees;i++){
    let uf=((i*.61803398875+.071)%1);if(uf>.965||uf<.055)uf=.055+(uf%.91);
    const side=i%2?1:-1,offset=side*(56+((i*23)%43)),q=W.sample(uf*total,offset),dSq=minTrackDistSq(q.p.x,q.p.z);
    if(dSq<42*42||blocked(q.p.x,q.p.z))continue;
    const scale=.76+((i*37)%31)/100,idx=safeCount++,groundY=groundYAt(q.p.x,q.p.z);
    minClearance=Math.min(minClearance,Math.sqrt(dSq));
    dummy.position.set(q.p.x,groundY+1.2*scale,q.p.z);dummy.rotation.set(0,(i*2.399)%6.28,0);dummy.scale.set(scale,scale,scale);dummy.updateMatrix();trunks.setMatrixAt(idx,dummy.matrix);
    dummy.position.set(q.p.x,groundY+4.05*scale,q.p.z);dummy.rotation.set(0,(i*1.731)%6.28,0);dummy.scale.set(scale,scale,scale);dummy.updateMatrix();crowns.setMatrixAt(idx,dummy.matrix);
  }
  trunks.count=safeCount;crowns.count=safeCount;trunks.instanceMatrix.needsUpdate=true;crowns.instanceMatrix.needsUpdate=true;
  fullRoot?.add(trunks,crowns);

  if(W.suzukaFullScene)W.suzukaFullScene.treeInstances=safeCount;
  W.sceneHygiene={
    owner:'runtime-scene-hygiene-v2',groundModel:'terrain-height-field',baseGroundY:BASE_Y,wholeCircuitTreeClearance:true,minTreeTrackClearance:Number.isFinite(minClearance)?minClearance:null,
    safeTreeInstances:safeCount,legacyTreesRemoved,legacyStandsRemoved,legacyGantriesRemoved,groundedObjects
  };

  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{},full={...(a.suzukaFullScene||{})};
    if(W.suzukaFullScene)full.treeInstances=W.suzukaFullScene.treeInstances;
    return{...a,version:'runtime-2026.09.15-r15',terrain:{...W.terrain,mesh:undefined},suzukaFullScene:full,sceneHygiene:{...W.sceneHygiene},notes:[...(a.notes||[]),'Suzuka scenery now uses a terrain height field, removes superseded generic scenery, and enforces whole-circuit tree clearance.']};
  };
  W.circuitAudit=W.auditCircuit();
  scene.updateMatrixWorld(true);
  return W;
}
