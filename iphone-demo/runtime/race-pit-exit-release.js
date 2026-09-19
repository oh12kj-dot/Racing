import {createRace as createSpectatorRace} from './race-spectator-intelligence.js';
import {resolvePitRuntimeSpec} from './pit-config.js';
import {createTrajectoryController} from './trajectory-controller.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>v!=null&&v!==''&&Number.isFinite(Number(v));
const smooth01=t=>{t=clamp(Number(t)||0,0,1);return t*t*(3-2*t);};
const PIT_ENTRY_CAPTURE_METERS=18;

export function pitApproachVelocityStep(speed,target,decel,dt=.016){
  const v=Math.max(0,Number(speed)||0),goal=Math.max(0,Number(target)||0),a=Math.max(.1,Number(decel)||.1),step=clamp(Number(dt)||.016,.001,.05);
  if(v<=goal)return v;
  return Math.max(goal,v-a*step);
}

function validExitCar(c){
  if(!c||c.retired||c._runtimeReleaseWait)return false;
  const phase=String(c._runtimePitPhase||'');
  if(c.pitState==='EXIT')return['FAST_LANE_EXIT','PIT_EXIT','MERGE'].includes(phase);
  // pit-state historically flips EXIT -> NONE at the exit-end marker. Reclaim that
  // transition before trajectory control can snap the car onto the normal lane.
  return c.pitState==='NONE'&&phase==='MERGE'&&(c._runtimePitArrival!=null||finite(c._runtimePitMergeStartS));
}

export function pitExitStage(W,c){
  const phase=String(c?._runtimePitPhase||''),pathComplete=!!c&&typeof W?.pitOffsetAtS==='function'&&typeof W?.inPitWindow==='function'&&!W.inPitWindow(c.s);
  // Modern pit geometry already performs the complete 13.6 m -> 0 m merge before
  // the exit-end marker. Do not start the legacy second lateral merge afterwards.
  if(pathComplete&&(c.pitState==='EXIT'||(c.pitState==='NONE'&&phase==='MERGE')))return'PATH_RELEASE';
  if(!validExitCar(c))return'INACTIVE';
  if(phase==='MERGE'||finite(c._runtimePitMergeStartS))return'MERGE';
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

function authoritativePitOffset(W,c,state='EXIT',pose=null){
  const q=pose||W.pitPose?.(c.s,c.teamId,state);
  if(finite(q?.offset))return Number(q.offset);
  const path=Number(W.pitOffsetAtS?.(c.s));if(Number.isFinite(path))return path;
  if(q?.p&&typeof W.sample==='function'){
    const center=W.sample(c.s,0);if(center?.p&&center?.side){
      const dx=q.p.x-center.p.x,dz=q.p.z-center.p.z;
      return dx*center.side.x+dz*center.side.z;
    }
  }
  return null;
}

function syncPitLogicalLane(W,c,state='EXIT',pose=null){
  const offset=authoritativePitOffset(W,c,state,pose);if(!finite(offset))return null;
  c.lane=Number(offset);c.laneTarget=Number(offset);c._runtimePitLogicalOffset=Number(offset);return Number(offset);
}

function poseDrivenMerge(W,c,spec,alpha,distance){
  const start=finite(c._runtimePitMergeStartOffset)?Number(c._runtimePitMergeStartOffset):Number(spec.mergeTrackOffset)||0,target=Number(spec.mergeLaneTarget)||0;
  const offset=start+(target-start)*smooth01(alpha),look=1.2,total=Math.max(1,Number(W.total)||1),nextAlpha=clamp((distance+look)/Math.max(1,Number(spec.mergeBlendMeters)||42),0,1),nextOffset=start+(target-start)*smooth01(nextAlpha);
  c.lane=offset;c.laneTarget=target;c._runtimePitLogicalOffset=offset;
  if(!c.mesh||typeof W.sample!=='function')return;
  const q=W.sample(c.s,offset),q2=W.sample(((Number(c.s)||0)+look)%total,nextOffset);if(!q?.p)return;
  c.mesh.position.copy(q.p);c.mesh.position.y+=.12;
  if(q2?.p){const t=q2.p.clone().sub(q.p);t.y=0;if(t.lengthSq?.()>.0001){t.normalize();c.mesh.rotation.y=Math.atan2(t.x,t.z);return;}}
  if(q.t)c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
}

function advanceDrivenMerge(W,c,spec){
  const total=Math.max(1,Number(W.total)||1),blend=Math.max(8,Number(spec.mergeBlendMeters)||42);
  if(!finite(c._runtimePitMergeStartS)){
    c._runtimePitMergeStartS=Number(c.s)||0;c._runtimePitMergeLastS=Number(c.s)||0;c._runtimePitMergeDistance=0;
    const pathOffset=Number(W.pitOffsetAtS?.(c.s));
    c._runtimePitMergeStartOffset=Number.isFinite(pathOffset)?pathOffset:(finite(c._runtimePitLogicalOffset)?Number(c._runtimePitLogicalOffset):(finite(c.lane)?Number(c.lane):(finite(spec.mergeTrackOffset)?Number(spec.mergeTrackOffset):0)));
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
  if(stage==='PATH_RELEASE'){
    const offset=syncPitLogicalLane(W,c,'EXIT');c._runtimePitPathReleaseOffset=finite(offset)?Number(offset):null;
    c.pitState='NONE';c.pitTimer=0;c._runtimePitPhase='MERGE';c.pitLaneStatus='MERGE';clearMergeState(c);return'PATH_RELEASE';
  }
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
  if(!finite(c._runtimePitEntryLane))c._runtimePitEntryLane=Number(c.lane)||0;
  const entryLane=Number(c._runtimePitEntryLane)||0;
  if(meters>=PIT_ENTRY_CAPTURE_METERS){
    c.mesh.position.copy(pit.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Number(pit.rotationY)||Math.atan2(pit.t?.x||0,pit.t?.z||1);c._runtimePitEntryBlend=1;syncPitLogicalLane(W,c,'ENTRY',pit);return true;
  }
  const alpha=smooth01(meters/PIT_ENTRY_CAPTURE_METERS),pitOffset=authoritativePitOffset(W,c,'ENTRY',pit);
  if(!finite(pitOffset))return false;
  const offset=entryLane+(Number(pitOffset)-entryLane)*alpha,q=W.sample(c.s,offset);if(!q?.p)return false;
  c.lane=offset;c.laneTarget=offset;c._runtimePitLogicalOffset=offset;
  c.mesh.position.copy(q.p);c.mesh.position.y+=.12;
  const track=W.sample(c.s,entryLane),trackYaw=track?.t?Math.atan2(track.t.x,track.t.z):Number(pit.rotationY)||0,pitYaw=Number(pit.rotationY)||trackYaw,tau=Math.PI*2,delta=((pitYaw-trackYaw+Math.PI)%tau+tau)%tau-Math.PI;c.mesh.rotation.y=trackYaw+delta*alpha;c._runtimePitEntryBlend=alpha;return true;
}

export function createRace(W,statusEl,settings={}){
  W.runtimeTrajectoryControl='runtime-trajectory-controller-v3-pooled';
  W.runtimeRacecraftAuthority='runtime-racecraft-v2';
  const R=createSpectatorRace(W,statusEl,settings),baseUpdate=R.update,beforeSpeed=new Float64Array(Math.max(1,R.cars?.length||20));
  const mobile=!!globalThis.matchMedia?.('(pointer:coarse)')?.matches,trajectory=createTrajectoryController(W,R,{mobile});
  let limiterReleases=0,mergeReleases=0,pathReleases=0,updates=0,entrySurfaceFrames=0;

  function preparePitApproach(dt){
    const limit=Number(W.pitSpeedLimit)||22.22,step=clamp(Number(dt)||.016,.001,.05);
    for(const c of R.cars||[]){
      if(c.retired||c.pitState!=='ENTRY'||!W.inPitWindow?.(c.s)||c._runtimePitQueued)continue;
      const dist=Number(W.pitDistanceToBox?.(c.s,c.teamId));if(!Number.isFinite(dist)||dist<-.5)continue;
      const decel=clamp((Number(c._v18BaseBrake)||Number(c.brake)||15)*.52,5.5,9.5),stopMargin=.18,remaining=Math.max(0,dist-stopMargin),target=Math.min(limit,Math.sqrt(Math.max(0,2*decel*remaining))),current=Math.max(0,Number(c.v)||0),brakingDistance=current*current/(2*decel)+stopMargin;
      if(dist<=brakingDistance)c.v=pitApproachVelocityStep(current,target,decel,step);
      c.pitApproachTargetSpeed=target;c.pitApproachDistance=dist;c.pitApproachBrakeDemand=current>target?clamp((current-target)/Math.max(.1,current),0,1):0;
    }
  }

  function update(dt){
    const cars=R.cars||[],trajectoryFrame=trajectory.capture();preparePitApproach(dt);
    for(let i=0;i<cars.length;i++)beforeSpeed[i]=Number(cars[i].v)||0;
    baseUpdate(dt);
    for(let i=0;i<cars.length;i++){
      const c=cars[i],wasReleased=!!c._runtimePitExitLimiterReleased,wasMerging=finite(c._runtimePitMergeStartS)||String(c._runtimePitPhase||'')==='MERGE',stage=advancePitExitAfterLimiter(W,c,dt,beforeSpeed[i],R.race?.t||0);
      if(!wasReleased&&c._runtimePitExitLimiterReleased)limiterReleases++;
      if(stage==='MERGE'&&!wasMerging)mergeReleases++;if(stage==='PATH_RELEASE')pathReleases++;
      if((stage==='LIMITED'||stage==='ACCELERATE')&&c.pitState==='EXIT'&&W.inPitWindow?.(c.s))syncPitLogicalLane(W,c,'EXIT');
      if(enforcePitEntrySurface(W,c))entrySurfaceFrames++;
      if(c.pitState!=='ENTRY'){c._runtimePitEntryLane=null;c._runtimePitEntryBlend=0;}
    }
    trajectory.update(dt,trajectoryFrame);updates++;
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='trajectoryDiagnostics')return trajectory.diagnostics();
    if(prop==='pitExitLimiterDiagnostics')return{owner:'runtime-pit-exit-release-v7-path-release',limiterReleases,mergeReleases,pathReleases,entrySurfaceFrames,updates,snapshotAllocations:1,cars:(R.cars||[]).filter(c=>c._runtimePitExitLimiterReleased).map(c=>({id:c.id,phase:c._runtimePitPhase,pitState:c.pitState,releasedAt:c._runtimePitExitReleasedAt,v:c.v,mergeDistance:c._runtimePitMergeDistance||0,logicalOffset:c._runtimePitLogicalOffset??null,pathReleaseOffset:c._runtimePitPathReleaseOffset??null}))};
    return Reflect.get(target,prop,target);
  }});
}