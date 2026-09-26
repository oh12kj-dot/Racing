import {buildWorld as buildV26World} from './v26-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV26World(THREE,TRACK,settings,circuitName);
  const root=new THREE.Group();root.name='PHYSICAL_BARRIERS_V33';W.scene.add(root);
  const count=Math.max(320,Math.min(620,Math.round(W.total/11.5))),step=W.total/count,offset=8.8;
  const railGeo=new THREE.BoxGeometry(.34,.88,step*1.10),postGeo=new THREE.BoxGeometry(.16,1.12,.16);
  const railMat=new THREE.MeshStandardMaterial({color:0xaeb5b8,metalness:.72,roughness:.36});
  const postMat=new THREE.MeshStandardMaterial({color:0x697174,metalness:.58,roughness:.48});
  const rails=new THREE.InstancedMesh(railGeo,railMat,count*2),posts=new THREE.InstancedMesh(postGeo,postMat,count*2);
  rails.name='TRACK_GUARDRAILS';posts.name='TRACK_GUARDRAIL_POSTS';rails.castShadow=false;rails.receiveShadow=true;posts.castShadow=false;posts.receiveShadow=true;
  const matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),colliders=[];
  for(let i=0;i<count;i++){
    const s=W.total*i/count,q=W.sample(s),yaw=Math.atan2(q.t.x,q.t.z);quat.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    for(const sideSign of[-1,1]){
      const p=q.p.clone().addScaledVector(q.side,offset*sideSign);p.y+=.58;
      const k=i*2+(sideSign>0?1:0);matrix.compose(p,quat,scale);rails.setMatrixAt(k,matrix);posts.setMatrixAt(k,matrix);
      colliders.push({index:i,sideSign,s,p:p.clone(),t:q.t.clone().setY(0).normalize(),side:q.side.clone().setY(0).normalize(),halfLength:step*.55,halfWidth:.17,height:.88});
    }
  }
  rails.instanceMatrix.needsUpdate=true;posts.instanceMatrix.needsUpdate=true;root.add(rails,posts);

  // Add highly visible tyre stacks at the heaviest braking zones. They are real meshes
  // and share the same collision line as the guardrail behind them.
  const tyreMat=new THREE.MeshStandardMaterial({color:0x121212,roughness:.94}),tyreAccent=new THREE.MeshStandardMaterial({color:0xd83a32,roughness:.80});
  const tyreGeo=new THREE.TorusGeometry(.33,.12,7,12);tyreGeo.rotateY(Math.PI/2);
  const brakingZones=[];
  for(let i=0;i<count;i++){
    const s=W.total*i/count,load=W.braking?.(s)||0;if(load>.72&&i%4===0)brakingZones.push(i);
  }
  for(const i of brakingZones.slice(0,70)){
    const q=W.sample(W.total*i/count),yaw=Math.atan2(q.t.x,q.t.z);
    for(const sideSign of[-1,1]){
      const g=new THREE.Group();g.name='TYRE_BARRIER';g.position.copy(q.p).addScaledVector(q.side,offset*sideSign-.30*sideSign);g.position.y+=.34;g.rotation.y=yaw;
      for(let z=-2;z<=2;z++)for(let y=0;y<2;y++){
        const m=new THREE.Mesh(tyreGeo,(z+y)%3===0?tyreAccent:tyreMat);m.position.set(0,y*.52,z*.58);m.rotation.z=Math.PI/2;g.add(m);
      }
      root.add(g);
    }
  }

  const wrap=i=>(i%count+count)%count;
  function carExtents(car,c){
    const yaw=car.mesh?.rotation?.y||0,forward=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const L=(car.length||car.mesh?.userData?.dims?.length||6.8)*.5,Wd=(car.width||car.mesh?.userData?.dims?.width||3.0)*.5;
    const normal=c.side,long=c.t;
    return{normal:Math.abs(forward.dot(normal))*L+Math.abs(right.dot(normal))*Wd,long:Math.abs(forward.dot(long))*L+Math.abs(right.dot(long))*Wd,forward,right};
  }
  W.barrierContact=car=>{
    if(!car?.mesh||car.retired)return null;
    const base=wrap(Math.round(((car.s||0)/W.total)*count)),pos=car.mesh.position,best=[];
    for(let di=-2;di<=2;di++){
      const idx=wrap(base+di);
      for(const sideSign of[-1,1]){
        const c=colliders[idx*2+(sideSign>0?1:0)],dx=pos.x-c.p.x,dz=pos.z-c.p.z,long=dx*c.t.x+dz*c.t.z,normal=dx*c.side.x+dz*c.side.z,e=carExtents(car,c);
        const penN=c.halfWidth+e.normal-Math.abs(normal),penL=c.halfLength+e.long-Math.abs(long);
        if(penN>=0&&penL>=0){
          const inward=c.side.clone().multiplyScalar(-c.sideSign),penetration=Math.min(penN,1.5);best.push({collider:c,inward,penetration,long,normal,forward:e.forward});
        }
      }
    }
    if(!best.length)return null;best.sort((a,b)=>b.penetration-a.penetration);return best[0];
  };
  W.trackBarriers={root,rails,posts,colliders,count,offset,step};
  return W;
}
