import {createRace as createLegacyRace} from '../v42-race.js';
import {LOG_POLICY} from './config.js';
import {createPitStateMachine} from './pit-state.js';
import {createBarrierSafety} from './barrier-safety.js';

export function createRace(W,statusEl,settings={}){
  // Stable runtime owns pit movement/service state. Legacy providers may still
  // decide strategy/admission, but their v41 box-motion layer is disabled while
  // updating so there is exactly one movement state machine.
  W.runtimePitStateMachineOwner='runtime-v1';
  const R=createLegacyRace(W,statusEl,settings),baseUpdate=R.update;
  const generation={id:`run-${Date.now().toString(36)}`,startedAt:Date.now(),persistent:true,maxGenerations:LOG_POLICY.persistedGenerations};
  const pit=createPitStateMachine(W,R),barrierSafety=createBarrierSafety(W,R);

  function update(dt){
    const eventStart=Array.isArray(R.events)?R.events.length:0,snapshot=pit.beforeUpdate(dt);
    // v41 managePit() exits immediately when pitDistanceToBox is absent. Hide it
    // only for the legacy update call; restore it before the stable controller
    // performs its deterministic post-update transitions.
    const pitDistanceToBox=W.pitDistanceToBox;
    W.pitDistanceToBox=null;
    try{baseUpdate(dt);}finally{W.pitDistanceToBox=pitDistanceToBox;}
    pit.afterUpdate(dt,snapshot,eventStart);
    barrierSafety.update();
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='logGeneration')return generation;
    if(prop==='pitStateDiagnostics')return pit.diagnostics();
    if(prop==='barrierSafetyDiagnostics')return barrierSafety.diagnostics();
    if(prop==='runtimeSafety')return{pit:pit.diagnostics(),barrier:barrierSafety.diagnostics()};
    return Reflect.get(target,prop,target);
  }});
}
