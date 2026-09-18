import {createRace as createDriverRace} from './race-driver-dynamics.js';
import {DRIVER_INCIDENT_POLICY,fullSpinShare,incidentMeanSeconds,incidentMinSpacingSeconds} from './driver-incident-policy.js';

export function createRace(W,statusEl,settings={}){
  const R=createDriverRace(W,statusEl,settings),baseUpdate=R.update;
  const gate={nextLockupAt:NaN,nextSpinAt:NaN};
  const diagnostics={owner:'driver-incident-calibration-v1',minorErrors:0,lockups:0,halfSpins:0,fullSpins:0,suppressedLockups:0,suppressedSpins:0,last:[]};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const now=()=>Number(R.race?.t)||0;
  const wetness=()=>clamp(Number(W.env?.wetness)||0,0,1);

  function sampleDelay(kind,wet){
    const mean=incidentMeanSeconds(kind,wet),minimum=incidentMinSpacingSeconds(kind,wet),tail=Math.max(1,mean-minimum),u=clamp(Math.random(),1e-9,1-1e-9);
    return minimum-Math.log(1-u)*tail;
  }
  function gateReady(kind,wet,t){
    const key=kind==='LOCKUP'?'nextLockupAt':'nextSpinAt';
    if(!Number.isFinite(gate[key])){gate[key]=t+sampleDelay(kind,wet);return false;}
    if(t<gate[key])return false;
    gate[key]=t+sampleDelay(kind,wet);return true;
  }
  function newItemsStart(a,previousTailId){
    if(!Array.isArray(a)||!a.length)return 0;
    if(previousTailId==null)return 0;
    for(let i=a.length-1;i>=0;i--)if(a[i]?.id===previousTailId)return i+1;
    return Math.max(0,a.length-8);
  }
  function removeNewEvent(type,carId,previousTailId){
    const a=R.events;if(!Array.isArray(a))return;const start=newItemsStart(a,previousTailId);
    for(let i=a.length-1;i>=start;i--){const e=a[i];if(e?.carId===carId&&e?.type===type)a.splice(i,1);}
  }
  function annotateNewEvent(type,carId,previousTailId,classification){
    const a=R.events;if(!Array.isArray(a))return;const start=newItemsStart(a,previousTailId);
    for(let i=a.length-1;i>=start;i--){const e=a[i];if(e?.carId!==carId||e?.type!==type)continue;e.data={...(e.data||{}),calibrated:true,classification};return;}
  }
  function removeSpinRadio(carId,previousTailId){
    const a=R.radio;if(!Array.isArray(a))return;const start=newItemsStart(a,previousTailId);
    for(let i=a.length-1;i>=start;i--){const m=a[i],text=String(m?.text||'').toLowerCase();if(m?.carId===carId&&text.includes('lost the rear'))a.splice(i,1);}
  }
  function record(c,kind,data={}){
    diagnostics.last.push({t:now(),carId:c.id,kind,...data});
    while(diagnostics.last.length>30)diagnostics.last.shift();
  }
  function suppressLockup(c,eventTailId){
    const sev=clamp(Number(c.spinSeverity)||0,.2,1);
    c.spinState='NONE';c.spinTimer=0;c.slipAngle=(Number(c.slipAngle)||0)*.18;c.counterSteer=0;c.spinSeverity=Math.min(sev,.45);
    c.v=Math.max(0,(Number(c.v)||0)-(.04+.06*sev));
    c.driverErrorClass='MINOR_BRAKE_ERROR';c._driverMinorErrorUntil=now()+.18;diagnostics.minorErrors++;diagnostics.suppressedLockups++;
    removeNewEvent('LOCKUP',c.id,eventTailId);record(c,'MINOR_BRAKE_ERROR',{severity:sev});
  }
  function suppressSpin(c,eventTailId,radioTailId){
    const sev=clamp(Number(c.spinSeverity)||.5,.2,1),dir=Math.sign(c._spinDir||1);
    c.spinState='RECOVER';c.spinTimer=.24+.16*sev;c.slipAngle=clamp((Number(c.slipAngle)||0)*.35,-.22,.22);c.counterSteer=-Math.sign(c.slipAngle)*Math.min(.35,Math.abs(c.slipAngle));
    c.laneTarget=clamp((Number(c.laneTarget)||0)+dir*(.10+.16*sev),-4.1,4.1);c.v=Math.max(0,(Number(c.v)||0)*(.992-.006*sev));
    c.driverErrorClass='RUN_WIDE';diagnostics.suppressedSpins++;
    removeNewEvent('SPIN',c.id,eventTailId);removeSpinRadio(c.id,radioTailId);record(c,'RUN_WIDE',{severity:sev});
  }
  function acceptSpin(c,wet,eventTailId){
    const sev=clamp(Number(c.spinSeverity)||.5,.2,1),baseline=fullSpinShare(wet),severityBias=(sev-.70)*.55,full=Math.random()<clamp(baseline+severityBias,.28,.82);
    if(full){
      c.spinSeverity=Math.max(sev,DRIVER_INCIDENT_POLICY.fullSpinSeverity+.02);c.driverErrorClass='FULL_SPIN';diagnostics.fullSpins++;annotateNewEvent('SPIN',c.id,eventTailId,'FULL_SPIN');record(c,'FULL_SPIN',{severity:c.spinSeverity,wet});
    }else{
      c.spinSeverity=Math.min(sev,DRIVER_INCIDENT_POLICY.halfSpinSeverityCap);c.spinTimer=Math.min(Number(c.spinTimer)||.9,.88);c.driverErrorClass='HALF_SPIN';diagnostics.halfSpins++;annotateNewEvent('SPIN',c.id,eventTailId,'HALF_SPIN');record(c,'HALF_SPIN',{severity:c.spinSeverity,wet});
    }
  }
  function calibrate(c,before,eventTailId,radioTailId){
    if(!c||c.retired||c.pitState!=='NONE')return;
    const current=c.spinState,previous=before?.spinState||'NONE',wet=wetness(),t=now();
    if(c.driverErrorClass==='MINOR_BRAKE_ERROR'&&t>=(Number(c._driverMinorErrorUntil)||0))c.driverErrorClass='NONE';
    if(current==='LOCKUP'&&previous!=='LOCKUP'){
      if(!gateReady('LOCKUP',wet,t)){suppressLockup(c,eventTailId);return;}
      c.driverErrorClass='LOCKUP';diagnostics.lockups++;annotateNewEvent('LOCKUP',c.id,eventTailId,'LOCKUP');record(c,'LOCKUP',{severity:clamp(Number(c.spinSeverity)||0,0,1),wet});
      return;
    }
    if(current==='SLIDE'&&previous!=='SLIDE'){
      if(!gateReady('SPIN',wet,t)){suppressSpin(c,eventTailId,radioTailId);return;}
      acceptSpin(c,wet,eventTailId);
    }
    if(current==='NONE'&&previous!=='NONE'&&c.driverErrorClass)c.driverErrorClass='NONE';
  }
  function update(dt){
    const before=R.cars.map(c=>({spinState:c.spinState})),eventTailId=R.events?.[R.events.length-1]?.id??null,radioTailId=R.radio?.[R.radio.length-1]?.id??null;
    baseUpdate(dt);
    for(let i=0;i<R.cars.length;i++)calibrate(R.cars[i],before[i],eventTailId,radioTailId);
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='driverIncidentPolicy')return DRIVER_INCIDENT_POLICY;
    if(prop==='driverIncidentDiagnostics')return{...diagnostics,last:diagnostics.last.map(x=>({...x}))};
    return Reflect.get(target,prop,target);
  }});
}
