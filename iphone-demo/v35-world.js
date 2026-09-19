import {buildWorld as buildV34World} from './v34-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV34World(THREE,TRACK,settings,circuitName);
  const old=W.trackBarriers;
  if(old?.rails)old.rails.visible=false;
  if(old?.posts)old.posts.visible=false;

  const root=new THREE.Group();root.name='SMOOTH_PHYSICAL_BARRIERS_V35';W.scene.add(root);
  const offset=8.8,width=.34,height=.88;
  const count=Math.max(640,Math.min(1600,Math.round(W.total/4.3))),step=W.total/count;
  const railMat=new THREE.MeshStandardMaterial({color:0xaeb5b8,metalness:.72,roughness:.36,side:THREE.DoubleSide});
  const postMat=new THREE.MeshStandardMaterial({color:0x697174,metalness:.58,roughness:.48});
  const colliders=[];
  const addTri=(arr,a,b,c)=>arr.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);

  function buildSide(sideSign){
    const pos=[];
    for(let i=0;i<count;i++){
      const j=(i+1)%count,qa=W.sample(W.total*i/count),qb=W.sample(W.total*j/count);
      const ca=qa.p.clone().addScaledVector(qa.side,offset*sideSign),cb=qb.p.clone().addScaledVector(qb.side,offset*sideSign);
      const ia=ca.clone().addScaledVector(qa.side,-sideSign*width*.5),oa=ca.clone().addScaledVector(qa.side,sideSign*width*.5);
      const ib=cb.clone().addScaledVector(qb.side,-sideSign*width*.5),ob=cb.clone().addScaledVector(qb.side,sideSign*width*.5);
      const bi=ia.clone(),bo=oa.clone(),bj=ib.clone(),boo=ob.clone();
      bi.y+=.14;bo.y+=.14;bj.y+=.14;boo.y+=.14;
      const ti=bi.clone();ti.y+=height;const to=bo.clone();to.y+=height;const tj=bj.clone();tj.y+=height;const too=boo.clone();too.y+=height;
      // Inner face, outer face and top cap are continuous ribbons, so curves no longer look faceted.
      addTri(pos,bi,bj,ti);addTri(pos,ti,bj,tj);
      addTri(pos,bo,to,boo);addTri(pos,to,too,boo);
      addTri(pos,ti,tj,to);addTri(pos,to,tj,too);
      if(sideSign>0)colliders.push({index:i,sideSign,s:W.total*i/count,p:ca.clone().add(new THREE.Vector3(0,.58,0)),t:qa.t.clone().setY(0).normalize(),side:qa.side.clone().setY(0).normalize(),halfLength:step*.62,halfWidth:width*.5,height});
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();
    const mesh=new THREE.Mesh(g,railMat);mesh.name=sideSign>0?'SMOOTH_GUARDRAIL_RIGHT':'SMOOTH_GUARDRAIL_LEFT';mesh.receiveShadow=true;mesh.castShadow=false;root.add(mesh);return mesh;
  }
  const right=buildSide(1),left=buildSide(-1);

  // Rebuild collider array in deterministic [left,right] order for both sides.
  colliders.length=0;
  for(let i=0;i<count;i++){
    const s=W.total*i/count,q=W.sample(s);
    for(const sideSign of[-1,1]){
      const p=q.p.clone().addScaledVector(q.side,offset*sideSign);p.y+=.58;
      colliders.push({index:i,sideSign,s,p,t:q.t.clone().setY(0).normalize(),side:q.side.clone().setY(0).normalize(),halfLength:step*.62,halfWidth:width*.5,height});
    }
  }

  const postCount=Math.ceil(count/3)*2,postGeo=new THREE.BoxGeometry(.13,1.10,.13),posts=new THREE.InstancedMesh(postGeo,postMat,postCount),dummy=new THREE.Object3D();let pi=0;
  for(let i=0;i<count;i+=3){const q=W.sample(W.total*i/count),yaw=Math.atan2(q.t.x,q.t.z);for(const sideSign of[-1,1]){dummy.position.copy(q.p).addScaledVector(q.side,offset*sideSign);dummy.position.y+=.58;dummy.rotation.set(0,yaw,0);dummy.updateMatrix();posts.setMatrixAt(pi++,dummy.matrix);}}
  posts.count=pi;posts.instanceMatrix.needsUpdate=true;posts.receiveShadow=true;posts.castShadow=false;root.add(posts);

  const wrap=i=>(i%count+count)%count;
  function carExtents(car,c){
    const yaw=car.mesh?.rotation?.y||0,forward=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)),rightV=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const L=(car.length||car.mesh?.userData?.dims?.length||5.1)*.5,Wd=(car.width||car.mesh?.userData?.dims?.width||2.0)*.5;
    return{normal:Math.abs(forward.dot(c.side))*L+Math.abs(rightV.dot(c.side))*Wd,long:Math.abs(forward.dot(c.t))*L+Math.abs(rightV.dot(c.t))*Wd,forward};
  }
  W.barrierContact=car=>{
    if(!car?.mesh||car.retired)return null;
    const base=wrap(Math.round(((car.s||0)/W.total)*count)),pos=car.mesh.position,best=[];
    for(let di=-3;di<=3;di++){
      const idx=wrap(base+di);
      for(const sideSign of[-1,1]){
        const c=colliders[idx*2+(sideSign>0?1:0)],dx=pos.x-c.p.x,dz=pos.z-c.p.z,long=dx*c.t.x+dz*c.t.z,normal=dx*c.side.x+dz*c.side.z,e=carExtents(car,c);
        const penN=c.halfWidth+e.normal-Math.abs(normal),penL=c.halfLength+e.long-Math.abs(long);
        if(penN>=0&&penL>=0){const inward=c.side.clone().multiplyScalar(-c.sideSign),penetration=Math.min(penN,1.2);best.push({collider:c,inward,penetration,long,normal,forward:e.forward});}
      }
    }
    if(!best.length)return null;best.sort((a,b)=>b.penetration-a.penetration);return best[0];
  };
  W.trackBarriers={...(old||{}),root,rails:{left,right},posts,colliders,count,offset,step,smooth:true};
  return W;
}
