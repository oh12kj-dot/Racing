import {buildWorld as buildWorldBase} from './world-base.js';
import {SUZUKA_PIT} from './config.js';

// Final safety pass for the V42 scene. This runs after the legacy world stack has
// finished creating scenery, so visual props cannot survive on the racing surface
// or across the pit-entry/exit path. It also rebuilds the coarse green terrain at
// a higher resolution and keeps it safely below paved surfaces.
export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildWorldBase(THREE,TRACK,settings,circuitName);
  if(!/suzuka/i.test(String(circuitName||'')))return W;

  const total=Math.max(1,Number(W.total)||1),roadHalf=Math.max(6.8,(Number(W.roadWidth)||14.4)*.5);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  const wrap=s=>((s%total)+total)%total;

  const trackPts=[];
  const TRACK_SAMPLES=1200;
  for(let i=0;i<TRACK_SAMPLES;i++){
    const q=W.sample(total*i/TRACK_SAMPLES);trackPts.push({x:q.p.x,y:q.p.y,z:q.p.z});
  }

  const pitPts=[];
  const PIT_SAMPLES=240;
  for(let i=0;i<PIT_SAMPLES;i++){
    const uf=SUZUKA_PIT.entryUF+(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.entryUF)*i/(PIT_SAMPLES-1),s=wrap(uf*total);
    const q=W.pitPose?.(s,0,'ENTRY')||W.sample(s,Number(W.pitOffsetAtS?.(s))||Number(W.pitLaneOffset)||0);
    pitPts.push({x:q.p.x,y:q.p.y,z:q.p.z,uf});
  }

  function nearest(points,x,z,predicate){
    let best=Infinity,hit=null;
    for(const p of points){
      if(predicate&&!predicate(p))continue;
      const dx=x-p.x,dz=z-p.z,d=dx*dx+dz*dz;
      if(d<best){best=d;hit=p;}
    }
    return{d:Math.sqrt(best),p:hit};
  }
  const inPitApproach=p=>p.uf<=SUZUKA_PIT.fullUF+.004||p.uf>=SUZUKA_PIT.exitBeginUF-.004;

  // Rebuild the green venue terrain with a denser grid. The old 72 x 48 mesh
  // made elevation transitions visibly faceted, and broad triangles could cut
  // through the road/pit ribbons. The new mesh follows the same height field,
  // then receives a small undercut beneath paved corridors.
  let terrainRebuilt=false;
  const terrain=W.terrain?.mesh||W.scene.getObjectByName?.('SUZUKA_TERRAIN_RUNTIME');
  if(terrain?.isMesh&&terrain.geometry&&typeof W.terrainHeightAt==='function'){
    terrain.geometry.computeBoundingBox?.();
    const bb=terrain.geometry.boundingBox;
    if(bb&&!bb.isEmpty()){
      const nx=144,nz=96,pos=[],uv=[],ind=[];
      const minX=bb.min.x,maxX=bb.max.x,minZ=bb.min.z,maxZ=bb.max.z;
      for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
        const u=ix/nx,v=iz/nz,x=minX+(maxX-minX)*u,z=minZ+(maxZ-minZ)*v;
        let y=W.terrainHeightAt(x,z);
        const tr=nearest(trackPts,x,z);
        if(tr.p&&tr.d<roadHalf+8){
          const t=smooth((tr.d-(roadHalf+1.5))/6.5),under=tr.p.y-.34*(1-t)-.10*t;
          y=Math.min(y,under);
        }
        const pit=nearest(pitPts,x,z,inPitApproach);
        if(pit.p&&pit.d<8.5){
          const t=smooth((pit.d-4.5)/4),under=pit.p.y-.32*(1-t)-.08*t;
          y=Math.min(y,under);
        }
        pos.push(x,y,z);uv.push(u*34,v*24);
      }
      for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
        const a=iz*(nx+1)+ix,b=a+1,c=(iz+1)*(nx+1)+ix,d=c+1;ind.push(a,c,b,b,c,d);
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ind);geo.computeVertexNormals();
      terrain.geometry.dispose?.();terrain.geometry=geo;terrainRebuilt=true;
      if(W.terrain){W.terrain.segmentsX=nx;W.terrain.segmentsZ=nz;W.terrain.runtimeRoadUndercut=true;}
    }
  }

  // AABB-to-centreline test in X/Z. We only suppress solid geometry that reaches
  // normal car height, so road ribbons, paint, kerbs and terrain are untouched.
  function boxDistanceXZ(box,p){
    const dx=p.x<box.min.x?box.min.x-p.x:p.x>box.max.x?p.x-box.max.x:0;
    const dz=p.z<box.min.z?box.min.z-p.z:p.z>box.max.z?p.z-box.max.z:0;
    return Math.hypot(dx,dz);
  }
  function corridorHit(box,points,clearance,predicate){
    for(const p of points){
      if(predicate&&!predicate(p))continue;
      if(boxDistanceXZ(box,p)>clearance)continue;
      if(box.min.y>p.y+2.25||box.max.y<p.y-.55)continue;
      return true;
    }
    return false;
  }
  const protectedSurfaceName=/TRACK_SURFACE|ROAD_SURFACE|TERRAIN|ASPHALT|KERB|CURB|RACING_LINE|PIT_LANE|PIT_ASPHALT|PIT_APRON/i;
  const overheadName=/BRIDGE|OVERPASS/i;
  let removedMeshes=0,removedInstances=0;

  const solidMeshes=[];
  W.scene.traverse(o=>{
    if(!o?.isMesh||o.isInstancedMesh||!o.geometry||!o.visible)return;
    const names=[];let a=o;for(let n=0;a&&n<4;n++,a=a.parent)names.push(String(a.name||''));
    const tag=names.join(' ');if(protectedSurfaceName.test(tag)||overheadName.test(tag))return;
    const box=new THREE.Box3().setFromObject(o);if(box.isEmpty()||box.max.y-box.min.y<.36)return;
    if(corridorHit(box,trackPts,roadHalf+.18)||corridorHit(box,pitPts,5.8,inPitApproach))solidMeshes.push(o);
  });
  for(const o of solidMeshes){
    if(!o.parent)continue;o.parent.remove(o);removedMeshes++;
  }

  // Instanced trees/posts/props need per-instance handling; removing the whole
  // InstancedMesh would erase valid scenery elsewhere. Collapse only the instances
  // whose actual footprint intrudes into the protected corridors. Low kerbs are
  // deliberately excluded by the height gate.
  const mat=new THREE.Matrix4(),worldMat=new THREE.Matrix4(),pos3=new THREE.Vector3(),quat=new THREE.Quaternion(),scale3=new THREE.Vector3(),size=new THREE.Vector3();
  W.scene.traverse(o=>{
    if(!o?.isInstancedMesh||!o.geometry||!o.visible)return;
    const tag=String(o.name||'');if(protectedSurfaceName.test(tag)||overheadName.test(tag))return;
    o.geometry.computeBoundingBox?.();const gb=o.geometry.boundingBox;if(!gb)return;gb.getSize(size);if(size.y<.36)return;
    o.updateWorldMatrix?.(true,false);
    let changed=false;
    for(let i=0;i<o.count;i++){
      o.getMatrixAt(i,mat);worldMat.multiplyMatrices(o.matrixWorld,mat);worldMat.decompose(pos3,quat,scale3);
      const halfX=Math.abs(size.x*scale3.x)*.5,halfY=Math.abs(size.y*scale3.y)*.5,halfZ=Math.abs(size.z*scale3.z)*.5;
      const box=new THREE.Box3(new THREE.Vector3(pos3.x-halfX,pos3.y-halfY,pos3.z-halfZ),new THREE.Vector3(pos3.x+halfX,pos3.y+halfY,pos3.z+halfZ));
      if(!corridorHit(box,trackPts,roadHalf+.18)&&!corridorHit(box,pitPts,5.8,inPitApproach))continue;
      o.getMatrixAt(i,mat);mat.decompose(pos3,quat,scale3);scale3.setScalar(.001);mat.compose(pos3,quat,scale3);o.setMatrixAt(i,mat);removedInstances++;changed=true;
    }
    if(changed)o.instanceMatrix.needsUpdate=true;
  });

  W.finalSceneHygiene={owner:'runtime-v42-final-hygiene-v1',terrainRebuilt,terrainSegments:terrainRebuilt?[144,96]:null,trackClearance:roadHalf+.18,pitApproachClearance:5.8,removedMeshes,removedInstances};
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{const a=priorAudit?priorAudit():{};return{...a,finalSceneHygiene:{...W.finalSceneHygiene},notes:[...(a.notes||[]),'final V42 pass keeps solid scenery off the racing surface and pit entry/exit, and refines green terrain to prevent jagged road overlap']};};
  W.circuitAudit=W.auditCircuit();
  W.scene.updateMatrixWorld(true);
  return W;
}
