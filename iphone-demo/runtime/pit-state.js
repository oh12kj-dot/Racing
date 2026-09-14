import {SUZUKA_PIT} from './config.js';

export function createPitStateMachine(W,R){
  const QUEUE_GAP_METERS=8.5,QUEUE_TRIGGER_METERS=11.0,RELEASE_BEHIND_METERS=18,RELEASE_AHEAD_METERS=8,WORKING_EXIT_BLEND_METERS=18;
  const serviceTime={formula:2.6,proto:3.1,hyper:3.3,lmh:3.2,gt:4.1,supercar:4.3,touring:4.7};
  let arrivalSerial=0;
  const metrics={queued:0,released:0,services:0,legacyStopsRejected:0,doubleStacks:0,invariantRepairs:0,releaseWaits:0,safeReleases:0,serviceCompletions:0,stallRecoveries:0};
  const wrapS=s=>{const total=W.total||1;return((s%total)+total)%total;};
  const pitMeters=s=>(W.pitUnwrappedFraction?.(s)??(wrapS(s)/(W.total||1)))*(W.total||1);
  const forwardDelta=(a,b)=>{const total=W.total||1;return((wrapS(b)-wrapS(a))%total+total)%total;};

  function poseTrack(c){if(!c?.mesh)return;const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);}
  function posePit(c,state=c.pitState){if(!c?.mesh)return;const q=W.pitPose?.(c.s,c.teamId,state);if(!q)return;c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;}
  function poseWorking(c){if(!c?.mesh)return;const q=W.pitWorkingPose?.(c.s)||W.pitPose?.(c.s,c.teamId,'ENTRY');if(!q)return;c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;}
  function ensureArrival(c){
    if(c.pitState!=='NONE'&&c._runtimePitArrival==null)c._runtimePitArrival=++arrivalSerial;
    if(c.pitState==='NONE'&&c._runtimePitArrival!=null&&c._runtimePitPhase!=='MERGE'){c._runtimePitArrival=null;c._runtimePitQueued=false;c._runtimeQueueS=null;c._runtimeReleaseWait=false;c._runtimePitPhase='TRACK';}
  }
  function removeFreshPitStopEvent(carId,eventStart){if(!Array.isArray(R.events))return;for(let i=R.events.length-1;i>=eventStart;i--){const e=R.events[i];if(e?.carId===carId&&e?.type==='PIT_STOP')R.events.splice(i,1);}}
  function serviceOccupants(){
    const m=new Map();
    for(const c of R.cars){if(c.retired||c.pitState!=='STOP')continue;ensureArrival(c);const team=c.teamId??0,prior=m.get(team);if(!prior||(c._runtimePitArrival??Infinity)<(prior._runtimePitArrival??Infinity))m.set(team,c);}
    return m;
  }
  function fastLaneTraffic(c){
    const u=pitMeters(c.s),near=[];
    for(const o of R.cars){
      if(o===c||o.retired||o._runtimePitQueued||o.pitState==='STOP'||o.pitState==='NONE')continue;
      const phase=o._runtimePitPhase||'';
      // A car waiting for release or still crossing the working lane is not fast-lane
      // traffic. Treating every EXIT car as fast-lane traffic made adjacent pit boxes
      // wait on each other forever when two teams completed service together.
      const fast=phase==='FAST_LANE'||phase==='FAST_LANE_EXIT'||phase==='PIT_ENTRY'||(o.pitState==='EXIT'&&!['WORKING_EXIT','RELEASE_WAIT'].includes(phase));
      if(!fast||Math.max(0,o.v||0)<1)continue;
      const delta=pitMeters(o.s)-u;if(delta>-RELEASE_BEHIND_METERS&&delta<RELEASE_AHEAD_METERS)near.push({car:o,delta});
    }
    return near.sort((a,b)=>Math.abs(a.delta)-Math.abs(b.delta));
  }
  function releaseBlocked(c){return fastLaneTraffic(c).length>0;}
  function queue(c,forceGap=false,eventStart=Infinity){
    const boxS=W.pitBoxS?.(c.teamId);if(!Number.isFinite(boxS))return false;
    if(forceGap||!Number.isFinite(c._runtimeQueueS))c._runtimeQueueS=forceGap?wrapS(boxS-QUEUE_GAP_METERS):wrapS(c.s);
    c._runtimePitQueued=true;c._runtimePitPhase='QUEUE';c.s=c._runtimeQueueS;c.v=0;c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.pitLaneStatus='QUEUE';removeFreshPitStopEvent(c.id,eventStart);poseWorking(c);metrics.queued++;if(forceGap)metrics.doubleStacks++;return true;
  }
  function holdQueue(c,eventStart=Infinity){if(!c._runtimePitQueued||!Number.isFinite(c._runtimeQueueS))return;c._runtimePitPhase='QUEUE';c.s=c._runtimeQueueS;c.v=0;c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.pitLaneStatus='QUEUE';removeFreshPitStopEvent(c.id,eventStart);poseWorking(c);}
  function releaseQueue(c){c._runtimePitQueued=false;c._runtimeQueueS=null;c._runtimePitPhase='WORKING_APPROACH';c.pitState='ENTRY';c.pitTimer=0;c.v=Math.max(c.v||0,7);c.pitLaneStatus='WORKING';posePit(c,'ENTRY');metrics.released++;}
  function startService(c){
    const boxS=W.pitBoxS?.(c.teamId);if(!Number.isFinite(boxS))return false;
    c._runtimePitQueued=false;c._runtimeQueueS=null;c._runtimeReleaseWait=false;c._runtimePitPhase='SERVICE';c.s=boxS;c.v=0;c.pitState='STOP';c.pitTimer=serviceTime[c.type]||3.5;c._pitStopInitial=c.pitTimer;c.pitLaneStatus='JACKS';posePit(c,'STOP');metrics.services++;return true;
  }
  function holdRelease(c,count=true){
    const boxS=W.pitBoxS?.(c.teamId);if(!Number.isFinite(boxS))return;
    if(count&&!c._runtimeReleaseWait)metrics.releaseWaits++;c._runtimeReleaseWait=true;c._runtimePitPhase='RELEASE_WAIT';c.s=boxS;c.v=0;c.pitState='EXIT';c.pitTimer=0;c.pitLaneStatus='RELEASE WAIT';poseWorking(c);
  }
  function releaseToFastLane(c){c._runtimeReleaseWait=false;c._runtimePitPhase='WORKING_EXIT';c.pitState='EXIT';c.v=Math.max(c.v||0,7);c.pitLaneStatus='RELEASE';posePit(c,'EXIT');metrics.safeReleases++;}
  function advanceService(c,b,dt,eventStart){
    if(c.retired||b?.state!=='STOP')return false;
    const start=Number.isFinite(Number(b.pitTimer))?Number(b.pitTimer):Math.max(0,Number(c.pitTimer)||0),remaining=Math.max(0,start-Math.max(0,dt||0));
    if(remaining>0){
      if(c.pitState!=='STOP')removeFreshPitStopEvent(c.id,eventStart);
      c.pitState='STOP';c.pitTimer=remaining;c._runtimePitPhase='SERVICE';c.s=W.pitBoxS?.(c.teamId)??c.s;c.v=0;c.pitLaneStatus='JACKS';posePit(c,'STOP');return true;
    }
    c.pitTimer=0;c.pitState='EXIT';metrics.serviceCompletions++;
    if(releaseBlocked(c))holdRelease(c);else releaseToFastLane(c);
    return true;
  }
  function maybeStartService(c,dt,occupied){
    if(c.retired||c.pitState!=='ENTRY'||c._runtimePitQueued||occupied.has(c.teamId??0))return false;
    const dist=W.pitDistanceToBox?.(c.s,c.teamId);if(!Number.isFinite(dist))return false;
    const threshold=Math.max(1.25,Math.max(c.v||0,7)*Math.max(dt,.016)*1.9);return dist<=threshold&&dist>-2.5?startService(c):false;
  }
  function rejectPrematureLegacyStop(c,beforeState,beforeV,dt,eventStart){
    if(beforeState!=='ENTRY'||c.pitState!=='STOP')return false;const dist=W.pitDistanceToBox?.(c.s,c.teamId);if(!Number.isFinite(dist))return false;
    if(dist<=Math.max(1.2,Math.max(beforeV,7)*dt*1.55))return false;
    c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.v=Math.min(Math.max(beforeV,7),W.pitSpeedLimit||22.22);c.pitLaneStatus='FAST LANE';c._runtimePitPhase='FAST_LANE';removeFreshPitStopEvent(c.id,eventStart);posePit(c,'ENTRY');metrics.legacyStopsRejected++;return true;
  }
  function ensurePitMotion(c,b,dt){
    if(c.retired||c._runtimePitQueued||c._runtimeReleaseWait||!b||!['ENTRY','EXIT'].includes(c.pitState))return false;
    const step=Math.max(0,Number(dt)||0);if(step<=0)return false;
    const beforeS=Number.isFinite(Number(b.s))?Number(b.s):c.s,progress=forwardDelta(beforeS,c.s),expected=Math.max(0,Number(b.v)||0,Number(c.v)||0)*step;
    if(progress>=Math.max(.015,expected*.08))return false;
    const floor=c.pitState==='ENTRY'?7:(c._runtimePitPhase==='WORKING_EXIT'?8:10),limit=W.pitSpeedLimit||22.22;
    c.v=Math.min(limit,Math.max(Number(c.v)||0,Number(b.v)||0,floor));c.s=wrapS(beforeS+c.v*step);metrics.stallRecoveries++;return true;
  }
  function repairInvariant(c){
    if(c.retired)return;let repaired=false;
    if(c._runtimePitQueued&&c.pitState!=='ENTRY'){c.pitState='ENTRY';repaired=true;}if(c._runtimeReleaseWait&&c.pitState!=='EXIT'){c.pitState='EXIT';repaired=true;}
    if(c.pitState==='STOP'){const bs=W.pitBoxS?.(c.teamId);if(Number.isFinite(bs)&&Math.abs(wrapS(c.s)-wrapS(bs))>.25){c.s=bs;repaired=true;}if((c.v||0)!==0){c.v=0;repaired=true;}}
    if(c.pitState==='NONE'&&c._runtimePitQueued){c._runtimePitQueued=false;c._runtimeQueueS=null;repaired=true;}if(repaired)metrics.invariantRepairs++;
  }

  function beforeUpdate(dt){
    const snapshot=[];
    for(const c of R.cars){
      ensureArrival(c);
      if(c._runtimeReleaseWait){if(releaseBlocked(c))holdRelease(c,false);else releaseToFastLane(c);}
      snapshot[c.id]={state:c.pitState,v:c.v||0,s:c.s||0,pitTimer:Number(c.pitTimer)||0,phase:c._runtimePitPhase||'TRACK',releaseWait:!!c._runtimeReleaseWait};
      if(c.pitState==='ENTRY'){if(!c._runtimePitPhase||c._runtimePitPhase==='TRACK')c._runtimePitPhase=W.inPitSpeedZone?.(c.s)?'FAST_LANE':'PIT_ENTRY';if(!W.inPitWindow?.(c.s))c.laneTarget=Math.max(c.laneTarget||0,3.8);}
    }
    const occupied=serviceOccupants();for(const c of R.cars){if(c.retired||!c._runtimePitQueued)continue;if(occupied.has(c.teamId??0))holdQueue(c);else releaseQueue(c);}return snapshot;
  }

  function afterUpdate(dt,snapshot,eventStart){
    for(const c of R.cars){ensureArrival(c);const b=snapshot[c.id]||{state:'NONE',v:c.v||0};rejectPrematureLegacyStop(c,b.state,b.v,dt,eventStart);}
    // Service duration and STOP -> release transition are owned here, not by the
    // historical pit controller hidden during baseUpdate(). This prevents the
    // old controller from being disabled together with the service countdown.
    for(const c of R.cars){const b=snapshot[c.id];if(b?.state==='STOP')advanceService(c,b,dt,eventStart);}

    const stopGroups=new Map();for(const c of R.cars){if(c.retired||c.pitState!=='STOP')continue;const team=c.teamId??0,list=stopGroups.get(team)||[];list.push(c);stopGroups.set(team,list);}
    for(const list of stopGroups.values()){if(list.length<2)continue;list.sort((a,b)=>(a._runtimePitArrival??Infinity)-(b._runtimePitArrival??Infinity)||a.id-b.id);for(let i=1;i<list.length;i++)queue(list[i],true,eventStart);}

    let occupied=serviceOccupants();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='ENTRY')continue;const blocker=occupied.get(c.teamId??0),dist=W.pitDistanceToBox?.(c.s,c.teamId);
      if(c._runtimePitQueued){if(blocker)holdQueue(c,eventStart);else releaseQueue(c);continue;}
      if(blocker&&Number.isFinite(dist)&&dist<=QUEUE_TRIGGER_METERS&&dist>-2.5){queue(c,false,eventStart);continue;}
      c._runtimePitPhase=Number.isFinite(dist)&&dist<24?'WORKING_APPROACH':'FAST_LANE';c.pitLaneStatus=c._runtimePitPhase==='WORKING_APPROACH'?'WORKING':'FAST LANE';
    }
    occupied=serviceOccupants();for(const c of R.cars){if(maybeStartService(c,dt,occupied))occupied.set(c.teamId??0,c);}

    for(const c of R.cars){
      const b=snapshot[c.id]||{state:'NONE',v:0,s:c.s};
      ensurePitMotion(c,b,dt);
      if(c.pitState==='STOP'){c._runtimePitPhase='SERVICE';c.s=W.pitBoxS?.(c.teamId)??c.s;c.v=0;c.pitLaneStatus='JACKS';posePit(c,'STOP');}
      else if(c.pitState==='EXIT'){
        if(c._runtimeReleaseWait)holdRelease(c,false);
        else if(c._runtimePitPhase==='WORKING_EXIT'){
          const boxS=W.pitBoxS?.(c.teamId),past=Number.isFinite(boxS)?pitMeters(c.s)-pitMeters(boxS):0;
          if(past>=WORKING_EXIT_BLEND_METERS)c._runtimePitPhase='FAST_LANE_EXIT';
          c.pitLaneStatus=c._runtimePitPhase==='FAST_LANE_EXIT'?'PIT EXIT':'RELEASE';posePit(c,'EXIT');
        }else{c._runtimePitPhase='FAST_LANE_EXIT';c.pitLaneStatus='PIT EXIT';posePit(c,'EXIT');}
      }else if(c.pitState==='ENTRY'){
        if(c._runtimePitQueued)holdQueue(c,eventStart);else posePit(c,'ENTRY');
      }else if(b.state==='EXIT'&&c.pitState==='NONE'&&!c.retired){
        const uf=W.pitUnwrappedFraction?.(c.s),exit=SUZUKA_PIT.exitEndUF;
        if(Number.isFinite(uf)&&uf<exit){c.pitState='EXIT';c.v=Math.min(Math.max(b.v||0,8),W.pitSpeedLimit||22.22);c._runtimePitPhase='FAST_LANE_EXIT';c.pitLaneStatus='PIT EXIT';posePit(c,'EXIT');}
        else{c._runtimePitPhase='MERGE';c.lane=SUZUKA_PIT.mergeTrackOffset;c.laneTarget=4.0;c.pitLaneStatus='MERGE';poseTrack(c);}
      }else if(c.pitState==='NONE'&&c._runtimePitPhase==='MERGE'){c._runtimePitPhase='TRACK';c._runtimePitArrival=null;c._runtimePitQueued=false;c._runtimeQueueS=null;c._runtimeReleaseWait=false;c.pitLaneStatus='TRACK';}
      repairInvariant(c);
    }
  }

  function diagnostics(){return{owner:'runtime',metrics:{...metrics},cars:R.cars.filter(c=>c.pitState!=='NONE'||c._runtimePitPhase==='MERGE').map(c=>({id:c.id,team:c.teamId,state:c.pitState,phase:c._runtimePitPhase||'TRACK',queued:!!c._runtimePitQueued,releaseWait:!!c._runtimeReleaseWait,s:c.s,v:c.v,status:c.pitLaneStatus,pitTimer:c.pitTimer}))};}
  return{beforeUpdate,afterUpdate,diagnostics,get metrics(){return{...metrics}}};
}