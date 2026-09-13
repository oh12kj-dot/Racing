import {createRace as createLegacyRace} from '../v42-race.js';
import {LOG_POLICY,SUZUKA_PIT} from './config.js';

export function createRace(W,statusEl,settings={}){
  const R=createLegacyRace(W,statusEl,settings),baseUpdate=R.update;
  const generation={id:`run-${Date.now().toString(36)}`,startedAt:Date.now(),persistent:true,maxGenerations:LOG_POLICY.persistedGenerations};
  const prevPit=[];
  const QUEUE_GAP_METERS=8.5,QUEUE_TRIGGER_METERS=11.0;
  let pitArrivalSerial=0;

  function wrapS(s){const total=W.total||1;return((s%total)+total)%total;}
  function poseTrack(c){
    const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
  }
  function poseWorking(c){
    const q=W.pitWorkingPose?.(c.s)||W.pitPose?.(c.s,c.teamId,'ENTRY');
    if(!q||!c.mesh)return;
    c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;
  }
  function ensurePitArrival(c){
    if(c.pitState!=='NONE'&&c._runtimePitArrival==null)c._runtimePitArrival=++pitArrivalSerial;
    if(c.pitState==='NONE'&&c._runtimePitArrival!=null){
      c._runtimePitArrival=null;c._runtimeQueueS=null;
    }
  }
  function removeFreshPitStopEvent(carId,eventStart){
    if(!Array.isArray(R.events))return;
    for(let i=R.events.length-1;i>=eventStart;i--){
      const e=R.events[i];
      if(e?.carId===carId&&e?.type==='PIT_STOP')R.events.splice(i,1);
    }
  }
  function holdForTeamBox(c,forceGap=false,eventStart=Infinity){
    const boxS=W.pitBoxS?.(c.teamId);
    if(!Number.isFinite(boxS))return;
    if(forceGap||!Number.isFinite(c._runtimeQueueS)){
      c._runtimeQueueS=forceGap?wrapS(boxS-QUEUE_GAP_METERS):wrapS(c.s);
    }
    c.s=c._runtimeQueueS;c.v=0;c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.pitLaneStatus='QUEUE';
    removeFreshPitStopEvent(c.id,eventStart);
    poseWorking(c);
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

  function update(dt){
    const eventStart=Array.isArray(R.events)?R.events.length:0;
    for(const c of R.cars){
      prevPit[c.id]=c.pitState;
      ensurePitArrival(c);
      if(c.pitState==='ENTRY'&&!W.inPitWindow?.(c.s))c.laneTarget=Math.max(c.laneTarget||0,3.8);
    }

    // If one car of a team is already on the jacks, its team-mate waits in the
    // garage-side working lane. Other teams remain fully independent.
    let occupied=serviceOccupants();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='ENTRY'||!occupied.has(c.teamId??0))continue;
      const dist=W.pitDistanceToBox?.(c.s,c.teamId);
      if(Number.isFinite(dist)&&dist<=QUEUE_TRIGGER_METERS&&dist>-2)holdForTeamBox(c,false,eventStart);
    }

    baseUpdate(dt);

    for(const c of R.cars)ensurePitArrival(c);

    // Two same-team cars can reach the box in the same simulation frame.
    // Keep the first arrival in service and put only the second one into a
    // double-stack queue. Cars belonging to different teams may all STOP
    // simultaneously and their independent crew groups remain active.
    const stopGroups=new Map();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='STOP')continue;
      const team=c.teamId??0,list=stopGroups.get(team)||[];list.push(c);stopGroups.set(team,list);
    }
    for(const list of stopGroups.values()){
      if(list.length<2)continue;
      list.sort((a,b)=>(a._runtimePitArrival??Infinity)-(b._runtimePitArrival??Infinity)||a.id-b.id);
      for(let i=1;i<list.length;i++)holdForTeamBox(list[i],true,eventStart);
    }

    occupied=serviceOccupants();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='ENTRY')continue;
      const blocker=occupied.get(c.teamId??0);
      if(!blocker||blocker===c)continue;
      const dist=W.pitDistanceToBox?.(c.s,c.teamId);
      if(Number.isFinite(dist)&&dist<=QUEUE_TRIGGER_METERS&&dist>-2)holdForTeamBox(c,false,eventStart);
    }

    for(const c of R.cars){
      if(prevPit[c.id]==='EXIT'&&c.pitState==='NONE'&&!c.retired){
        // Suzuka pit-out stays on the right edge before merging. Keep the car at
        // the merge-edge position and let the normal racing-line controller
        // bring laneTarget back in smoothly rather than snapping to centre.
        c.lane=SUZUKA_PIT.mergeTrackOffset;c.laneTarget=4.0;c.pitLaneStatus='MERGE';poseTrack(c);
      }
      if(c.pitState!=='ENTRY'||c.pitLaneStatus!=='QUEUE')c._runtimeQueueS=null;
    }
  }
  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='logGeneration')return generation;
    return Reflect.get(target,prop,target);
  }});
}
