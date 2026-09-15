import {createRace as createSpectatorRace} from './race-spectator-intelligence.js';
import {resolvePitRuntimeSpec} from './pit-config.js';
import {createTrajectoryController} from './trajectory-controller.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>Number.isFinite(Number(v));

function validExitCar(c){
  if(!c||c.retired||c.pitState!=='EXIT'||c._runtimeReleaseWait)return false;
  const phase=String(c._runtimePitPhase||'');
  return ['FAST_LANE_EXIT','PIT_EXIT'].includes(phase);
}

export function pitExitStage(W,c){
  if(!validExitCar(c))return'INACTIVE';
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
  const spec=resolvePitRuntimeSpec(W);
  c.pitState='NONE';c.pitTimer=0;c._runtimePitPhase='MERGE';c.pitLaneStatus='MERGE';
  if(finite(spec.mergeTrackOffset))c.lane=Number(spec.mergeTrackOffset);
  if(finite(spec.mergeLaneTarget))c.laneTarget=Number(spec.mergeLaneTarget);
  return'MERGE';
}

export function createRace(W,statusEl,settings={}){
  const R=createSpectatorRace(W,statusEl,settings),baseUpdate=R.update;
  const mobile=!!globalThis.matchMedia?.('(pointer:coarse)')?.matches;
  const trajectory=createTrajectoryController(W,R,{mobile});
  let limiterReleases=0,mergeReleases=0;

  function preparePitApproach(dt){
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
    const trajectoryFrame=trajectory.capture();preparePitApproach(dt);
    const before=new Map((R.cars||[]).map(c=>[c.id,Number(c.v)||0]));
    baseUpdate(dt);
    for(const c of R.cars||[]){
      const wasReleased=!!c._runtimePitExitLimiterReleased,stage=advancePitExitAfterLimiter(W,c,dt,before.get(c.id),R.race?.t||0);
      if(!wasReleased&&c._runtimePitExitLimiterReleased)limiterReleases++;
      if(stage==='MERGE')mergeReleases++;
    }
    // Final authority for on-track lateral motion. All legacy racecraft layers may
    // propose a laneTarget, but only this controller turns that request into a
    // steering-rate/lat-accel-limited trajectory and final vehicle pose.
    trajectory.update(dt,trajectoryFrame);
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='trajectoryDiagnostics')return trajectory.diagnostics();
    if(prop==='pitExitLimiterDiagnostics')return{owner:'runtime-pit-exit-release-v3',limiterReleases,mergeReleases,cars:(R.cars||[]).filter(c=>c._runtimePitExitLimiterReleased).map(c=>({id:c.id,phase:c._runtimePitPhase,pitState:c.pitState,releasedAt:c._runtimePitExitReleasedAt,v:c.v}))};
    return Reflect.get(target,prop,target);
  }});
}
