import {createCamera as createV10Camera} from './v10-camera.js';

export function createCamera(W,R,D,camEl){
  const C=createV10Camera(W,R,D,camEl),T=W.THREE,tmp=new T.Vector3(),look=new T.Vector3();let pitShot=0,lastPit=-1;
  function pitCar(){return R.cars.find(c=>!c.retired&&c.pitState==='STOP')||R.cars.find(c=>!c.retired&&c.pitState!=='NONE')||null;}
  function update(dt,now){const idx=C.update(dt,now),pc=pitCar();if(C.mode==='AUTO'&&pc){if(pc.id!==lastPit){pitShot=0;lastPit=pc.id;}pitShot+=dt;const q=W.pitPose?.(pc.s,pc.teamId,pc.pitState);if(q){look.copy(pc.mesh.position);look.y+=.55;const phase=Math.floor(pitShot/4.5)%3;if(phase===0){tmp.copy(q.p).addScaledVector(q.side,-5.6).add(new T.Vector3(0,2.2,0));camEl.textContent='AUTO · PIT WALL';}else if(phase===1){const width=pc.width||pc.mesh?.userData?.dims?.width||2;tmp.copy(pc.mesh.position).add(new T.Vector3(width*.9,1.0,.9));camEl.textContent='AUTO · WHEEL SERVICE';}else{tmp.copy(pc.mesh.position).add(new T.Vector3(0,8.5,-7.5));camEl.textContent='AUTO · PIT OVERHEAD';}W.camera.position.lerp(tmp,1-Math.exp(-4.2*dt));W.camera.lookAt(look);return pc.id;}}else lastPit=-1;return idx;}
  return new Proxy(C,{get(target,prop){if(prop==='update')return update;return Reflect.get(target,prop,target);}});
}
