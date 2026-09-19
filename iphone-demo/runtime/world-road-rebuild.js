import {buildWorld as buildTrajectoryWorld} from './world-trajectory-lines.js';

function buildClosedRibbon(THREE,W,{name,centerOffset=0,halfWidth,count,lift,material,renderOrder=12}){
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
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=false;mesh.renderOrder=renderOrder;
  mesh.userData={roadSurfaceRebuild:true,authoritativeRoadSurface:true};
  return mesh;
}

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildTrajectoryWorld(THREE,TRACK,settings,circuitName);
  const total=Math.max(1,Number(W.total)||1);
  if(typeof W.sample!=='function'||!W.scene)return W;

  const previous=W.scene.getObjectByName?.('ROAD_SURFACE_REBUILD_V1');
  if(previous?.parent)previous.parent.remove(previous);

  const root=new THREE.Group();root.name='ROAD_SURFACE_REBUILD_V1';root.userData={owner:'runtime-road-surface-rebuild-v1',visualOnly:true};
  W.scene.add(root);

  const fullWidth=Number(W.roadWidth)||14.4,halfWidth=Math.max(6.2,Math.min(8.2,fullWidth*.5));
  const count=Math.max(1200,Math.min(2600,Math.round(total/2.5)));
  const asphalt=new THREE.MeshStandardMaterial({
    color:0x303438,roughness:.96,metalness:.01,side:THREE.DoubleSide,
    polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2
  });
  asphalt.name='ROAD_SURFACE_REBUILD_ASPHALT_MATERIAL';
  const white=new THREE.MeshBasicMaterial({color:0xf2f2ee,side:THREE.DoubleSide,depthWrite:true});
  white.name='ROAD_SURFACE_REBUILD_EDGE_MATERIAL';

  const road=buildClosedRibbon(THREE,W,{name:'ROAD_SURFACE_REBUILT_ASPHALT',halfWidth,count,lift:.045,material:asphalt,renderOrder:12});
  root.add(road);
  const lineInset=.18,lineHalf=.065;
  const leftLine=buildClosedRibbon(THREE,W,{name:'ROAD_SURFACE_REBUILT_EDGE_LEFT',centerOffset:-halfWidth+lineInset,halfWidth:lineHalf,count,lift:.058,material:white,renderOrder:13});
  const rightLine=buildClosedRibbon(THREE,W,{name:'ROAD_SURFACE_REBUILT_EDGE_RIGHT',centerOffset:halfWidth-lineInset,halfWidth:lineHalf,count,lift:.058,material:white,renderOrder:13});
  root.add(leftLine,rightLine);

  W.rebuiltRoadSurface={
    owner:'runtime-road-surface-rebuild-v1',root,road,leftLine,rightLine,
    width:halfWidth*2,halfWidth,segments:count,lift:.045,
    source:'W.sample',simulationGeometryChanged:false
  };
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{};
    return{...a,rebuiltRoadSurface:{owner:W.rebuiltRoadSurface.owner,width:W.rebuiltRoadSurface.width,segments:count,simulationGeometryChanged:false},notes:[...(a.notes||[]),'Main circuit asphalt is rebuilt as an isolated visual ribbon from W.sample; race physics, terrain, scenery and AI geometry are unchanged.']};
  };
  W.circuitAudit=W.auditCircuit();
  W.scene.updateMatrixWorld(true);
  return W;
}
