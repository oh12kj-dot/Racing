import {createCamera as createLegacyCamera} from '../v41-camera.js';

export function createCamera(W,R,D,camEl){
  const C=createLegacyCamera(W,R,D,camEl),baseUpdate=C.update,T=W.THREE;
  const pitPos=new T.Vector3(),pitLook=new T.Vector3(),desired=new T.Vector3(),target=new T.Vector3();
  let pitFocus=-1,pitSince=0,pitActive=false;

  function pitBroadcast(c,dt){
    if(!c?.mesh||C.mode!=='AUTO'||c.pitState==='NONE')return false;
    if(pitFocus!==c.id){pitFocus=c.id;pitSince=R.race.t;pitPos.copy(W.camera.position);pitLook.copy(c.mesh.position);pitActive=true;}
    const q=W.pitPose?.(c.s,c.teamId,c.pitState==='STOP'?'STOP':c.pitState)||W.sample(c.s,c.lane),age=Math.max(0,R.race.t-pitSince),stopped=c.pitState==='STOP';
    let label='PIT TELEPHOTO';
    if(!stopped){
      desired.copy(q.p).addScaledVector(q.side,-8.5).addScaledVector(q.t,-18);desired.y+=5.2;
      target.copy(c.mesh.position).addScaledVector(q.t,18);target.y+=1.0;
    }else{
      const shot=Math.floor(age/2.8)%3;
      if(shot===0){label='PIT WALL';desired.copy(q.p).addScaledVector(q.side,-7.8).addScaledVector(q.t,-8);desired.y+=3.3;target.copy(c.mesh.position).addScaledVector(q.t,1.5);target.y+=.75;}
      else if(shot===1){label='PIT OVERHEAD';desired.copy(q.p).addScaledVector(q.side,-2.2).addScaledVector(q.t,-4);desired.y+=13.0;target.copy(c.mesh.position);target.y+=.55;}
      else{label='GARAGE 3/4';desired.copy(q.p).addScaledVector(q.side,4.2).addScaledVector(q.t,-7.5);desired.y+=2.65;target.copy(c.mesh.position);target.y+=.70;}
    }
    const fp=1-Math.exp(-(stopped?3.2:2.2)*dt),fl=1-Math.exp(-4.2*dt);pitPos.lerp(desired,fp);pitLook.lerp(target,fl);
    W.camera.position.copy(pitPos);W.camera.lookAt(pitLook);const fov=stopped?38:44;if(Math.abs(W.camera.fov-fov)>.15){W.camera.fov+=(fov-W.camera.fov)*(1-Math.exp(-4*dt));W.camera.updateProjectionMatrix();}
    camEl.textContent=`AUTO · ${label} · ${c.name}`;return true;
  }

  function update(dt,now=performance.now()){
    const idx=baseUpdate(dt,now),c=R.cars[idx]||R.getStandings?.()[0];
    if(c&&!pitBroadcast(c,dt)){pitActive=false;pitFocus=-1;}
    // Keep useful directional-shadow resolution around the actual broadcast
    // subject, including pit cameras, rather than permanently around the leader.
    if(c?.mesh&&W.sun){W.sun.target.position.copy(c.mesh.position);W.sun.position.set(c.mesh.position.x+260,c.mesh.position.y+420,c.mesh.position.z+180);}
    return idx;
  }
  return new Proxy(C,{get(targetObj,prop){if(prop==='update')return update;if(prop==='pitBroadcastActive')return pitActive;return Reflect.get(targetObj,prop,targetObj);}});
}
