import {buildWorld as buildV26World} from './v26-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV26World(THREE,TRACK,settings,circuitName),baseMake=W.makeCar.bind(W);
  const target={formula:{length:5.50,width:1.90,heightScale:.86},gt:{length:5.05,width:2.05,heightScale:.90},proto:{length:5.10,width:2.00,heightScale:.90},hyper:{length:5.05,width:2.00,heightScale:.90},lmh:{length:5.05,width:2.00,heightScale:.90},touring:{length:4.80,width:1.95,heightScale:.92},supercar:{length:4.75,width:2.00,heightScale:.92}};
  W.makeCar=(color,type)=>{const car=baseMake(color,type),d=car.userData?.dims,t=target[type]||target.gt;if(!d)return car;const sx=t.width/d.width,sz=t.length/d.length,sy=t.heightScale;car.scale.set(sx,sy,sz);car.userData.originalDims={...d};car.userData.dims={length:t.length,width:t.width};const a=car.userData.cameraAnchors;if(a){for(const k of Object.keys(a)){const v=a[k];if(Array.isArray(v)&&v.length>=3)a[k]=[v[0]*sx,v[1]*sy,v[2]*sz];}}car.userData.realScale={sx,sy,sz,target:{...t}};return car;};
  W.roadWidth=14.4;W.vehicleDimensionTargets=target;

  const root=new THREE.Group();root.name='PHYSICAL_BARRIERS_V38';W.scene.add(root);
  const offset=8.8,width=.34,height=.88,count=Math.max(640,Math.min(1400,Math.round(W.total/4.5))),step=W.total/count;
  const railMat=new THREE.MeshStandardMaterial({color:0xaeb5b8,metalness:.72,roughness:.36,side:THREE.DoubleSide}),postMat=new THREE.MeshStandardMaterial({color:0x697174,metalness:.58,roughness:.48}),colliders=[];
  const addTri=(arr,a,b,c)=>arr.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
  function buildSide(sideSign){const pos=[];for(let i=0;i<count;i++){const j=(i+1)%count,qa=W.sample(W.total*i/count),qb=W.sample(W.total*j/count),ca=qa.p.clone().addScaledVector(qa.side,offset*sideSign),cb=qb.p.clone().addScaledVector(qb.side,offset*sideSign),ia=ca.clone().addScaledVector(qa.side,-sideSign*width*.5),oa=ca.clone().addScaledVector(qa.side,sideSign*width*.5),ib=cb.clone().addScaledVector(qb.side,-sideSign*width*.5),ob=cb.clone().addScaledVector(qb.side,sideSign*width*.5);ia.y+=.14;oa.y+=.14;ib.y+=.14;ob.y+=.14;const tia=ia.clone();tia.y+=height;const toa=oa.clone();toa.y+=height;const tib=ib.clone();tib.y+=height;const tob=ob.clone();tob.y+=height;addTri(pos,ia,ib,tia);addTri(pos,tia,ib,tib);addTri(pos,oa,toa,ob);addTri(pos,toa,tob,ob);addTri(pos,tia,tib,toa);addTri(pos,toa,tib,tob);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();const mesh=new THREE.Mesh(g,railMat);mesh.name=sideSign>0?'SMOOTH_GUARDRAIL_RIGHT':'SMOOTH_GUARDRAIL_LEFT';mesh.receiveShadow=true;root.add(mesh);return mesh;}
  const right=buildSide(1),left=buildSide(-1);
  for(let i=0;i<count;i++){const s=W.total*i/count,q=W.sample(s);for(const sideSign of[-1,1]){const p=q.p.clone().addScaledVector(q.side,offset*sideSign);p.y+=.58;colliders.push({index:i,sideSign,s,p,t:q.t.clone().setY(0).normalize(),side:q.side.clone().setY(0).normalize(),halfLength:step*.62,halfWidth:width*.5,height});}}

  const postGeo=new THREE.BoxGeometry(.13,1.10,.13),posts=new THREE.InstancedMesh(postGeo,postMat,Math.ceil(count/3)*2),dummy=new THREE.Object3D();let pi=0;
  for(let i=0;i<count;i+=3){const q=W.sample(W.total*i/count),yaw=Math.atan2(q.t.x,q.t.z);for(const sideSign of[-1,1]){dummy.position.copy(q.p).addScaledVector(q.side,offset*sideSign);dummy.position.y+=.58;dummy.rotation.set(0,yaw,0);dummy.scale.set(1,1,1);dummy.updateMatrix();posts.setMatrixAt(pi++,dummy.matrix);}}
  posts.count=pi;posts.instanceMatrix.needsUpdate=true;posts.receiveShadow=true;root.add(posts);

  const tyreGeo=new THREE.TorusGeometry(.33,.12,7,12);tyreGeo.rotateY(Math.PI/2);const tyreBlack=new THREE.MeshStandardMaterial({color:0x121212,roughness:.94}),tyreRed=new THREE.MeshStandardMaterial({color:0xd83a32,roughness:.80}),zones=[];
  for(let i=0;i<count;i++){const s=W.total*i/count;if((W.braking?.(s)||0)>.72&&i%10===0)zones.push(i);}const maxTyres=Math.max(1,zones.length*2*10),black=new THREE.InstancedMesh(tyreGeo,tyreBlack,maxTyres),red=new THREE.InstancedMesh(tyreGeo,tyreRed,maxTyres);let bi=0,ri=0;
  for(const i of zones){const q=W.sample(W.total*i/count),yaw=Math.atan2(q.t.x,q.t.z);for(const sideSign of[-1,1])for(let z=-2;z<=2;z++)for(let y=0;y<2;y++){dummy.position.copy(q.p).addScaledVector(q.side,offset*sideSign-.30*sideSign);dummy.position.y+=.34+y*.52;dummy.position.addScaledVector(q.t,z*.58);dummy.rotation.set(0,yaw,Math.PI/2);dummy.scale.set(1,1,1);dummy.updateMatrix();if((z+y)%3===0)red.setMatrixAt(ri++,dummy.matrix);else black.setMatrixAt(bi++,dummy.matrix);}}
  black.count=bi;red.count=ri;black.instanceMatrix.needsUpdate=true;red.instanceMatrix.needsUpdate=true;black.receiveShadow=red.receiveShadow=true;black.name='TYRE_BARRIER_BLACK';red.name='TYRE_BARRIER_RED';root.add(black,red);

  const wrap=i=>(i%count+count)%count,hitResult={collider:null,inward:new THREE.Vector3(),penetration:0,long:0,normal:0,forwardX:0,forwardZ:1};
  W.barrierContact=car=>{
    if(!car?.mesh||car.retired)return null;const base=wrap(Math.round(((car.s||0)/W.total)*count)),pos=car.mesh.position,yaw=car.mesh.rotation?.y||0,fx=Math.sin(yaw),fz=Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw),halfL=(car.length||car.mesh?.userData?.dims?.length||5.1)*.5,halfW=(car.width||car.mesh?.userData?.dims?.width||2)*.5;let best=null,bestPen=-1,bestLong=0,bestNormal=0;
    for(let di=-3;di<=3;di++){const idx=wrap(base+di);for(let sidx=0;sidx<2;sidx++){const c=colliders[idx*2+sidx],dx=pos.x-c.p.x,dz=pos.z-c.p.z,long=dx*c.t.x+dz*c.t.z,normal=dx*c.side.x+dz*c.side.z,normalExtent=Math.abs(fx*c.side.x+fz*c.side.z)*halfL+Math.abs(rx*c.side.x+rz*c.side.z)*halfW,longExtent=Math.abs(fx*c.t.x+fz*c.t.z)*halfL+Math.abs(rx*c.t.x+rz*c.t.z)*halfW,penN=c.halfWidth+normalExtent-Math.abs(normal),penL=c.halfLength+longExtent-Math.abs(long);if(penN>=0&&penL>=0&&penN>bestPen){bestPen=penN;best=c;bestLong=long;bestNormal=normal;}}}
    if(!best)return null;hitResult.collider=best;hitResult.inward.copy(best.side).multiplyScalar(-best.sideSign);hitResult.penetration=Math.min(bestPen,1.2);hitResult.long=bestLong;hitResult.normal=bestNormal;hitResult.forwardX=fx;hitResult.forwardZ=fz;return hitResult;
  };
  W.trackBarriers={root,rails:{left,right},posts,tyres:{black,red},colliders,count,offset,step,smooth:true,instancedTyres:true};

  W.updateShadowVisibility=(cars=[])=>{const cp=W.camera.position;for(const c of cars){if(!c.mesh)continue;let list=c.mesh.userData.v38ShadowMeshes;if(!list){list=[];c.mesh.traverse(o=>{if(o.isMesh&&o.castShadow)list.push(o);});c.mesh.userData.v38ShadowMeshes=list;}const dx=c.mesh.position.x-cp.x,dy=c.mesh.position.y-cp.y,dz=c.mesh.position.z-cp.z,enable=c.mesh.visible!==false&&(dx*dx+dy*dy+dz*dz)<360*360;for(const m of list)if(m.castShadow!==enable)m.castShadow=enable;}};
  return W;
}
