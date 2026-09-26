import {buildWorld as buildV16World} from './v16-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV16World(THREE,TRACK,settings,circuitName);
  W.camera.near=.35;W.camera.far=3800;W.camera.updateProjectionMatrix();
  // Pull road decals toward the camera in depth-buffer space and separate the v16 overlays physically.
  W.scene.traverse(o=>{
    if(!o?.isMesh||!o.material||Array.isArray(o.material))return;
    const m=o.material;
    if(m.transparent&&m.depthWrite===false){m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2;m.needsUpdate=true;}
    if(o.renderOrder===3&&o.geometry?.attributes?.position){
      const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+.052);p.needsUpdate=true;o.geometry.computeBoundingSphere?.();m.polygonOffsetFactor=-5;m.polygonOffsetUnits=-5;
    }
    if(o.geometry?.type==='CircleGeometry'&&m.transparent){o.position.y+=.035;m.polygonOffsetFactor=-6;m.polygonOffsetUnits=-6;}
  });
  return W;
}
