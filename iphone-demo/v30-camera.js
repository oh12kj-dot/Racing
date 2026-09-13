import {createCamera as createV13Camera} from './v13-camera.js';

export function createCamera(W,R,D,camEl){
  const C=createV13Camera(W,R,D,camEl),T=W.THREE,total=W.total;
  const anchors=[.002,.055,.12,.20,.31,.43,.55,.68,.79,.90,.965];
  const tmp=new T.Vector3(),target=new T.Vector3(),look=new T.Vector3(),toCam=new T.Vector3();
  let tvAnchor=-1,tvCutAt=-999999,lookReady=false,pitLock=null,lastPitId=-1;
  let framing={distance:0,angle:0,anchor:-1,reason:'BASE'};

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function trackDistance(a,b){const d=Math.abs(a-b);return Math.min(d,total-d);}
  function anchorPose(i){const s=total*anchors[i],q=W.sample(s),p=q.p.clone().addScaledVector(q.side,32).add(new T.Vector3(0,11.5,0));return{i,s,q,p};}
  function scoreAnchor(i,c){
    const a=anchorPose(i),q=W.sample(c.s,c.lane),car=c.mesh.position;
    const dist=a.p.distanceTo(car),td=trackDistance(a.s,c.s);
    toCam.copy(a.p).sub(car).normalize();
    const tangent=q.t.clone().normalize(),dot=clamp(Math.abs(tangent.dot(toCam)),0,1),angle=Math.acos(dot)*180/Math.PI;
    const distScore=clamp(1-Math.abs(dist-105)/145,0,1),angleScore=clamp(1-Math.abs(angle-70)/70,0,1),trackScore=clamp(1-td/300,0,1);
    const continuity=i===tvAnchor?.42:0;
    return{...a,dist,angle,score:distScore*.44+angleScore*.32+trackScore*.24+continuity};
  }
  function chooseTV(c,nowMs){
    const all=anchors.map((_,i)=>scoreAnchor(i,c)).sort((a,b)=>b.score-a.score),best=all[0],current=tvAnchor>=0?scoreAnchor(tvAnchor,c):null;
    const invalid=!current||current.dist>245||current.dist<28||current.angle<18;
    const clearlyBetter=current&&best.score>current.score+.28;
    if(tvAnchor<0||invalid||(nowMs-tvCutAt>6000&&clearlyBetter)){tvAnchor=best.i;tvCutAt=nowMs;lookReady=false;}
    return scoreAnchor(tvAnchor<0?best.i:tvAnchor,c);
  }
  function setFov(v,dt){const f=1-Math.exp(-3.2*dt),next=W.camera.fov+(v-W.camera.fov)*f;if(Math.abs(next-W.camera.fov)>.03){W.camera.fov=next;W.camera.updateProjectionMatrix();}}
  function tvShot(c,dt,nowMs){
    const a=chooseTV(c,nowMs),carTarget=target.copy(c.mesh.position).add(new T.Vector3(0,1.25,0));
    if(!lookReady){look.copy(carTarget);lookReady=true;}else look.lerp(carTarget,1-Math.exp(-5.5*dt));
    W.camera.position.copy(a.p);W.camera.lookAt(look);
    setFov(clamp(52-(a.dist-50)*.115,32,52),dt);
    framing={distance:a.dist,angle:a.angle,anchor:tvAnchor,reason:D.reason||'TV'};
    camEl.textContent=`AUTO · TV · ${Math.round(a.dist)}m · ${Math.round(a.angle)}°`;
  }
  function pitShot(c,dt){
    if(!pitLock||lastPitId!==c.id){
      const q=W.pitPose?.(c.s,c.teamId,'STOP');
      if(q){
        const p=q.p.clone().addScaledVector(q.side,-6.6).add(new T.Vector3(0,2.55,0));
        const t=q.p.clone().add(new T.Vector3(0,.72,0));pitLock={p,t};
      }else{
        const p=c.mesh.position.clone().add(new T.Vector3(6,2.5,-2));
        const t=c.mesh.position.clone().add(new T.Vector3(0,.7,0));pitLock={p,t};
      }
      lastPitId=c.id;look.copy(pitLock.t);lookReady=true;W.camera.position.copy(pitLock.p);
    }
    if(c.pitState==='ENTRY'||c.pitState==='EXIT')target.copy(c.mesh.position).add(new T.Vector3(0,.65,0));else target.copy(pitLock.t);
    look.lerp(target,1-Math.exp(-4.4*dt));
    W.camera.position.copy(pitLock.p);W.camera.lookAt(look);setFov(42,dt);
    const dist=W.camera.position.distanceTo(c.mesh.position);framing={distance:dist,angle:90,anchor:-1,reason:'PIT STATIC'};
    camEl.textContent=`AUTO · PIT STATIC · ${c.name}`;
  }
  function eventShot(c,dt,mode){
    const q=W.sample(c.s,c.lane),ahead=W.sample(c.s+38,c.lane);
    if(mode==='HELI')tmp.copy(q.p).addScaledVector(q.t,-18).add(new T.Vector3(0,62,0));
    else tmp.copy(q.p).addScaledVector(q.t,-24).addScaledVector(q.side,5).add(new T.Vector3(0,7.5,0));
    target.copy(ahead.p).add(new T.Vector3(0,1.1,0));
    if(!lookReady){look.copy(target);lookReady=true;}
    W.camera.position.lerp(tmp,1-Math.exp(-(mode==='HELI'?1.8:3.4)*dt));look.lerp(target,1-Math.exp(-4.2*dt));W.camera.lookAt(look);
    const dist=W.camera.position.distanceTo(c.mesh.position);setFov(mode==='HELI'?46:48,dt);framing={distance:dist,angle:mode==='HELI'?85:35,anchor:-1,reason:D.reason||mode};
    camEl.textContent=`AUTO · ${mode} · ${D.reason||'EVENT'}`;
  }

  function update(dt,nowMs){
    const idx=C.update(dt,nowMs),mode=C.mode;
    if(mode!=='AUTO'){pitLock=null;lastPitId=-1;return idx;}
    const c=R.cars[D.focus]||R.getStandings?.()[0];if(!c)return idx;
    if(D.shot==='PIT'||D.pitEventFocus===c.id){pitShot(c,dt);return c.id;}
    if(pitLock&&c.id!==lastPitId){pitLock=null;lastPitId=-1;}
    if(D.shot==='TV'){tvShot(c,dt,nowMs);return c.id;}
    if(D.shot==='HELI'||D.shot==='CHASE'){eventShot(c,dt,D.shot);return c.id;}
    return idx;
  }

  return new Proxy(C,{get(targetObj,prop){
    if(prop==='update')return update;
    if(prop==='framing')return{...framing};
    return Reflect.get(targetObj,prop,targetObj);
  }});
}
