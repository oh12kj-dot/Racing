import {createRace as createSpectatorRace} from './race-spectator-intelligence.js';
import {resolvePitRuntimeSpec} from './pit-config.js';
import {createTrajectoryController} from './trajectory-controller.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>v!=null&&v!==''&&Number.isFinite(Number(v));
const smooth01=t=>{t=clamp(Number(t)||0,0,1);return t*t*(3-2*t);};
const PIT_ENTRY_CAPTURE_METERS=18;

function validExitCar(c){
  if(!c||c.retired||c._runtimeReleaseWait)return false;
  const phase=String(c._runtimePitPhase||'');
  if(c.pitState==='EXIT')return['FAST_LANE_EXIT','PIT_EXIT','MERGE'].includes(phase);
  // pit-state historically flips EXIT -> NONE at the exit-end marker. Reclaim that
  // transition before trajectory control can snap the car onto the normal lane.
  return c.pitState==='NONE'&&phase==='MERGE'&&(c._runtimePitArrival!=null||finite(c._runtimePitMergeStartS));
}

export function pitExitStage(W,c){
  if(!validExitCar(c))return'INACTIVE';
  if(String(c._runtimePitPhase||'')==='MERGE'||finite(c._runtimePitMergeStartS))return'MERGE';
  const inSpeed=typeof W?.inPitSpeedZone==='function'?!!W.inPitSpeedZone(c.s):null;
  const inWindow=typeof W?.inPitWindow==='function'?!!W.inPitWindow(c.s):null;
  if(inSpeed===true)return'LIMITED';
  if(inSpeed===false&&inWindow===true)return'ACCELERATE';
  if(inWindow===false)return'MERGE';
  if(typeof W?.pitUnwrappedFraction==='function'){
    const uf=Number(W.pitUnwrappedFraction(c.s)),layout=W.realisticPitLayout||{},spec=resolvePitRuntimeSpec(W),exitBegin=Number(layout.exitBeginUF);
    if(Number.isFinite(uf)){
      if(Number.isFinite(exitBegin)&&uf<exitBegin)return'LIMITED';
      if(uf<spec.exitEndUF)return'ACCELERATE';
      return'MERGE';
    }
  }
  return'LIMITED';
}

function forwardDistance(total,a,b){
  const t=Math.max(1,Number(total)||1),x=((Number(b)||0)-(Number(a)||0))%t;
  return(x+t)%t;
}

function clearMergeState(c){
  c._runtimePitMergeStartS=null;c._runtimePitMergeLastS=null;c._runtimePitMergeDistance=0;c._runtimePitMergeStartOffset=null;
}

function poseDrivenMerge(W,c,spec,alpha,distance){
  const start=finite(c._runtimePitMergeStartOffset)?Number(c._runtimePitMergeStartOffset):Number(spec.mergeTrackOffset)||0,target=Number(spec.mergeLaneTarget)||0;
  const offset=start+(target-start)*smooth01(alpha),look=1.2,total=Math.max(1,Number(W.total)||1),nextAlpha=clamp((distance+look)/Math.max(1,Number(spec.mergeBlendMeters)||42),0,1),nextOffset=start+(target-start)*smooth01(nextAlpha);
  c.lane=offset;c.laneTarget=target;
  if(!c.mesh||typeof W.sample!=='function')return;
  const q=W.sample(c.s,offset),q2=W.sample(((Number(c.s)||0)+look)%total,nextOffset);if(!q?.p)return;
  c.mesh.position.copy(q.p);c.mesh.position.y+=.12;
  if(q2?.p){const t=q2.p.clone().sub(q.p);t.y=0;if(t.lengthSq?.()>.0001){t.normalize();c.mesh.rotation.y=Math.atan2(t.x,t.z);return;}}
  if(q.t)c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
}

function advanceDrivenMerge(W,c,spec){
  const total=Math.max(1,Number(W.total)||1),blend=Math.max(8,Number(spec.mergeBlendMeters)||42);
  if(!finite(c._runtimePitMergeStartS)){
    c._runtimePitMergeStartS=Number(c.s)||0;c._runtimePitMergeLastS=Number(c.s)||0;c._runtimePitMergeDistance=0;c._runtimePitMergeStartOffset=finite(spec.mergeTrackOffset)?Number(spec.mergeTrackOffset):(Number(c.lane)||0);
  }else{
    const previous=finite(c._runtimePitMergeLastS)?Number(c._runtimePitMergeLastS):Number(c.s)||0,step=forwardDistance(total,previous,c.s);
    // Ignore impossible discontinuities from stale legacy state; normal frame travel
    // is only a few metres, even at maximum speed.
    if(step<Math.max(20,(Number(c.v)||0)*.25+8))c._runtimePitMergeDistance=(Number(c._runtimePitMergeDistance)||0)+step;
    c._runtimePitMergeLastS=Number(c.s)||0;
  }
  const distance=Math.max(0,Number(c._runtimePitMergeDistance)||0),alpha=clamp(distance/blend,0,1);
  c.pitState='EXIT';c.pitTimer=0;c._runtimePitPhase='MERGE';c.pitLaneStatus='PIT EXIT · MERGE';poseDrivenMerge(W,c,spec,alpha,distance);
  if(alpha<1)return false;
  const target=Number(spec.mergeLaneTarget)||0;c.lane=target;c.laneTarget=target;c.pitState='NONE';c._runtimePitPhase='MERGE';c.pitLaneStatus='MERGE';clearMergeState(c);return true;
}

export function advancePitExitAfterLimiter(W,c,dt=.016,beforeV=null,raceTime=0){
  const stage=pitExitStage(W,c);if(stage==='INACTIVE'||stage==='LIMITED')return stage;
  if(!c._runtimePitExitLimiterReleased){c._runtimePitExitLimiterReleased=true;c._runtimePitExitReleasedAt=Number(raceTime)||0;}
  if(stage==='ACCELERATE'){
    const step=clamp(Number(dt)||.016,.001,.05),start=finite(beforeV)?Number(beforeV):Math.max(0,Number(c.v)||0);
    const accelBase=Math.max(3.5,Number(c._v18BaseAccel)||Number(c.accel)||5.4),accel=clamp(accelBase*.72,3.5,6.5);
    c.v=Math.max(Number(c.v)||0,start+accel*step);
    c._runtimePitPhase='FAST_LANE_EXIT';c.pitLaneStatus='PIT EXIT · ACCEL';
    return'ACCELERATE';
  }
  const spec=resolvePitRuntimeSpec(W);advanceDrivenMerge(W,c,spec);return'MERGE';
}

function enforcePitEntrySurface(W,c){
  if(!c||c.retired||c.pitState!=='ENTRY'||!c.mesh||!W.inPitWindow?.(c.s)||typeof W.pitPose!=='function'||typeof W.sample!=='function')return false;
  const total=Math.max(1,Number(W.total)||1),entryUF=Number(W.pitCoordinateAudit?.entryUF),uf=Number(W.pitUnwrappedFraction?.(c.s));
  if(!Number.isFinite(entryUF)||!Number.isFinite(uf))return false;
  const meters=(uf-entryUF)*total;if(!Number.isFinite(meters)||meters<0)return false;
  const pit=W.pitPose(c.s,c.teamId,'ENTRY');if(!pit?.p)return false;
  if(meters>=PIT_ENTRY_CAPTURE_METERS){c.mesh.position.copy(pit.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Number(pit.rotationY)||Math.atan2(pit.t?.x||0,pit.t?.z||1);c._runtimePitEntryBlend=1;return true;}
  const lane=finite(c._runtimePitEntryLane)?Number(c._runtimePitEntryLane):(Number(c.lane)||0),alpha=smooth01(meters/PIT_ENTRY_CAPTURE_METERS),pitOffset=finite(pit.offset)?Number(pit.offset):Number(W.pitOffsetAtS?.(c.s));
  if(!finite(pitOffset))return false;
  const offset=lane+(pitOffset-lane)*alpha,q=W.sample(c.s,offset);if(!q?.p)return false;
  c.mesh.position.copy(q.p);c.mesh.position.y+=.12;
  const track=W.sample(c.s,lane),trackYaw=track?.t?Math.atan2(track.t.x,track.t.z):Number(pit.rotationY)||0,pitYaw=Number(pit.rotationY)||trackYaw,tau=Math.PI*2,delta=((pitYaw-trackYaw+Math.PI)%tau+tau)%tau-Math.PI;c.mesh.rotation.y=trackYaw+delta*alpha;c._runtimePitEntryBlend=alpha;return true;
}

export function createRace(W,statusEl,settings={}){
  W.runtimeTrajectoryControl='runtime-trajectory-controller-v3-pooled';
  W.runtimeRacecraftAuthority='runtime-racecraft-v2';
  const R=createSpectatorRace(W,statusEl,settings),baseUpdate=R.update,beforeSpeed=new Float64Array(Math.max(1,R.cars?.length||20));
  const mobile=!!globalThis.matchMedia?.('(pointer:coarse)')?.matches,trajectory=createTrajectoryController(W,R,{mobile});
  let limiterReleases=0,mergeReleases=0,updates=0,entrySurfaceFrames=0;

  function preparePitApproach(){
    const limit=Number(W.pitSpeedLimit)||22.22;
    for(const c of R.cars||[]){
      if(c.retired||c.pitState!=='ENTRY'||!W.inPitWindow?.(c.s)||c._runtimePitQueued)continue;
      const dist=Number(W.pitDistanceToBox?.(c.s,c.teamId));if(!Number.isFinite(dist)||dist<-.5)continue;
      const decel=clamp((Number(c._v18BaseBrake)||Number(c.brake)||15)*.52,5.5,9.5),target=Math.min(limit,Math.sqrt(Math.max(.35,2*decel*Math.max(.12,dist))));
      if(dist<34)c.v=Math.min(Number(c.v)||0,target);
      if(dist<8)c.v=Math.min(c.v,Math.max(1.8,target*.72));
      if(dist<2.2)c.v=Math.min(c.v,Math.max(.7,dist*1.15));
      c.pitApproachTargetSpeed=target;c.pitApproachDistance=dist;
    }
  }

  function update(dt){
    const cars=R.cars||[],trajectoryFrame=trajectory.capture();preparePitApproach();
    for(let i=0;i<cars.length;i++)beforeSpeed[i]=Number(cars[i].v)||0;
    baseUpdate(dt);
    for(let i=0;i<cars.length;i++){
      const c=cars[i],wasReleased=!!c._runtimePitExitLimiterReleased,wasMerging=finite(c._runtimePitMergeStartS)||String(c._runtimePitPhase||'')==='MERGE',stage=advancePitExitAfterLimiter(W,c,dt,beforeSpeed[i],R.race?.t||0);
      if(!wasReleased&&c._runtimePitExitLimiterReleased)limiterReleases++;
      if(stage==='MERGE'&&!wasMerging)mergeReleases++;
      if(enforcePitEntrySurface(W,c))entrySurfaceFrames++;
    }
    trajectory.update(dt,trajectoryFrame);updates++;
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='trajectoryDiagnostics')return trajectory.diagnostics();
    if(prop==='pitExitLimiterDiagnostics')return{owner:'runtime-pit-exit-release-v4-continuous-path',limiterReleases,mergeReleases,entrySurfaceFrames,updates,snapshotAllocations:1,cars:(R.cars||[]).filter(c=>c._runtimePitExitLimiterReleased).map(c=>({id:c.id,phase:c._runtimePitPhase,pitState:c.pitState,releasedAt:c._runtimePitExitReleasedAt,v:c.v,mergeDistance:c._runtimePitMergeDistance||0}))};
    return Reflect.get(target,prop,target);
  }});
}
