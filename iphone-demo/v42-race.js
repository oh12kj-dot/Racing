import {createRace as createV41Race} from './v41-race-final.js';
import {LOG_POLICY} from './v42-config.js';

export function createRace(W,statusEl,settings={}){
  const R=createV41Race(W,statusEl,settings),baseUpdate=R.update;
  const generation={id:`run-${Date.now().toString(36)}`,startedAt:Date.now(),persistent:false};
  const trim=(arr,max)=>{if(Array.isArray(arr)&&arr.length>max)arr.splice(0,arr.length-max);};
  function enforceRetention(){
    trim(R.events,LOG_POLICY.events);
    trim(R.radio,LOG_POLICY.radio);
    trim(R.dynamicsTelemetry,LOG_POLICY.dynamicsSamples);
    trim(R.physicalCrashHistory,LOG_POLICY.crashHistory);
  }
  function update(dt){baseUpdate(dt);enforceRetention();}
  function clearDiagnostics(){
    if(Array.isArray(R.dynamicsTelemetry))R.dynamicsTelemetry.length=0;
    if(Array.isArray(R.physicalCrashHistory))R.physicalCrashHistory.length=0;
  }
  enforceRetention();
  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='logPolicy')return LOG_POLICY;
    if(prop==='logGeneration')return generation;
    if(prop==='clearDiagnostics')return clearDiagnostics;
    return Reflect.get(target,prop,target);
  }});
}
