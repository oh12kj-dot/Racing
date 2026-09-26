import {createRace as createV18Race} from './v18-race.js';
import {VEHICLE_CLASSES,legacyPerformanceTuple,longitudinalPerformance,performanceFor} from './vehicle-performance-spec.js';

export function createRace(W,statusEl,settings={}){
  const R=createV18Race(W,statusEl,settings),baseUpdate=R.update,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),total=W.total,wrap=v=>((v%total)+total)%total;
  const perf=Object.fromEntries(VEHICLE_CLASSES.map(type=>[type,legacyPerformanceTuple(type)]));
  for(const c of R.cars){const p=performanceFor(c.type);c.classPerformance={...p,massKg:p.mass};c.massKg=p.mass;c.paceIndex=p.paceIndex;c.baseMaxNominal=p.top;c.accelNominal=p.accel;c.brakeNominal=p.brake;}
  if(Array.isArray(R.qualifying)&&R.qualifying.length){for(const q of R.qualifying){const c=R.cars[q.carId],p=performanceFor(c?.type);q.time=q.time/p.paceIndex;}R.qualifying.sort((a,b)=>a.time-b.time);if(R.sessionPhase==='QUALIFYING')R.qualifying.forEach((q,pos)=>{const c=R.cars[q.carId],row=Math.floor(pos/2),col=pos%2;c._v8Progress=-row*12.4;c.s=wrap(-row*12.4);c.lap=row===0?0:-1;c.position=pos+1;c.prevPosition=pos+1;c.lane=(col?-1:1)*2.55+(row%2?.14:-.14);c.laneTarget=c.lane;c.v=0;const s=W.sample(c.s,c.lane);c.mesh.position.copy(s.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(s.t.x,s.t.z);});}
  function tune(c){
    const p=performanceFor(c.type),longitudinal=longitudinalPerformance(c.type,c.v||0),m=c.machine||{},load=clamp(W.braking?.(c.s)||0,0,1),wet=clamp(W.env?.wetness||0,0,1),wetScale=1-(1-p.wet)*wet,power=clamp(Number(m.power)||1,.90,1.10),aero=clamp(Number(m.aero)||1,.90,1.10),brake=clamp(Number(m.brake)||1,.90,1.10);
    const baseCoreMax=Math.max(1,Number(c._v15BaseCoreMax)||p.top),baseCoreAccel=Math.max(1,Number(c._v15BaseCoreAccel)||longitudinal.accel),baseCoreBrake=Math.max(1,Number(c._v15BaseCoreBrake)||longitudinal.brake),conditionMax=clamp((Number(c._v10CoreMax)||baseCoreMax)/baseCoreMax,.72,1.03),conditionAccel=clamp((Number(c._v10CoreAccel)||baseCoreAccel)/baseCoreAccel,.72,1.03),conditionBrake=clamp((Number(c._v10CoreBrake)||baseCoreBrake)/baseCoreBrake,.72,1.03);
    c.classPerformance={...p,massKg:p.mass};c.massKg=p.mass;c.paceIndex=p.paceIndex;c.baseMaxNominal=p.top;c.accelNominal=longitudinal.accel;c.brakeNominal=longitudinal.brake;
    c._v18BaseMax=p.top*Math.pow(power,.28)*(.985+.015*aero)*wetScale*conditionMax;
    c._v18BaseAccel=longitudinal.accel*power*conditionAccel*(1-load*.10*(c.type==='formula'?.35:1));
    c._v18BaseBrake=longitudinal.brake*brake*conditionBrake;
  }
  function update(dt){for(const c of R.cars)tune(c);baseUpdate(dt);}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='classPerformance')return perf;if(prop==='classPerformanceSpec')return VEHICLE_CLASSES.reduce((o,type)=>(o[type]=performanceFor(type),o),{});return Reflect.get(target,prop,target);}});
}
