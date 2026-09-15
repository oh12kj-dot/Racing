import {createCamera as createBaseCamera} from './camera.js';

export function createCamera(W,R,D,camEl){
  const C=createBaseCamera(W,R,D,camEl),T=W.THREE,total=Math.max(1,Number(W.total)||1),look=new T.Vector3();
  let active=-1,lastFocus=-1;
  const dist=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,total-d);};

  function choose(c){
    const anchors=W.tvCameraAnchors||[];let best=-1,bestD=Infinity;
    for(let i=0;i<anchors.length;i++){const d=dist(Number(c.s)||0,anchors[i].s);if(d<bestD){bestD=d;best=i;}}
    return{index:best,distance:bestD,anchor:anchors[best]};
  }
  function fixedTV(c,dt){
    const x=choose(c);if(!x.anchor||x.distance>390)return false;
    active=x.index;lastFocus=c.id;
    const yaw=c.mesh?.rotation?.y||0,lead=Math.min(30,Math.max(8,(c.v||0)*.20));
    look.copy(c.mesh.position);look.x+=Math.sin(yaw)*lead;look.z+=Math.cos(yaw)*lead;look.y+=1.15;
    W.camera.position.copy(x.anchor.position);W.camera.lookAt(look);
    const targetFov=Number(x.anchor.fov)||44;if(Math.abs(W.camera.fov-targetFov)>.05){W.camera.fov+=(targetFov-W.camera.fov)*(1-Math.exp(-5*dt));W.camera.updateProjectionMatrix();}
    camEl.textContent=`AUTO · TV · ${x.anchor.name} · ${Math.round(x.distance)}m`;
    return true;
  }
  function update(dt,now=performance.now()){
    const idx=C.update(dt,now),c=R.cars[idx]||R.getStandings?.()[0];
    const early=R.sessionPhase!=='QUALIFYING'&&R.sessionPhase!=='FORMATION'&&(R.race?.t||0)<(R.race?.green||0)+6;
    const canUse=String(W.circuitName||'').toUpperCase()==='SUZUKA'&&C.mode==='AUTO'&&String(D.shot||'TV')==='TV'&&!early&&!C.pitBroadcastActive&&c&&!c.retired&&c.pitState==='NONE';
    if(canUse&&!fixedTV(c,dt))active=-1;else if(!canUse)active=-1;
    return idx;
  }
  return new Proxy(C,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='fixedTvAnchor')return active;
    if(prop==='fixedTvAnchorName')return active>=0?W.tvCameraAnchors?.[active]?.name||null:null;
    if(prop==='fixedTvAnchorCount')return W.tvCameraAnchors?.length||0;
    if(prop==='fixedTvFocus')return lastFocus;
    return Reflect.get(target,prop,target);
  }});
}
