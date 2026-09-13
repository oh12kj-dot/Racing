import {createCamera as createV30Camera} from './v30-camera.js';

export function createCamera(W,R,D,camEl){
  const C=createV30Camera(W,R,D,camEl),camera=W.camera;
  const prevPos=camera.position.clone(),prevQuat=camera.quaternion.clone();
  let prevFov=camera.fov,lastKey='',settled=false;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function update(dt,nowMs){
    prevPos.copy(camera.position);prevQuat.copy(camera.quaternion);prevFov=camera.fov;
    const idx=C.update(dt,nowMs);
    if(C.mode!=='AUTO'){lastKey='';settled=false;return idx;}

    const desiredPos=camera.position.clone(),desiredQuat=camera.quaternion.clone(),desiredFov=camera.fov;
    const focus=Number(D.focus ?? idx ?? 0),shot=String(D.shot||'BASE'),key=`${shot}:${focus}`;
    const changed=key!==lastKey,travel=prevPos.distanceTo(desiredPos);
    lastKey=key;

    // Very large moves are intentional broadcast cuts. Do not fly the camera hundreds of metres
    // through scenery; snap the position but still soften the orientation on the first frame.
    if(changed&&travel>220){
      camera.position.copy(desiredPos);
      camera.quaternion.copy(prevQuat).slerp(desiredQuat,clamp(1-Math.exp(-18*dt),0,1));
      camera.fov=prevFov+(desiredFov-prevFov)*(1-Math.exp(-14*dt));
      camera.updateProjectionMatrix();settled=false;return idx;
    }

    // Unified damping for every AUTO shot removes the small fight between TV/CHASE/PIT camera
    // implementations. Position is slightly faster than rotation so the subject stays framed.
    const posRate=changed?10.5:(shot==='TV'?8.0:shot==='PIT'?9.0:6.2);
    const rotRate=changed?9.0:(shot==='TV'?5.2:shot==='PIT'?6.5:5.6);
    const fovRate=changed?10.0:5.8;
    const ap=clamp(1-Math.exp(-posRate*dt),0,1),ar=clamp(1-Math.exp(-rotRate*dt),0,1),af=clamp(1-Math.exp(-fovRate*dt),0,1);

    // Sub-centimetre camera corrections and tiny angular changes are visually perceived as jitter
    // on a phone display. Apply a small dead-band before smoothing.
    const posDelta=prevPos.distanceTo(desiredPos),angle=prevQuat.angleTo(desiredQuat);
    camera.position.copy(posDelta<.025?prevPos:prevPos.clone().lerp(desiredPos,ap));
    camera.quaternion.copy(angle<.0012?prevQuat:prevQuat.clone().slerp(desiredQuat,ar));
    camera.fov=Math.abs(desiredFov-prevFov)<.025?prevFov:prevFov+(desiredFov-prevFov)*af;
    camera.updateProjectionMatrix();
    settled=!changed&&posDelta<.08&&angle<.004;
    return idx;
  }

  return new Proxy(C,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='smoothState')return{shot:String(D.shot||'BASE'),focus:Number(D.focus||0),settled};
    return Reflect.get(target,prop,target);
  }});
}
