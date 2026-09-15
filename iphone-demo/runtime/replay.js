export function createReplay(W,R,{enabled=true}={}){
  const interesting=new Set(['OVERTAKE','CONTACT','INCIDENT','SPIN','RETIREMENT','FASTEST_LAP']),seen=new Set(),buffer=[];
  const sampleStep=.10,maxHistory=8.5;let acc=0,pending=null,active=null,lastReplay=-999,saved=null;
  const label=document.createElement('div');label.style.cssText='display:none;position:fixed;z-index:72;left:14px;top:max(112px,calc(env(safe-area-inset-top) + 106px));padding:5px 9px;border-radius:5px;background:#9b1212e8;border:1px solid #ffffff55;color:#fff;font:900 10px -apple-system,sans-serif;letter-spacing:.08em;pointer-events:none';document.body.appendChild(label);

  function snapshot(){
    const t=Number(R.race?.t)||0,cars=R.cars.map(c=>({id:c.id,x:c.mesh?.position?.x||0,y:c.mesh?.position?.y||0,z:c.mesh?.position?.z||0,ry:c.mesh?.rotation?.y||0,visible:c.mesh?.visible!==false}));
    buffer.push({t,cars});while(buffer.length&&t-buffer[0].t>maxHistory)buffer.shift();
  }
  function scanEvents(){
    const t=Number(R.race?.t)||0;for(const e of R.events||[]){const key=e?.id??`${e?.type}:${e?.carId}:${e?.t}`;if(seen.has(key))continue;seen.add(key);if(!interesting.has(e?.type)||pending||active||t-lastReplay<8)continue;pending={event:e,fireAt:(Number(e.t)||t)+2.25};}
    if(seen.size>420){const live=new Set((R.events||[]).map(e=>e?.id??`${e?.type}:${e?.carId}:${e?.t}`));for(const k of seen)if(!live.has(k))seen.delete(k);}
  }
  function startPending(){
    if(!pending||active)return;const t=Number(R.race?.t)||0;if(t<pending.fireAt)return;const e=pending.event,start=(Number(e.t)||t)-4.2,end=(Number(e.t)||t)+2.1,frames=buffer.filter(f=>f.t>=start&&f.t<=end);pending=null;if(frames.length<12)return;
    active={event:e,frames,startT:frames[0].t,endT:frames[frames.length-1].t,wallStart:performance.now(),speed:.88};lastReplay=t;label.textContent=`REPLAY · ${String(e.type||'EVENT').replaceAll('_',' ')}`;label.style.display='block';
  }
  function capture(dt=.016){
    if(!enabled)return;acc+=Math.max(0,Number(dt)||0);if(acc>=sampleStep){acc%=sampleStep;snapshot();scanEvents();startPending();}
  }
  function currentFrame(){
    if(!active)return null;const elapsed=(performance.now()-active.wallStart)/1000*active.speed,target=active.startT+elapsed;if(target>=active.endT){active=null;label.style.display='none';return null;}
    let best=active.frames[0];for(const f of active.frames){if(f.t>target)break;best=f;}return best;
  }
  function apply(){
    const frame=currentFrame();if(!frame||saved)return false;saved=[];const map=new Map(frame.cars.map(x=>[x.id,x]));
    for(const c of R.cars){if(!c.mesh)continue;const r=map.get(c.id);saved.push({mesh:c.mesh,x:c.mesh.position.x,y:c.mesh.position.y,z:c.mesh.position.z,ry:c.mesh.rotation.y,visible:c.mesh.visible});if(!r)continue;c.mesh.position.set(r.x,r.y,r.z);c.mesh.rotation.y=r.ry;c.mesh.visible=r.visible;}
    return true;
  }
  function restore(){if(!saved)return;for(const x of saved){x.mesh.position.set(x.x,x.y,x.z);x.mesh.rotation.y=x.ry;x.mesh.visible=x.visible;}saved=null;}
  function stop(){restore();active=null;pending=null;label.style.display='none';}
  return{capture,apply,restore,stop,get active(){return!!active},get event(){return active?.event||pending?.event||null},get focusId(){return active?.event?.carId??null},get bufferedSeconds(){return buffer.length?buffer[buffer.length-1].t-buffer[0].t:0},get diagnostics(){return{owner:'runtime-replay-v1',active:!!active,pending:!!pending,frames:buffer.length,bufferedSeconds:this.bufferedSeconds,lastReplay}}};
}
