import {createRace as createSpectatorRace} from './race-spectator-intelligence.js';
import {resolvePitRuntimeSpec} from './pit-config.js';

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
  let limiterReleases=0,mergeReleases=0;

  function update(dt){
    const before=new Map((R.cars||[]).map(c=>[c.id,Number(c.v)||0]));
    baseUpdate(dt);
    for(const c of R.cars||[]){
      const wasReleased=!!c._runtimePitExitLimiterReleased,stage=advancePitExitAfterLimiter(W,c,dt,before.get(c.id),R.race?.t||0);
      if(!wasReleased&&c._runtimePitExitLimiterReleased)limiterReleases++;
      if(stage==='MERGE')mergeReleases++;
    }
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='pitExitLimiterDiagnostics')return{owner:'runtime-pit-exit-release-v2',limiterReleases,mergeReleases,cars:(R.cars||[]).filter(c=>c._runtimePitExitLimiterReleased).map(c=>({id:c.id,phase:c._runtimePitPhase,pitState:c.pitState,releasedAt:c._runtimePitExitReleasedAt,v:c.v}))};
    return Reflect.get(target,prop,target);
  }});
}
