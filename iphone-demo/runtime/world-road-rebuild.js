import {buildWorld as buildTrajectoryWorld} from './world-trajectory-lines.js';

function buildClosedRibbon(THREE,W,{name,centerOffset=0,halfWidth,count,lift,material}){
  const total=Math.max(1,Number(W.total)||1),positions=[],uvs=[],indices=[];
  for(let i=0;i<=count;i++){
    const s=i===count?0:total*i/count,v=i/count;
    const left=W.sample(s,centerOffset-halfWidth)?.p,right=W.sample(s,centerOffset+halfWidth)?.p;
    if(!left||!right)throw new Error(`Road rebuild sample failed at ${i}/${count}`);
    positions.push(left.x,left.y+lift,left.z,right.x,right.y+lift,right.z);
    uvs.push(0,v,1,v);
  }
  for(let i=0;i<count;i++){
    const a=i*2,b=a+1,c=(i+1)*2,d=c+1;
    indices.push(a,b,c,b,d,c);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=false;
  mesh.userData={roadSurfaceRebuild:true,authoritativeRoadSurface:true};
  return mesh;
}

function removeFloatingLegacyRacingLine(W){
  const root=W.scene?.getObjectByName?.('V16_WORLD');
  if(!root)return 0;
  const remove=[];
  root.traverse?.(o=>{
    if(!o?.isMesh||!o.material||Array.isArray(o.material))return;
    const pos=o.geometry?.getAttribute?.('position'),m=o.material;
    const legacyRibbon=o.renderOrder===3&&m.transparent===true&&m.depthWrite===false&&pos?.count===840;
    if(legacyRibbon)remove.push(o);
  });
  for(const o of remove){
    o.parent?.remove(o);
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  }
  return remove.length;
}

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildTrajectoryWorld(THREE,TRACK,settings,circuitName);
  const total=Math.max(1,Number(W.total)||1);
  if(typeof W.sample!=='function'||!W.scene)return W;

  const previous=W.scene.getObjectByName?.('ROAD_SURFACE_REBUILD_V1');
  if(previous?.parent)previous.parent.remove(previous);

  // The old V16 dry-line visual is a translucent 2.7 m ribbon. world-depth later
  // lifts that geometry by another 5.2 cm, leaving it about 13.5 cm above the
  // sampled road surface. It looks like a transparent sheet underneath the cars,
  // so remove only that obsolete visual mesh; racing-line physics stay untouched.
  const floatingLegacyRacingLinesRemoved=removeFloatingLegacyRacingLine(W);

  const root=new THREE.Group();root.name='ROAD_SURFACE_REBUILD_V1';root.userData={owner:'runtime-road-surface-rebuild-v2',visualOnly:true};
  W.scene.add(root);

  const fullWidth=Number(W.roadWidth)||14.4,halfWidth=Math.max(6.2,Math.min(8.2,fullWidth*.5));
  const count=Math.max(1200,Math.min(2600,Math.round(total/2.5)));
  const asphalt=new THREE.MeshStandardMaterial({
    color:0x303438,roughness:.96,metalness:.01,side:THREE.DoubleSide
  });
  asphalt.name='ROAD_SURFACE_REBUILD_ASPHALT_MATERIAL';
  const white=new THREE.MeshBasicMaterial({color:0xf2f2ee,side:THREE.DoubleSide,depthWrite:true});
  white.name='ROAD_SURFACE_REBUILD_EDGE_MATERIAL';

  // Stay essentially on W.sample's physical road datum. The previous +4.5 cm
  // lift plus polygon offset/renderOrder made the road read as a separate plate.
  const roadLift=.006,lineLift=.009;
  const road=buildClosedRibbon(THREE,W,{name:'ROAD_SURFACE_REBUILT_ASPHALT',halfWidth,count,lift:roadLift,material:asphalt});
  root.add(road);
  const lineInset=.18,lineHalf=.065;
  const leftLine=buildClosedRibbon(THREE,W,{name:'ROAD_SURFACE_REBUILT_EDGE_LEFT',centerOffset:-halfWidth+lineInset,halfWidth:lineHalf,count,lift:lineLift,material:white});
  const rightLine=buildClosedRibbon(THREE,W,{name:'ROAD_SURFACE_REBUILT_EDGE_RIGHT',centerOffset:halfWidth-lineInset,halfWidth:lineHalf,count,lift:lineLift,material:white});
  root.add(leftLine,rightLine);

  W.rebuiltRoadSurface={
    owner:'runtime-road-surface-rebuild-v2',root,road,leftLine,rightLine,
    width:halfWidth*2,halfWidth,segments:count,lift:roadLift,lineLift,
    floatingLegacyRacingLinesRemoved,
    source:'W.sample',simulationGeometryChanged:false
  };
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{};
    return{...a,rebuiltRoadSurface:{owner:W.rebuiltRoadSurface.owner,width:W.rebuiltRoadSurface.width,segments:count,lift:roadLift,floatingLegacyRacingLinesRemoved,simulationGeometryChanged:false},notes:[...(a.notes||[]),'Main circuit asphalt sits on the sampled road datum and the obsolete elevated translucent V16 racing-line ribbon is removed.']};
  };
  W.circuitAudit=W.auditCircuit();
  W.scene.updateMatrixWorld(true);
  return W;
}