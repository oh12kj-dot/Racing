import {createRace as createStableRace} from './race.js';

export function createRace(W,statusEl,settings={}){
  const R=createStableRace(W,statusEl,settings),baseUpdate=R.update,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const limits={
    formula:{top:91,accel:10.5,brake:24.0,cornerCoeff:.72,minRatio:.25},
    hyper:{top:84,accel:8.5,brake:22.0,cornerCoeff:.70,minRatio:.27},
    lmh:{top:83,accel:8.3,brake:22.0,cornerCoeff:.70,minRatio:.27},
    proto:{top:82,accel:8.2,brake:21.5,cornerCoeff:.69,minRatio:.28},
    gt:{top:78,accel:7.2,brake:19.5,cornerCoeff:.68,minRatio:.30},
    supercar:{top:80,accel:7.0,brake:19.0,cornerCoeff:.67,minRatio:.30},
    touring:{top:70,accel:6.0,brake:18.0,cornerCoeff:.66,minRatio:.31}
  };
  const diagnostics={owner:'runtime-kinematic-envelope-v2-pooled',corrections:0,lastMaxDelta:0,lastCornerLoad:0,snapshotAllocations:1},before=new Float64Array(Math.max(1,R.cars.length));

  function envelope(c,previous,dt){
    if(!c||c.retired||!Number.isFinite(c.v)||!Number.isFinite(previous))return;
    const p=limits[c.type]||limits.gt,wet=clamp(Number(W.env?.wetness)||0,0,1),load=clamp(Number(W.braking?.(c.s))||0,0,1),classTop=Number(c.classPerformance?.top),machinePower=clamp(Number(c.machine?.power)||1,.90,1.025),top=Math.min(p.top,Number.isFinite(classTop)?classTop*1.04:p.top)*machinePower*(1-wet*.07);
    let desired=top*clamp(1-p.cornerCoeff*Math.pow(load,1.06),p.minRatio,1)*(1-wet*load*.16);if(c.pitState!=='NONE'&&W.inPitSpeedZone?.(c.s))desired=Math.min(desired,(Number(W.pitSpeedLimit)||22.22)*1.015);
    const accel=p.accel*clamp(Number(c.machine?.power)||1,.88,1.08),brake=p.brake*clamp(Number(c.machine?.brake)||1,.88,1.08),physicalUpper=previous>desired?Math.max(desired,previous-brake*dt):Math.min(desired,previous+accel*dt),upper=Math.max(0,Math.min(top,physicalUpper));
    if(c.v>upper+.001){diagnostics.corrections++;diagnostics.lastMaxDelta=c.v-upper;c.v=upper;}diagnostics.lastCornerLoad=Math.max(diagnostics.lastCornerLoad*.98,load);
  }

  function update(dt){
    const step=clamp(Number(dt)||.016,.001,.05);for(let i=0;i<R.cars.length;i++)before[i]=Number(R.cars[i].v)||0;baseUpdate(dt);if(R.replay)return;for(let i=0;i<R.cars.length;i++)envelope(R.cars[i],before[i],step);
  }

  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='kinematicPolicy')return{...diagnostics,limits};return Reflect.get(target,prop,target);}});
}
