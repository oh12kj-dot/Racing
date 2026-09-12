import {createEnvironment as createV10Environment} from './v10-environment.js';

export function createEnvironment(W,R,settings={}){
  const E=createV10Environment(W,R,settings);
  W.scene.traverse(o=>{
    if(!o?.isMesh||o.renderOrder!==2||!o.material||Array.isArray(o.material))return;
    const m=o.material;
    if(m.transparent&&m.depthWrite===false){o.position.y+=.035;m.polygonOffset=true;m.polygonOffsetFactor=-4;m.polygonOffsetUnits=-4;m.needsUpdate=true;o.name=o.name||'WET_ROAD_OVERLAY';}
  });
  return E;
}
