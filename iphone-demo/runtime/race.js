import {createRace as createLegacyRace} from '../v42-race.js';
import {LOG_POLICY,SUZUKA_PIT} from './config.js';

export function createRace(W,statusEl,settings={}){
  const R=createLegacyRace(W,statusEl,settings),baseUpdate=R.update;
  const generation={id:`run-${Date.now().toString(36)}`,startedAt:Date.now(),persistent:true,maxGenerations:LOG_POLICY.persistedGenerations};
  const prevPit=[];
  const QUEUE_GAP_METERS=8.5,QUEUE_TRIGGER_METERS=11.0;
  const serviceTime={formula:2.6,proto:3.1,hyper:3.3,lmh:3.2,gt:4.1,supercar:4.3,touring:4.7};
  let pitArrivalSerial=0;

  function wrapS(s){const total=W.total||1;return((s%total)+total)%total;}
  function poseTrack(c){
    const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
  }
  function posePit(c,state=c.pitState){
    const q=W.pitPose?.(c.s,c.teamId,state);
    if(!q||!c.mesh)return;
    c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;
  }
  function poseWorking(c){
    const q=W.pitWorkingPose?.(c.s)||W.pitPose?.(c.s,c.teamId,'ENTRY');
    if(!q||!c.mesh)return;
    c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;
  }
  function ensurePitArrival(c){
    if(c.pitState!=='NONE'&&c._runtimePitArrival==null)c._runtimePitArrival=++pitArrivalSerial;
    if(c.pitState==='NONE'&&c._runtimePitArrival!=null){
      c._runtimePitArrival=null;c._runtimePitQueued=false;c._runtimeQueueS=null;
    }
  }
  function removeFreshPitStopEvent(carId,eventStart){
    if(!Array.isArray(R.events))return;
    for(let i=R.events.length-1;i>=eventStart;i--){
      const e=R.events[i];
      if(e?.carId===carId&&e?.type==='PIT_STOP')R.events.splice(i,1);
    }
  }
  function serviceOccupants(){
    const m=new Map();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='STOP')continue;
      ensurePitArrival(c);
      const team=c.teamId??0,prior=m.get(team);
      if(!prior||(c._runtimePitArrival??Infinity)<(prior._runtimePitArrival??Infinity))m.set(team,c);
    }
    return m;
  }
  function markQueued(c,forceGap=false,eventStart=Infinity){
    const boxS=W.pitBoxS?.(c.teamId);
    if(!Number.isFinite(boxS))return;
    if(forceGap||!Number.isFinite(c._runtimeQueueS))c._runtimeQueueS=forceGap?wrapS(boxS-QUEUE_GAP_METERS):wrapS(c.s);
    c._runtimePitQueued=true;
    c.s=c._runtimeQueueS;c.v=0;c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.pitLaneStatus='QUEUE';
    removeFreshPitStopEvent(c.id,eventStart);
    poseWorking(c);
  }
  function holdQueued(c,eventStart=Infinity){
    if(!c._runtimePitQueued||!Number.isFinite(c._runtimeQueueS))return;
    c.s=c._runtimeQueueS;c.v=0;c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.pitLaneStatus='QUEUE';
    removeFreshPitStopEvent(c.id,eventStart);
    poseWorking(c);
  }
  function releaseQueued(c){
    c._runtimePitQueued=false;c._runtimeQueueS=null;c.pitState='ENTRY';c.pitTimer=0;
    c.v=Math.max(c.v||0,7);c.pitLaneStatus='WORKING';
    posePit(c,'ENTRY');
  }
  function startService(c){
    const boxS=W.pitBoxS?.(c.teamId);if(!Number.isFinite(boxS))return false;
    c._runtimePitQueued=false;c._runtimeQueueS=null;c._v41PitManaged=true;
    c.s=boxS;c.v=0;c.pitState='STOP';c.pitTimer=serviceTime[c.type]||3.5;c._pitStopInitial=c.pitTimer;c.pitLaneStatus='JACKS';
    posePit(c,'STOP');
    return true;
  }
  function maybeStartService(c,dt,occupied){
    if(c.retired||c.pitState!=='ENTRY'||c._runtimePitQueued||occupied.has(c.teamId??0))return false;
    const dist=W.pitDistanceToBox?.(c.s,c.teamId);if(!Number.isFinite(dist))return false;
    const threshold=Math.max(1.25,Math.max(c.v||0,7)*Math.max(dt,.016)*1.9);
    return dist<=threshold&&dist>-2.0?startService(c):false;
  }

  function update(dt){
    const eventStart=Array.isArray(R.events)?R.events.length:0;
    for(const c of R.cars){
      prevPit[c.id]=c.pitState;
      ensurePitArrival(c);
      if(c.pitState==='ENTRY'&&!W.inPitWindow?.(c.s))c.laneTarget=Math.max(c.laneTarget||0,3.8);
    }

    // Resolve explicit double-stack queues before the legacy update. A queued
    // car is either held at one fixed working-lane point or explicitly released;
    // the legacy ENTRY controller is never allowed to alternate the two states.
    let occupied=serviceOccupants();
    for(const c of R.cars){
      if(c.retired||!c._runtimePitQueued)continue;
      if(occupied.has(c.teamId??0))holdQueued(c,eventStart);
      else releaseQueued(c);
    }
    occupied=serviceOccupants();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='ENTRY'||c._runtimePitQueued||!occupied.has(c.teamId??0))continue;
      const dist=W.pitDistanceToBox?.(c.s,c.teamId);
      if(Number.isFinite(dist)&&dist<=QUEUE_TRIGGER_METERS&&dist>-2)markQueued(c,false,eventStart);
    }

    baseUpdate(dt);
    for(const c of R.cars)ensurePitArrival(c);

    // A same-team pair can both be promoted to STOP inside the wrapped legacy
    // update. Keep only the earliest arrival in service and queue the other one.
    const stopGroups=new Map();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='STOP')continue;
      const team=c.teamId??0,list=stopGroups.get(team)||[];list.push(c);stopGroups.set(team,list);
    }
    for(const list of stopGroups.values()){
      if(list.length<2)continue;
      list.sort((a,b)=>(a._runtimePitArrival??Infinity)-(b._runtimePitArrival??Infinity)||a.id-b.id);
      for(let i=1;i<list.length;i++)markQueued(list[i],true,eventStart);
    }

    occupied=serviceOccupants();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='ENTRY')continue;
      const blocker=occupied.get(c.teamId??0);
      if(c._runtimePitQueued){
        if(blocker)holdQueued(c,eventStart);else releaseQueued(c);
        continue;
      }
      if(blocker){
        const dist=W.pitDistanceToBox?.(c.s,c.teamId);
        if(Number.isFinite(dist)&&dist<=QUEUE_TRIGGER_METERS&&dist>-2)markQueued(c,false,eventStart);
      }
    }

    // Failsafe: if the legacy transition misses the exact box crossing at a low
    // frame rate, start service once a free car reaches its own box. This keeps
    // STOP/JACKS deterministic instead of leaving an ENTRY car stationary there.
    occupied=serviceOccupants();
    for(const c of R.cars){
      if(maybeStartService(c,dt,occupied))occupied.set(c.teamId??0,c);
    }

    for(const c of R.cars){
      if(prevPit[c.id]==='EXIT'&&c.pitState==='NONE'&&!c.retired){
        c.lane=SUZUKA_PIT.mergeTrackOffset;c.laneTarget=4.0;c.pitLaneStatus='MERGE';poseTrack(c);
      }
      if(c.pitState==='NONE'){
        c._runtimePitQueued=false;c._runtimeQueueS=null;
      }
    }
  }
  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='logGeneration')return generation;
    return Reflect.get(target,prop,target);
  }});
}
