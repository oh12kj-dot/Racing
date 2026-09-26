import {buildWorld as buildSuzukaFullWorld} from './world-suzuka-full.js';

// Terrain becomes the authoritative ground reference for Suzuka scenery. The road
// remains its own high-detail ribbon; this mesh only shapes the surrounding venue.
export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildSuzukaFullWorld(THREE,TRACK,settings,circuitName);
  if(String(circuitName||'').toUpperCase()!=='SUZUKA')return W;

  const scene=W.scene,total=Math.max(1,Number(W.total)||1),BASE_Y=-.22;
  const samples=[];
  for(let i=0;i<480;i++){
    const q=W.sample(total*i/480);samples.push({x:q.p.x,y:q.p.y,z:q.p.z});
  }
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const p of samples){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
  const margin=560,width=Math.max(2200,maxX-minX+margin*2),depth=Math.max(1500,maxZ-minZ+margin*2),cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  function terrainHeightAt(x,z){
    let best=Infinity,bestY=BASE_Y,nearMin=Infinity,nearCount=0;
    for(const p of samples){
      const dx=x-p.x,dz=z-p.z,d=dx*dx+dz*dz;
      if(d<best){best=d;bestY=p.y;}
    }
    const dist=Math.sqrt(best);
    // At the figure-eight crossing use the lower branch as terrain, leaving the
    // upper branch visually and physically legible as an overpass.
    if(dist<34){
      for(const p of samples){const dx=x-p.x,dz=z-p.z,d=dx*dx+dz*dz;if(d<36*36){nearMin=Math.min(nearMin,p.y);nearCount++;}}
      if(nearCount>1&&Number.isFinite(nearMin))bestY=Math.min(bestY,nearMin);
    }
    if(dist>=240)return BASE_Y;
    const influence=1-smooth((dist-16)/(240-16));
    return BASE_Y+(bestY-.20-BASE_Y)*influence;
  }

  let legacyGround=null;
  for(const o of [...scene.children]){
    const p=o?.geometry?.parameters||{};
    if(o?.isMesh&&o.geometry?.type==='PlaneGeometry'&&(p.width||0)>=4500&&(p.height||0)>=4500){legacyGround=o;break;}
  }
  const material=legacyGround?.material?.clone?.()||new THREE.MeshStandardMaterial({color:0x708c58,roughness:1});
  if(material.color?.setHex)material.color.setHex(0x708c58);if('roughness'in material)material.roughness=1;

  const nx=72,nz=48,pos=[],uv=[],ind=[];
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const u=ix/nx,v=iz/nz,x=cx-width/2+u*width,z=cz-depth/2+v*depth,y=terrainHeightAt(x,z);
    pos.push(x,y,z);uv.push(u*34,v*24);
  }
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
    const a=iz*(nx+1)+ix,b=a+1,c=(iz+1)*(nx+1)+ix,d=c+1;ind.push(a,c,b,b,c,d);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ind);geo.computeVertexNormals();
  const terrain=new THREE.Mesh(geo,material);terrain.name='SUZUKA_TERRAIN_RUNTIME';terrain.receiveShadow=true;terrain.castShadow=false;scene.add(terrain);
  if(legacyGround?.parent){legacyGround.parent.remove(legacyGround);legacyGround.geometry?.dispose?.();}

  let minY=Infinity,maxY=-Infinity;for(let i=1;i<pos.length;i+=3){minY=Math.min(minY,pos[i]);maxY=Math.max(maxY,pos[i]);}
  W.terrainHeightAt=terrainHeightAt;
  W.terrain={owner:'runtime-suzuka-terrain-v1',mesh:terrain,baseY:BASE_Y,width,depth,segmentsX:nx,segmentsZ:nz,minY,maxY,replacedFlatGround:!!legacyGround,figureEightLowerBranch:true};
  scene.updateMatrixWorld(true);
  return W;
}
