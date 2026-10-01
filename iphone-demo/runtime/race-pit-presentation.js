import {createRace as createV10Race} from './race-rules-thermal.js';

export function createRace(W,statusEl,settings={}){
  const base=createV10Race(W,statusEl,settings);
  const originalUpdate=base.update;

  function mainPose(c){
    const q=W.sample(c.s,c.lane);
    c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
  }
  function pitPose(c){
    if(!W.pitPose)return;
    if(c.pitState==='ENTRY'&&!W.inPitWindow?.(c.s)){mainPose(c);c.pitLaneStatus='APPROACH';return;}
    const q=W.pitPose(c.s,c.teamId,c.pitState);
    c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;
    if(c.pitState==='STOP'){
      const duration=Math.max(.1,c._pitStopInitial||c.pitTimer||2.5),left=Math.max(0,c.pitTimer||0),progress=1-left/duration;
      c.pitLaneStatus=progress<.18?'JACK UP':progress<.72?'TYRE CHANGE':progress<.90?'DROP CAR':'RELEASE';
      const lift=Math.sin(Math.min(1,Math.max(0,progress))*Math.PI)*.075;
      c.mesh.position.y+=lift;
    }else if(c.pitState==='EXIT')c.pitLaneStatus='PIT EXIT';
    else c.pitLaneStatus=W.inPitSpeedZone?.(c.s)?'PIT LIMITER':'PIT ENTRY';
  }

  function update(dt){
    const prior=base.cars.map(c=>({state:c.pitState,timer:c.pitTimer}));
    for(const c of base.cars){
      if(c.retired)continue;
      if(c.pitState!=='NONE'&&W.inPitSpeedZone?.(c.s)){
        c.v=Math.min(c.v,W.pitSpeedLimit||22.22);
        c.max=Math.min(c.max||Infinity,W.pitSpeedLimit||22.22);
      }
    }

    originalUpdate(dt);

    const activeTeams=new Set();
    for(let i=0;i<base.cars.length;i++){
      const c=base.cars[i],p=prior[i];
      if(c.retired)continue;
      if(p.state!=='STOP'&&c.pitState==='STOP')c._pitStopInitial=Math.max(.1,c.pitTimer||2.5);
      if(c.pitState!=='NONE'){
        if(W.inPitSpeedZone?.(c.s)&&c.pitState!=='STOP')c.v=Math.min(c.v,W.pitSpeedLimit||22.22);
        pitPose(c);
        if(c.pitState==='STOP')activeTeams.add(c.teamId);
      }else{
        c.pitLaneStatus='TRACK';
        c._pitStopInitial=null;
      }
    }
    W.updatePitCrews?.(activeTeams,dt);
  }

  return new Proxy(base,{
    get(target,prop){
      if(prop==='update')return update;
      if(prop==='pitSpeedLimit')return W.pitSpeedLimit||22.22;
      return Reflect.get(target,prop,target);
    }
  });
}
