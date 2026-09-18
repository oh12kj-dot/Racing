import {resolvePitRuntimeSpec} from './pit-config.js';

export function pitStopCaptureWindow(v,dt=.016){
  const step=Math.max(.001,Math.min(.05,Number(dt)||.016)),speed=Math.max(0,Number(v)||0);
  return Math.max(.08,Math.min(.22,speed*step*1.35+.045));
}

export function createPitStateMachine(W,R){
  const spec=resolvePitRuntimeSpec(W),serviceTime=spec.serviceTime,total=Math.max(1,W.total||1);let arrivalSerial=0;
  const metrics={queued:0,released:0,services:0,legacyStopsRejected:0,doubleStacks:0,invariantRepairs:0,releaseWaits:0,safeReleases:0,serviceCompletions:0,stallRecoveries:0,driveThroughs:0,ttcBlocks:0,earlyEntriesDeferred:0,pitEntriesActivated:0,serviceCaptures:0,maxServiceCaptureMeters:0};
  const wrapS=s=>((s%total)+total)%total;
  const pitMeters=s=>(W.pitUnwrappedFraction?.(s)??(wrapS(s)/total))*total;
  const forwardDelta=(a,b)=>((wrapS(b)-wrapS(a))%total+total)%total;
  const longitudinalDistance=(a,b)=>Math.min(forwardDelta(a,b),forwardDelta(b,a));
  const inPitWindow=c=>typeof W.inPitWindow==='function'?!!W.inPitWindow(c.s):true;
  const serviceS=c=>Number.isFinite(Number(c?._runtimePitServiceS))?wrapS(Number(c._runtimePitServiceS)):wrapS(Number(c?.s)||0);

  function poseTrack(c){
    if(!c?.mesh)return;const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
  }
  function workingPoseAt(s,c){
    let q=W.pitWorkingPose?.(s);
    if(!q&&typeof W.pitWorkingOffsetAtS==='function'){
      const base=W.sample(s,W.pitWorkingOffsetAtS(s));
      if(base)q={...base,rotationY:Math.atan2(base.t.x,base.t.z)};
    }
    return q||W.pitPose?.(s,c?.teamId,'STOP');
  }
  function posePit(c,state=c.pitState){
    if(!c?.mesh)return;if(state==='ENTRY'&&!inPitWindow(c)){poseTrack(c);return;}
    const q=state==='STOP'?workingPoseAt(serviceS(c),c):W.pitPose?.(c.s,c.teamId,state);if(!q)return;
    c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;
  }
  function poseWorking(c){
    if(!c?.mesh)return;const q=W.pitWorkingPose?.(c.s)||W.pitPose?.(c.s,c.teamId,'ENTRY');if(!q)return;c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=q.rotationY;
  }
  function clearServiceAnchor(c){c._runtimePitServiceS=null;c._runtimePitStopCaptureDistance=0;}
  function ensureArrival(c){
    if(c.pitState!=='NONE'&&c._runtimePitArrival==null)c._runtimePitArrival=++arrivalSerial;
    if(c.pitState==='NONE'&&c._runtimePitPending){c._runtimePitPhase='PIT_APPROACH';return;}
    if(c.pitState==='NONE'&&c._runtimePitArrival!=null&&c._runtimePitPhase!=='MERGE'){
      c._runtimePitArrival=null;c._runtimePitQueued=false;c._runtimeQueueS=null;c._runtimeReleaseWait=false;c._runtimePitPhase='TRACK';clearServiceAnchor(c);
    }
  }
  function deferEarlyEntry(c){
    if(c.retired||c.pitState!=='ENTRY'||inPitWindow(c))return false;const fresh=!c._runtimePitPending;c._runtimePitPending=true;c.pitState='NONE';c.pitTimer=0;c._pitStopInitial=0;c._runtimePitPhase='PIT_APPROACH';c.pitLaneStatus='PIT APPROACH';clearServiceAnchor(c);poseTrack(c);if(fresh)metrics.earlyEntriesDeferred++;return true;
  }
  function activatePendingEntry(c){
    if(!c._runtimePitPending||c.retired||c.pitState!=='NONE'||!inPitWindow(c))return false;if(W.inPitSpeedZone?.(c.s))return false;c._runtimePitPending=false;c.pitState='ENTRY';c.pitTimer=0;c._runtimePitPhase='PIT_ENTRY';c.pitLaneStatus='PIT ENTRY';metrics.pitEntriesActivated++;return true;
  }
  function removeFreshPitStopEvent(carId,eventStart){
    if(!Array.isArray(R.events))return;for(let i=R.events.length-1;i>=eventStart;i--){const e=R.events[i];if(e?.carId===carId&&e?.type==='PIT_STOP')R.events.splice(i,1);}
  }
  function serviceOccupants(){
    const m=new Map();for(const c of R.cars){if(c.retired||c.pitState!=='STOP')continue;ensureArrival(c);const team=c.teamId??0,prior=m.get(team);if(!prior||(c._runtimePitArrival??Infinity)<(prior._runtimePitArrival??Infinity))m.set(team,c);}return m;
  }
  function fastLaneTraffic(c,countTtc=true){
    const u=pitMeters(c.s),near=[];for(const o of R.cars){
      if(o===c||o.retired||o._runtimePitQueued||o.pitState==='STOP'||o.pitState==='NONE')continue;
      const phase=o._runtimePitPhase||'',fast=phase==='FAST_LANE'||phase==='FAST_LANE_EXIT'||phase==='PIT_ENTRY'||(o.pitState==='EXIT'&&!['WORKING_EXIT','RELEASE_WAIT'].includes(phase));if(!fast)continue;
      const delta=pitMeters(o.s)-u,behind=delta<0,closing=behind?Math.max(.1,(o.v||0)-(c.v||0)):0,ttc=behind?(-delta)/closing:Infinity,block=(behind&&(-delta<Math.max(spec.releaseBehindMeters,28)||ttc<1.8))||(!behind&&delta<Math.max(spec.releaseAheadMeters,10));
      if(block){if(countTtc&&ttc<1.8)metrics.ttcBlocks++;near.push({car:o,delta,ttc});}
    }
    return near.sort((a,b)=>Math.abs(a.delta)-Math.abs(b.delta));
  }
  const releaseBlocked=c=>fastLaneTraffic(c).length>0;
  function queue(c,forceGap=false,eventStart=Infinity){
    const boxS=W.pitBoxS?.(c.teamId);if(!Number.isFinite(boxS))return false;if(forceGap||!Number.isFinite(c._runtimeQueueS))c._runtimeQueueS=forceGap?wrapS(boxS-spec.queueGapMeters):wrapS(c.s);
    clearServiceAnchor(c);c._runtimePitQueued=true;c._runtimePitPhase='QUEUE';c.s=c._runtimeQueueS;c.v=0;c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.pitLaneStatus='QUEUE';removeFreshPitStopEvent(c.id,eventStart);poseWorking(c);metrics.queued++;if(forceGap)metrics.doubleStacks++;return true;
  }
  function holdQueue(c,eventStart=Infinity){
    if(!c._runtimePitQueued||!Number.isFinite(c._runtimeQueueS))return;c._runtimePitPhase='QUEUE';c.s=c._runtimeQueueS;c.v=0;c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.pitLaneStatus='QUEUE';removeFreshPitStopEvent(c.id,eventStart);poseWorking(c);
  }
  function releaseQueue(c){
    c._runtimePitQueued=false;c._runtimeQueueS=null;clearServiceAnchor(c);c._runtimePitPhase='WORKING_APPROACH';c.pitState='ENTRY';c.pitTimer=0;c.v=Math.max(c.v||0,7);c.pitLaneStatus='WORKING';posePit(c,'ENTRY');metrics.released++;
  }
  function startService(c,captureDistance=0){
    if(c._driveThroughServing)return false;const boxS=W.pitBoxS?.(c.teamId);if(!Number.isFinite(boxS))return false;
    const correction=Math.max(0,Number(captureDistance)||0);c._runtimePitStopCaptureDistance=correction;c._runtimePitServiceS=wrapS(c.s);metrics.serviceCaptures++;metrics.maxServiceCaptureMeters=Math.max(metrics.maxServiceCaptureMeters,correction);
    c._runtimePitQueued=false;c._runtimeQueueS=null;c._runtimeReleaseWait=false;c._runtimePitPhase='SERVICE';c.v=0;c.pitState='STOP';c.pitTimer=serviceTime[c.type]||3.5;c._pitStopInitial=c.pitTimer;c.pitLaneStatus='JACKS';posePit(c,'STOP');metrics.services++;return true;
  }
  function holdRelease(c,count=true){
    if(count&&!c._runtimeReleaseWait)metrics.releaseWaits++;const stop=serviceS(c);c._runtimePitServiceS=stop;c._runtimeReleaseWait=true;c._runtimePitPhase='RELEASE_WAIT';c.s=stop;c.v=0;c.pitState='EXIT';c.pitTimer=0;c.pitLaneStatus='RELEASE WAIT';poseWorking(c);
  }
  function releaseToFastLane(c){
    c._runtimeReleaseWait=false;c._runtimePitPhase='WORKING_EXIT';c.pitState='EXIT';c.s=serviceS(c);c.v=Math.max(c.v||0,7);c.pitLaneStatus='RELEASE';posePit(c,'EXIT');metrics.safeReleases++;
  }
  function advanceService(c,b,dt,eventStart){
    if(c.retired||c._driveThroughServing||b?.state!=='STOP')return false;
    const start=Number.isFinite(Number(b.pitTimer))?Number(b.pitTimer):Math.max(0,Number(c.pitTimer)||0),remaining=Math.max(0,start-Math.max(0,dt||0));
    if(remaining>0){
      if(c.pitState!=='STOP')removeFreshPitStopEvent(c.id,eventStart);const stop=serviceS(c);c._runtimePitServiceS=stop;c.pitState='STOP';c.pitTimer=remaining;c._runtimePitPhase='SERVICE';c.s=stop;c.v=0;c.pitLaneStatus='JACKS';posePit(c,'STOP');return true;
    }
    c.pitTimer=0;c.pitState='EXIT';metrics.serviceCompletions++;if(releaseBlocked(c))holdRelease(c);else releaseToFastLane(c);return true;
  }
  function maybeStartService(c,dt,occupied){
    if(c.retired||c._driveThroughServing||c.pitState!=='ENTRY'||c._runtimePitQueued||!inPitWindow(c)||occupied.has(c.teamId??0))return false;
    const dist=W.pitDistanceToBox?.(c.s,c.teamId),speed=Math.max(0,Number(c.v)||0);if(!Number.isFinite(dist))return false;const capture=pitStopCaptureWindow(speed,dt);return Math.abs(dist)<=capture&&speed<=2.6?startService(c,Math.abs(dist)):false;
  }
  function handleDriveThrough(c,b,dt,eventStart){
    if(!c._driveThroughServing||c._runtimePitPending||!inPitWindow(c))return false;removeFreshPitStopEvent(c.id,eventStart);c._runtimePitQueued=false;c._runtimeReleaseWait=false;clearServiceAnchor(c);
    const beforeS=Number.isFinite(b?.s)?b.s:c.s,limit=W.pitSpeedLimit||22.22;c.v=Math.min(limit,Math.max(Number(c.v)||0,Number(b?.v)||0,10));c.s=wrapS(beforeS+c.v*Math.max(.001,dt));const uf=Number(W.pitUnwrappedFraction?.(c.s));
    if(Number.isFinite(uf)&&uf>=spec.exitEndUF-.018){c.pitState='EXIT';c._runtimePitPhase='FAST_LANE_EXIT';c.pitLaneStatus='DRIVE THROUGH EXIT';posePit(c,'EXIT');}
    else{c.pitState='ENTRY';c._runtimePitPhase=W.inPitSpeedZone?.(c.s)?'FAST_LANE':'PIT_ENTRY';c.pitLaneStatus=W.inPitSpeedZone?.(c.s)?'DRIVE THROUGH':'PIT ENTRY';posePit(c,'ENTRY');}
    if(b?.state==='STOP')metrics.driveThroughs++;return true;
  }
  function rejectPrematureLegacyStop(c,beforeState,beforeV,dt,eventStart){
    if(c._driveThroughServing||beforeState!=='ENTRY'||c.pitState!=='STOP')return false;
    const dist=W.pitDistanceToBox?.(c.s,c.teamId),speed=Math.max(0,Number(beforeV)||0),capture=pitStopCaptureWindow(speed,dt);
    if(Number.isFinite(dist)&&Math.abs(dist)<=capture&&speed<=2.6){c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;return startService(c,Math.abs(dist));}
    clearServiceAnchor(c);c.pitState='ENTRY';c.pitTimer=0;c._pitStopInitial=0;c.v=Math.min(Math.max(Math.min(speed,2.6),.7),W.pitSpeedLimit||22.22);c.pitLaneStatus='WORKING';c._runtimePitPhase='WORKING_APPROACH';removeFreshPitStopEvent(c.id,eventStart);posePit(c,'ENTRY');metrics.legacyStopsRejected++;return true;
  }
  function ensurePitMotion(c,b,dt){
    if(c.retired||c._runtimePitQueued||c._runtimeReleaseWait||c._driveThroughServing||!b||!['ENTRY','EXIT'].includes(c.pitState))return false;if(c.pitState==='ENTRY'&&!inPitWindow(c))return false;
    const step=Math.max(0,Number(dt)||0);if(step<=0)return false;const beforeS=Number.isFinite(Number(b.s))?b.s:c.s,progress=forwardDelta(beforeS,c.s),limit=W.pitSpeedLimit||22.22,dist=Number(W.pitDistanceToBox?.(c.s,c.teamId)),fastLane=c.pitState==='ENTRY'&&c._runtimePitPhase==='FAST_LANE'&&b.phase==='FAST_LANE';
    if(fastLane&&Number.isFinite(dist)&&dist>=24&&!fastLaneTraffic(c,false).length)c.v=Math.min(limit,Math.max(Number(c.v)||0,Number(b.v)||0));
    const expected=Math.max(0,Number(b.v)||0,Number(c.v)||0)*step;if(progress>=Math.max(.015,expected*.08))return false;
    const floor=c.pitState==='ENTRY'&&c._runtimePitPhase==='WORKING_APPROACH'?.7:(c.pitState==='ENTRY'?7:(c._runtimePitPhase==='WORKING_EXIT'?8:10));c.v=Math.min(limit,Math.max(Number(c.v)||0,Number(b.v)||0,floor));c.s=wrapS(beforeS+c.v*step);metrics.stallRecoveries++;return true;
  }
  function repairInvariant(c){
    if(c.retired)return;let repaired=false;
    if(c._runtimePitQueued&&c.pitState!=='ENTRY'){c.pitState='ENTRY';repaired=true;}
    if(c._runtimeReleaseWait&&c.pitState!=='EXIT'){c.pitState='EXIT';repaired=true;}
    if(c._runtimePitPending&&c.pitState!=='NONE'){c._runtimePitPending=false;repaired=true;}
    if(c.pitState==='STOP'){
      if(!Number.isFinite(Number(c._runtimePitServiceS))){c._runtimePitServiceS=wrapS(c.s);repaired=true;}
      const stop=serviceS(c);if(longitudinalDistance(c.s,stop)>.25){c.s=stop;repaired=true;}if((c.v||0)!==0){c.v=0;repaired=true;}
    }
    if(c.pitState==='NONE'&&c._runtimePitQueued){c._runtimePitQueued=false;c._runtimeQueueS=null;repaired=true;}
    if(repaired)metrics.invariantRepairs++;
  }
  function beforeUpdate(){
    const snapshot=[];
    for(const c of R.cars){
      if(c.pitState==='ENTRY'&&!inPitWindow(c))deferEarlyEntry(c);activatePendingEntry(c);ensureArrival(c);if(c._runtimeReleaseWait){if(releaseBlocked(c))holdRelease(c,false);else releaseToFastLane(c);}
      snapshot[c.id]={state:c.pitState,v:c.v||0,s:c.s||0,pitTimer:Number(c.pitTimer)||0,phase:c._runtimePitPhase||'TRACK',releaseWait:!!c._runtimeReleaseWait,pending:!!c._runtimePitPending};
      if(c.pitState==='ENTRY'&&inPitWindow(c)){if(!c._runtimePitPhase||['TRACK','PIT_APPROACH'].includes(c._runtimePitPhase))c._runtimePitPhase=W.inPitSpeedZone?.(c.s)?'FAST_LANE':'PIT_ENTRY';}
      else if(c._runtimePitPending){c._runtimePitPhase='PIT_APPROACH';c.pitLaneStatus='PIT APPROACH';}
    }
    const occupied=serviceOccupants();for(const c of R.cars){if(c.retired||!c._runtimePitQueued)continue;if(occupied.has(c.teamId??0))holdQueue(c);else releaseQueue(c);}return snapshot;
  }
  function afterUpdate(dt,snapshot,eventStart){
    for(const c of R.cars){const b=snapshot[c.id]||{state:'NONE',v:c.v||0,s:c.s};if(c.pitState==='ENTRY'&&!inPitWindow(c)){deferEarlyEntry(c);ensureArrival(c);continue;}ensureArrival(c);if(!c._driveThroughServing)rejectPrematureLegacyStop(c,b.state,b.v,dt,eventStart);}
    for(const c of R.cars){const b=snapshot[c.id];if(!c._driveThroughServing&&b?.state==='STOP')advanceService(c,b,dt,eventStart);}
    const stopGroups=new Map();
    for(const c of R.cars){if(c.retired||c.pitState!=='STOP'||c._driveThroughServing)continue;const team=c.teamId??0,list=stopGroups.get(team)||[];list.push(c);stopGroups.set(team,list);}
    for(const list of stopGroups.values()){if(list.length<2)continue;list.sort((a,b)=>(a._runtimePitArrival??Infinity)-(b._runtimePitArrival??Infinity)||a.id-b.id);for(let i=1;i<list.length;i++)queue(list[i],true,eventStart);}
    let occupied=serviceOccupants();
    for(const c of R.cars){
      if(c.retired||c.pitState!=='ENTRY'||c._driveThroughServing)continue;if(!inPitWindow(c)){deferEarlyEntry(c);continue;}
      const blocker=occupied.get(c.teamId??0),dist=W.pitDistanceToBox?.(c.s,c.teamId);
      if(c._runtimePitQueued){if(blocker)holdQueue(c,eventStart);else releaseQueue(c);continue;}
      if(blocker&&Number.isFinite(dist)&&dist<=spec.queueTriggerMeters&&dist>-2.5){queue(c,false,eventStart);continue;}
      c._runtimePitPhase=Number.isFinite(dist)&&dist<24?'WORKING_APPROACH':(W.inPitSpeedZone?.(c.s)?'FAST_LANE':'PIT_ENTRY');c.pitLaneStatus=c._runtimePitPhase==='WORKING_APPROACH'?'WORKING':c._runtimePitPhase==='PIT_ENTRY'?'PIT ENTRY':'FAST LANE';
    }
    occupied=serviceOccupants();for(const c of R.cars){if(maybeStartService(c,dt,occupied))occupied.set(c.teamId??0,c);}
    for(const c of R.cars){
      const b=snapshot[c.id]||{state:'NONE',v:0,s:c.s};if(c._driveThroughServing&&handleDriveThrough(c,b,dt,eventStart)){repairInvariant(c);continue;}ensurePitMotion(c,b,dt);
      if(c.pitState==='STOP'){
        const stop=serviceS(c);c._runtimePitServiceS=stop;c._runtimePitPhase='SERVICE';c.s=stop;c.v=0;c.pitLaneStatus='JACKS';posePit(c,'STOP');
      }else if(c.pitState==='EXIT'){
        if(c._runtimeReleaseWait)holdRelease(c,false);
        else if(c._runtimePitPhase==='WORKING_EXIT'){
          const boxS=W.pitBoxS?.(c.teamId),past=Number.isFinite(boxS)?pitMeters(c.s)-pitMeters(boxS):0;if(past>=spec.workingExitBlendMeters)c._runtimePitPhase='FAST_LANE_EXIT';c.pitLaneStatus=c._runtimePitPhase==='FAST_LANE_EXIT'?'PIT EXIT':'RELEASE';posePit(c,'EXIT');
        }else{c._runtimePitPhase='FAST_LANE_EXIT';c.pitLaneStatus='PIT EXIT';posePit(c,'EXIT');}
      }else if(c.pitState==='ENTRY'){
        if(!inPitWindow(c))deferEarlyEntry(c);else if(c._runtimePitQueued)holdQueue(c,eventStart);else posePit(c,'ENTRY');
      }else if(b.state==='EXIT'&&c.pitState==='NONE'&&!c.retired){
        const uf=W.pitUnwrappedFraction?.(c.s);if(Number.isFinite(uf)&&uf<spec.exitEndUF){c.pitState='EXIT';c.v=Math.min(Math.max(b.v||0,8),W.pitSpeedLimit||22.22);c._runtimePitPhase='FAST_LANE_EXIT';c.pitLaneStatus='PIT EXIT';posePit(c,'EXIT');}
        else{c._runtimePitPhase='MERGE';c.lane=spec.mergeTrackOffset;c.laneTarget=spec.mergeLaneTarget;c.pitLaneStatus='MERGE';poseTrack(c);}
      }else if(c.pitState==='NONE'&&c._runtimePitPhase==='MERGE'){
        c._runtimePitPhase='TRACK';c._runtimePitArrival=null;c._runtimePitQueued=false;c._runtimeQueueS=null;c._runtimeReleaseWait=false;c.pitLaneStatus='TRACK';clearServiceAnchor(c);
      }else if(c.pitState==='NONE'&&c._runtimePitPending){c._runtimePitPhase='PIT_APPROACH';c.pitLaneStatus='PIT APPROACH';poseTrack(c);}
      repairInvariant(c);
    }
  }
  function diagnostics(){
    return{owner:'runtime',spec:{...spec,serviceTime:{...spec.serviceTime}},metrics:{...metrics},cars:R.cars.filter(c=>c.pitState!=='NONE'||c._runtimePitPhase==='MERGE'||c._runtimePitPending).map(c=>({id:c.id,team:c.teamId,state:c.pitState,phase:c._runtimePitPhase||'TRACK',queued:!!c._runtimePitQueued,releaseWait:!!c._runtimeReleaseWait,pending:!!c._runtimePitPending,driveThrough:!!c._driveThroughServing,s:c.s,v:c.v,status:c.pitLaneStatus,pitTimer:c.pitTimer,stopCapture:c._runtimePitStopCaptureDistance||0,serviceS:Number.isFinite(Number(c._runtimePitServiceS))?c._runtimePitServiceS:null}))};
  }
  return{beforeUpdate,afterUpdate,diagnostics,fastLaneTraffic,get metrics(){return{...metrics}}};
}