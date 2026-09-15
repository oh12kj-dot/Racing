import {createRace as createLegacyRace} from '../v41-race.js';
import {LOG_POLICY} from './config.js';
import {createPitStateMachine} from './pit-state.js';
import {createBarrierSafety} from './barrier-safety.js';
import {createRadioVariety} from './radio-variety.js';

export function createRace(W,statusEl,settings={}){
  // Stable runtime owns pit movement/service state, barrier material post-processing
  // and diagnostic retention. v41 remains the mature physics/AI provider.
  W.runtimePitStateMachineOwner='runtime-v1';
  const R=createLegacyRace(W,statusEl,settings),baseUpdate=R.update;
  const generation={id:`run-${Date.now().toString(36)}`,startedAt:Date.now(),persistent:true,maxGenerations:LOG_POLICY.persistedGenerations};
  const pit=createPitStateMachine(W,R),barrierSafety=createBarrierSafety(W,R),radioVariety=createRadioVariety(R),prevDamage=[],seenBarrier=new Set();
  const trim=(arr,max)=>{if(Array.isArray(arr)&&arr.length>max)arr.splice(0,arr.length-max);};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const bandDamage=kmh=>kmh<15?.018:kmh<38?.055:kmh<72?.15:kmh<115?.32:kmh<160?.55:.88;
  const barrierKey=x=>`${x.t}:${x.carId}:${Math.round(x.impactKmh||0)}:${x.zone||''}`;
  const workingPhases=new Set(['WORKING_APPROACH','QUEUE','SERVICE','RELEASE_WAIT','WORKING_EXIT']);
  const trafficIsolation={lastFast:0,lastWorking:0,preEntryCorrections:0};
  let presentedCars=new Set();
  const pitPresentation={owner:'runtime-pit-presentation-v1',activeCars:0,activeTeams:0,resets:0,completedCycles:0,lastDetails:[]};
  function enforceRetention(){trim(R.events,LOG_POLICY.events);trim(R.radio,LOG_POLICY.radio);trim(R.dynamicsTelemetry,LOG_POLICY.dynamicsSamples);trim(R.physicalCrashHistory,LOG_POLICY.crashHistory);}
  function clearDiagnostics(){if(Array.isArray(R.dynamicsTelemetry))R.dynamicsTelemetry.length=0;if(Array.isArray(R.physicalCrashHistory))R.physicalCrashHistory.length=0;}
  function applyBarrierMaterials(){
    const h=R.physicalCrashHistory||[];
    for(const x of h){
      if(x?.type!=='BARRIER')continue;const k=barrierKey(x);if(seenBarrier.has(k))continue;seenBarrier.add(k);
      const c=R.cars[x.carId];if(!c)continue;const material=W.barrierMaterialAt?.(c.s)||'GUARDRAIL';x.material=material;
      if(material==='TYRE'&&!c.retired){
        const refund=bandDamage(x.impactKmh||0)*.32,newDamage=Math.max(prevDamage[c.id]||0,(c.damage||0)-refund);c.damage=newDamage;
        const z=c.damageZones;if(z&&x.zone&&z[x.zone]!=null)z[x.zone]=Math.max(0,z[x.zone]-refund*1.1);
        if(z?.suspension!=null&&['left','right'].includes(x.zone))z.suspension=Math.max(0,z.suspension-refund*.35);
        W.updateCarDamage?.(c);
      }
    }
    if(seenBarrier.size>140){const live=new Set(h.filter(x=>x?.type==='BARRIER').map(barrierKey));for(const k of seenBarrier)if(!live.has(k))seenBarrier.delete(k);}
  }

  // Presentation is synchronized after runtime/pit-state has finalized the frame.
  // Legacy race layers can still call historical crew helpers during baseUpdate(),
  // but this authoritative pass always wins. Once STOP -> EXIT happens, the crew
  // gets an empty detail set and the serviced car's temporary wheel pose is reset.
  function syncPitPresentation(dt){
    const details=[],activeTeams=new Set(),nextCars=new Set();
    for(const c of R.cars){
      const active=!c.retired&&c.pitState==='STOP'&&c._runtimePitPhase==='SERVICE';
      if(active){
        const initial=Math.max(.001,Number(c._pitStopInitial)||Number(c.pitTimer)||.001),left=clamp(Number(c.pitTimer)||0,0,initial),progress=clamp(1-left/initial,0,1);
        const phase=progress<.16?'ARRIVE':progress<.34?'JACKS':progress<.70?'TYRES':progress<.86?'DROP':'CLEAR';
        details.push({teamId:c.teamId??0,carId:c.id,progress,phase});activeTeams.add(c.teamId??0);nextCars.add(c.id);W.animatePitStopCar?.(c,progress);
      }else if(presentedCars.has(c.id)){
        W.resetPitStopCar?.(c);pitPresentation.resets++;
        if(c.pitState!=='STOP')pitPresentation.completedCycles++;
      }
    }
    W.updateDetailedPitCrews?.(details,Math.max(0,Number(dt)||0));
    W.updatePitCrews?.(activeTeams,Math.max(0,Number(dt)||0));
    presentedCars=nextCars;pitPresentation.activeCars=nextCars.size;pitPresentation.activeTeams=activeTeams.size;pitPresentation.lastDetails=details.map(x=>({...x}));
  }

  // The mature race core still models every car in the circuit's narrow logical
  // lane coordinates. Pit cars are visually placed on separate fast/working
  // lanes later by runtime/pit-state, so without this compatibility isolation a
  // stopped working-lane car is treated as being directly in front of a passing
  // fast-lane car. Give pit traffic temporary logical lanes only while the old
  // AI/physics update runs. Real lane values are restored before final posing.
  function isolatePitTraffic(){
    const saved=[];let fast=0,working=0;
    for(const c of R.cars){
      if(c.retired||c.pitState==='NONE'||!W.inPitWindow?.(c.s))continue;
      const phase=c._runtimePitPhase||'';
      const isWorking=c.pitState==='STOP'||c._runtimePitQueued||c._runtimeReleaseWait||workingPhases.has(phase);
      saved.push({c,lane:c.lane,laneTarget:c.laneTarget});
      const virtualLane=isWorking?14:8;
      c.lane=virtualLane;c.laneTarget=virtualLane;
      if(isWorking)working++;else fast++;
    }
    trafficIsolation.lastFast=fast;trafficIsolation.lastWorking=working;
    return saved;
  }
  function restorePitTraffic(saved){for(const x of saved){x.c.lane=x.lane;x.c.laneTarget=x.laneTarget;}}

  // A pit call can be made well before the physical pit entry. pit-state must not
  // visually snap that car to the pit offset until it actually reaches the entry
  // window; on-track laneTarget changes are allowed to move it over progressively.
  function restorePreEntryTrackVisual(){
    for(const c of R.cars){
      if(c.retired||c.pitState!=='ENTRY'||W.inPitWindow?.(c.s)||!c.mesh)continue;
      const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);trafficIsolation.preEntryCorrections++;
    }
  }
  enforceRetention();

  function update(dt){
    const eventStart=Array.isArray(R.events)?R.events.length:0,snapshot=pit.beforeUpdate(dt),isolated=isolatePitTraffic();
    for(const c of R.cars)prevDamage[c.id]=c.damage||0;
    // v41 managePit() exits immediately when pitDistanceToBox is absent. Hide it
    // only for the compatibility update; runtime/pit-state owns final pit motion.
    const pitDistanceToBox=W.pitDistanceToBox;W.pitDistanceToBox=null;
    try{baseUpdate(dt);}finally{W.pitDistanceToBox=pitDistanceToBox;restorePitTraffic(isolated);}
    applyBarrierMaterials();
    pit.afterUpdate(dt,snapshot,eventStart);syncPitPresentation(dt);restorePreEntryTrackVisual();barrierSafety.update();radioVariety.update();enforceRetention();
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='logPolicy')return LOG_POLICY;
    if(prop==='logGeneration')return generation;
    if(prop==='clearDiagnostics')return clearDiagnostics;
    if(prop==='pitStateDiagnostics')return pit.diagnostics();
    if(prop==='pitPresentationDiagnostics')return{...pitPresentation,lastDetails:pitPresentation.lastDetails.map(x=>({...x}))};
    if(prop==='pitTrafficIsolation')return{...trafficIsolation};
    if(prop==='barrierSafetyDiagnostics')return barrierSafety.diagnostics();
    if(prop==='barrierSafetyController')return barrierSafety;
    if(prop==='radioVarietyDiagnostics')return radioVariety.diagnostics();
    if(prop==='runtimeSafety')return{pit:pit.diagnostics(),pitPresentation:{...pitPresentation},barrier:barrierSafety.diagnostics(),pitTraffic:{...trafficIsolation}};
    return Reflect.get(target,prop,target);
  }});
}
