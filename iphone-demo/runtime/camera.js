import {createCamera as createLegacyCamera} from '../v41-camera.js';

export function createCamera(W,R,D,camEl){
  const C=createLegacyCamera(W,R,D,camEl),baseUpdate=C.update;
  function update(dt,now=performance.now()){
    const idx=baseUpdate(dt,now),c=R.cars[idx]||R.getStandings?.()[0];
    // v41 always centred the directional-light shadow volume on the race leader.
    // For TV shots of midfield/pit cars that wastes most shadow resolution away
    // from the subject. Re-centre it on the actual broadcast focus each frame.
    if(c?.mesh&&W.sun){
      W.sun.target.position.copy(c.mesh.position);
      W.sun.position.set(c.mesh.position.x+260,c.mesh.position.y+420,c.mesh.position.z+180);
    }
    return idx;
  }
  return new Proxy(C,{get(target,prop){if(prop==='update')return update;return Reflect.get(target,prop,target);}});
}
