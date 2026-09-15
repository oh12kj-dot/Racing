import {createRace as createSpectatorRace} from './race-spectator-intelligence.js';
import {resolvePitRuntimeSpec} from './pit-config.js';

const finite=v=>Number.isFinite(Number(v));

export function shouldReleasePitExitLimiter(W,c){
  if(!c||c.retired||c.pitState!=='EXIT'||c._runtimeReleaseWait)return false;
  const phase=String(c._runtimePitPhase||'');
  if(!['FAST_LANE_EXIT','PIT_EXIT'].includes(phase))return false;
  if(typeof W?.inPitSpeedZone==='function')return !W.inPitSpeedZone(c.s);
  if(typeof W?.pitUnwrappedFraction==='function'){
    const uf=Number(W.pitUnwrappedFraction(c.s)),spec=resolvePitRuntimeSpec(W);
    return Number.isFinite(uf)&&uf>=spec.exitEndUF;
  }
  return false;
}

export function releasePitExitLimiter(W,c,raceTime=0){
  if(!shouldReleasePitExitLimiter(W,c))return false;
  const spec=resolvePitRuntimeSpec(W);
  c.pitState='NONE';
  c.pitTimer=0;
  c._runtimePitPhase='MERGE';
  c.pitLaneStatus='MERGE';
  c._runtimePitExitLimiterReleased=true;
  c._runtimePitExitReleasedAt=Number(raceTime)||0;
  if(finite(spec.mergeTrackOffset))c.lane=Number(spec.mergeTrackOffset);
  if(finite(spec.mergeLaneTarget))c.laneTarget=Number(spec.mergeLaneTarget);
  return true;
}

export function createRace(W,statusEl,settings={}){
  const R=createSpectatorRace(W,statusEl,settings),baseUpdate=R.update;
  let releases=0;

  function update(dt){
    baseUpdate(dt);
    for(const c of R.cars||[]){
      if(releasePitExitLimiter(W,c,R.race?.t||0))releases++;
    }
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='pitExitLimiterDiagnostics')return{owner:'runtime-pit-exit-release-v1',releases,cars:(R.cars||[]).filter(c=>c._runtimePitExitLimiterReleased).map(c=>({id:c.id,phase:c._runtimePitPhase,pitState:c.pitState,releasedAt:c._runtimePitExitReleasedAt,v:c.v}))};
    return Reflect.get(target,prop,target);
  }});
}
