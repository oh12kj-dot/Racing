import {createRace as createStableRace} from './race.js';
import {VEHICLE_CLASSES,longitudinalPerformance,performanceFor} from './vehicle-performance-spec.js';

export function createRace(W,statusEl,settings={}){
  const R=createStableRace(W,statusEl,settings),baseUpdate=R.update,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // This layer is only a final kinematic guardrail. Corner speed is owned by the
  // curvature/lateral-G model in race-base, so an old second corner model cannot
  // silently flatten the differences defined by the central class specification.
  const limits=Object.fromEntries(VEHICLE_CLASSES.map(type=>{const p=performanceFor(type);return[type,{top:p.top,accel:p.accel,brake:p.brake,lateralG:p.lateralG}];}));
  const diagnostics={owner:'runtime-kinematic-envelope-v3-speed-band',revision:'v3-central-performance',corrections:0,lastMaxDelta:0,snapshotAllocations:1},before=new Float64Array(Math.max(1,R.cars.length));

  function envelope(c,previous,dt){
    if(!c||c.retired||!Number.isFinite(c.v)||!Number.isFinite(previous))return;
    const p=performanceFor(c.type),longitudinal=longitudinalPerformance(c.type,previous),wet=clamp(Number(W.env?.wetness)||0,0,1),classTop=Number(c.classPerformance?.top),machinePower=clamp(Number(c.machine?.power)||1,.90,1.08),nominalTop=Number.isFinite(classTop)?classTop:p.top,top=nominalTop*Math.pow(machinePower,.28)*(1-wet*.045);
    let desired=top;if(c.pitState!=='NONE'&&W.inPitSpeedZone?.(c.s))desired=Math.min(desired,(Number(W.pitSpeedLimit)||22.22)*1.015);
    // Preserve per-car calibration but scale it by the central speed-dependent
    // acceleration band. The former code preferred _v18BaseAccel whenever it was
    // present, which bypassed accelBand entirely and let high-speed acceleration
    // remain almost as strong as low-speed acceleration.
    const nominalAccel=Math.max(2.5,Number(c._v18BaseAccel)||p.accel),accelBandScale=longitudinal.accel/Math.max(1,p.accel),accel=Math.max(.5,nominalAccel*accelBandScale),brake=Math.max(7,Number(c._v18BaseBrake)||longitudinal.brake),physicalUpper=previous>desired?Math.max(desired,previous-brake*dt):Math.min(desired,previous+accel*dt),upper=Math.max(0,Math.min(top,physicalUpper));
    if(c.v>upper+.001){diagnostics.corrections++;diagnostics.lastMaxDelta=Math.max(diagnostics.lastMaxDelta*.98,c.v-upper);c.v=upper;}
  }

  function update(dt){
    const step=clamp(Number(dt)||.016,.001,.05);for(let i=0;i<R.cars.length;i++)before[i]=Number(R.cars[i].v)||0;baseUpdate(dt);if(R.replay)return;for(let i=0;i<R.cars.length;i++)envelope(R.cars[i],before[i],step);
  }

  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='kinematicPolicy')return{...diagnostics,limits};return Reflect.get(target,prop,target);}});
}
