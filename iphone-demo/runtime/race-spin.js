import {createRace as createV30Race} from './race-pit-strategy.js';

export function createRace(W,statusEl,settings={}){
  const R=createV30Race(W,statusEl,settings),baseUpdate=R.update;
  const spinLoss=new Map();
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function preSpinLimit(c){
    const s=spinLoss.get(c.id);if(!s)return;
    if(c.spinState==='SLIDE')c.v=Math.min(c.v,s.speed);
    else if(c.spinState==='RECOVER')c.v=Math.min(c.v,s.recoverCap);
  }
  function beginLoss(c){
    const sev=clamp(Number(c.spinSeverity)||.5,.2,1),entry=Math.max(0,c.v||0);
    const immediate=entry*(.80-sev*.18);
    const s={severity:sev,entry,speed:Math.max(5,immediate),recoverCap:Math.max(10,entry*(.38+sev*.08)),startedAt:R.race.t,lastState:'SLIDE'};
    spinLoss.set(c.id,s);c.v=Math.min(c.v,s.speed);
    c.throttle=0;c.overtake=0;c.avoid=Math.max(c.avoid||0,1.6);
    return s;
  }
  function enforceSpin(c,dt,beforeState){
    if(c.retired||c.pitState!=='NONE'){spinLoss.delete(c.id);return;}
    let s=spinLoss.get(c.id);
    if(c.spinState==='SLIDE'&&!s)s=beginLoss(c);
    if(!s)return;
    if(c.spinState==='SLIDE'){
      const off=Math.max(0,Math.abs(c.lane||0)-3.1),drag=12+18*s.severity+off*5.5;
      s.speed=Math.max(2.5,s.speed-drag*dt);
      c.v=Math.min(c.v,s.speed);c.overtake=0;c.drsActive=false;c.drsEligible=false;
      c.hazardAvoiding=true;
      if(c.v<12)c.laneTarget=clamp((c.laneTarget||0)+Math.sign(c.lane||c._spinDir||1)*dt*.35,-4.0,4.0);
    }else if(c.spinState==='RECOVER'){
      if(s.lastState==='SLIDE')s.recoverCap=Math.max(9,Math.min(s.recoverCap,s.speed+5));
      s.recoverCap=Math.min(Math.max(18,s.entry*.58),s.recoverCap+5.2*dt);
      c.v=Math.min(c.v,s.recoverCap);c.overtake=0;c.drsActive=false;c.drsEligible=false;
    }else if(c.spinState==='NONE'){
      // Keep a short acceleration penalty after the car points straight again, so a spin
      // costs real track position instead of instantly returning to race pace.
      if(R.race.t-s.startedAt<2.2){s.recoverCap=Math.min(Math.max(24,s.entry*.72),s.recoverCap+7*dt);c.v=Math.min(c.v,s.recoverCap);}else spinLoss.delete(c.id);
    }
    s.lastState=c.spinState;
  }

  function update(dt){
    for(const c of R.cars)preSpinLimit(c);
    const before=R.cars.map(c=>c.spinState);
    baseUpdate(dt);
    for(let i=0;i<R.cars.length;i++)enforceSpin(R.cars[i],dt,before[i]);
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='spinLoss')return[...spinLoss].map(([carId,s])=>({carId,...s}));
    return Reflect.get(target,prop,target);
  }});
}
