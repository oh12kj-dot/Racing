import {buildWorld as buildV6World} from './v6-world.js';

export function buildWorld(THREE,TRACK){
  const W=buildV6World(THREE,TRACK);
  W.scene.traverse(o=>{
    if(!o.isMesh||!o.geometry)return;
    const p=o.geometry.parameters;
    if(o.geometry.type==='PlaneGeometry'&&p?.width>=4000&&p?.height>=4000){
      o.position.y=-3.2;
      o.receiveShadow=false;
      o.userData.farGround=true;
    }
  });
  const N=1200;
  W.scene.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||!o.geometry)return;
    const pos=o.geometry.getAttribute?.('position');
    if(!pos||pos.count!==N*2)return;
    const c0=W.sample(0).p;
    const x0=pos.getX(0),z0=pos.getZ(0);
    const nominal=Math.hypot(x0-c0.x,z0-c0.z);
    if(nominal<=10.2)return;
    for(let i=0;i<N;i++){
      const q=W.sample(W.total*i/N).p;
      if(q.y<2.6)continue;
      const bridgeHalfWidth=9.65;
      for(const vi of [i*2,i*2+1]){
        const x=pos.getX(vi),z=pos.getZ(vi),dx=x-q.x,dz=z-q.z,d=Math.hypot(dx,dz);
        if(d>bridgeHalfWidth&&d>0.001){
          const k=bridgeHalfWidth/d;
          pos.setX(vi,q.x+dx*k);
          pos.setZ(vi,q.z+dz*k);
        }
      }
    }
    pos.needsUpdate=true;
    o.geometry.computeVertexNormals();
    o.geometry.computeBoundingSphere();
  });
  W.cameraMinClearance=0.9;
  return W;
}
