import {buildWorld as buildV7World} from './world-geometry-correction.js';

export function buildWorld(THREE,TRACK){
  const W=buildV7World(THREE,TRACK);

  // Build a dense 2D centre-line cache. Scenery clearance is checked against
  // the whole circuit, not only the segment that originally spawned it.
  const trackPts=[];
  for(let i=0;i<720;i++){
    const p=W.sample(W.total*i/720).p;
    trackPts.push({x:p.x,z:p.z});
  }
  const minTrackDistSq=(x,z)=>{
    let best=Infinity;
    for(const p of trackPts){
      const dx=x-p.x,dz=z-p.z,d=dx*dx+dz*dz;
      if(d<best)best=d;
    }
    return best;
  };

  // Trees were spawned far from their own source segment, but on a figure-eight
  // they can still land on a different part of the track. Remove any complete
  // tree whose trunk is within 28 m of any circuit centre line.
  const badTreeXZ=[];
  const all=[];
  W.scene.traverse(o=>all.push(o));
  for(const o of all){
    if(!o.isMesh||!o.geometry)continue;
    const p=o.geometry.parameters||{};
    const isTrunk=o.geometry.type==='CylinderGeometry'&&Math.abs((p.height??0)-5.5)<0.08&&(p.radialSegments??0)===6;
    if(isTrunk&&minTrackDistSq(o.position.x,o.position.z)<28*28){
      badTreeXZ.push({x:o.position.x,z:o.position.z});
    }
  }
  if(badTreeXZ.length){
    const remove=[];
    W.scene.traverse(o=>{
      if(!o.isMesh||!o.geometry)return;
      const p=o.geometry.parameters||{};
      const treePart=(o.geometry.type==='CylinderGeometry'&&Math.abs((p.height??0)-5.5)<0.08)||(o.geometry.type==='IcosahedronGeometry'&&(p.radius??0)>3);
      if(!treePart)return;
      if(badTreeXZ.some(t=>Math.hypot(o.position.x-t.x,o.position.z-t.z)<1.2))remove.push(o);
    });
    remove.forEach(o=>o.parent?.remove(o));
  }

  // Remove the original crossover supports. They were only +/-5.5 m from the
  // upper road centre, which puts them inside the paved corridor.
  const oldSupports=[];
  W.scene.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||o.geometry?.type!=='BoxGeometry')return;
    const p=o.geometry.parameters||{};
    if(Math.abs((p.width??0)-3)<0.05&&Math.abs((p.height??0)-8)<0.05&&Math.abs((p.depth??0)-3)<0.05)oldSupports.push(o);
  });

  if(oldSupports.length>=2){
    const a=new THREE.Vector3(),b=new THREE.Vector3();
    oldSupports[0].getWorldPosition(a);oldSupports[1].getWorldPosition(b);
    const mid=a.clone().add(b).multiplyScalar(.5);
    const lateral=a.clone().sub(b);lateral.y=0;lateral.normalize();
    oldSupports.forEach(o=>o.parent?.remove(o));

    const supportMat=new THREE.MeshStandardMaterial({color:0x929897,roughness:.88,metalness:.03});
    const used=[];
    for(const sign of[-1,1]){
      let chosen=null;
      for(const offset of[11.5,13,15,17.5,20,23,26]){
        const x=mid.x+lateral.x*offset*sign,z=mid.z+lateral.z*offset*sign;
        // Keep supports outside every road corridor, including the lower road.
        if(minTrackDistSq(x,z)>10.8*10.8){chosen={x,z};break;}
      }
      if(chosen){
        const m=new THREE.Mesh(new THREE.BoxGeometry(2.2,8,2.2),supportMat);
        m.position.set(chosen.x,mid.y,chosen.z);
        m.castShadow=true;m.receiveShadow=true;m.userData.safeBridgeSupport=true;
        W.scene.add(m);used.push(m);
      }
    }
  }

  W.sceneryClearanceChecked=true;
  return W;
}
