import {createRace as createLegacyRace} from '../v41-race-final.js';
import {LOG_POLICY} from './config.js';
import {createPitStateMachine} from './pit-state.js';
import {createBarrierSafety} from './barrier-safety.js';

export function createRace(W,statusEl,settings={}){
  // Stable runtime owns pit movement/service state and v42-era diagnostic retention.
  // The remaining historical race provider starts at v41 and supplies mature race physics/AI.
  W.runtimePitStateMachineOwner='runtime-v1';
  const R=createLegacyRace(W,statusEl,settings),baseUpdate=R.update;
  const generation={id:`run-${Date.now().toString(36)}`,startedAt:Date.now(),persistent:true,maxGenerations:LOG_POLICY.persistedGenerations};
  const pit=createPitStateMachine(W,R),barrierSafety=createBarrierSafety(W,R);
  const trim=(arr,max)=>{if(Array.isArray(arr)&&arr.length>max)arr.splice(0,arr.length-max);};
  function enforceRetention(){trim(R.events,LOG_POLICY.events);trim(R.radio,LOG_POLICY.radio);trim(R.dynamicsTelemetry,LOG_POLICY.dynamicsSamples);trim(R.physicalCrashHistory,LOG_POLICY.crashHistory);}
  function clearDiagnostics(){if(Array.isArray(R.dynamicsTelemetry))R.dynamicsTelemetry.length=0;if(Array.isArray(R.physicalCrashHistory))R.physicalCrashHistory.length=0;}
  enforceRetention();

  function update(dt){
    const eventStart=Array.isArray(R.events)?R.events.length:0,snapshot=pit.beforeUpdate(dt);
    // v41 managePit() exits immediately when pitDistanceToBox is absent. Hide it
    // only for the legacy update call; restore it before the stable controller
    // performs its deterministic post-update transitions.
    const pitDistanceToBox=W.pitDistanceToBox;W.pitDistanceToBox=null;
    try{baseUpdate(dt);}finally{W.pitDistanceToBox=pitDistanceToBox;}
    pit.afterUpdate(dt,snapshot,eventStart);barrierSafety.update();enforceRetention();
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='logPolicy')return LOG_POLICY;
    if(prop==='logGeneration')return generation;
    if(prop==='clearDiagnostics')return clearDiagnostics;
    if(prop==='pitStateDiagnostics')return pit.diagnostics();
    if(prop==='barrierSafetyDiagnostics')return barrierSafety.diagnostics();
    if(prop==='barrierSafetyController')return barrierSafety;
    if(prop==='runtimeSafety')return{pit:pit.diagnostics(),barrier:barrierSafety.diagnostics()};
    return Reflect.get(target,prop,target);
  }});
}
