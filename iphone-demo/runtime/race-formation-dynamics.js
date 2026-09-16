import {createRace as createRulesRace} from './race-rules-thermal.js';

// Authoritative formation-speed layer.
// The legacy rules layer still owns formation distance/grid reset, but its historical
// 28 m/s cruise target produced the visible ~101 km/h lock. This layer replaces the
// effective car speed every formation frame with a smooth, shared pace cycle so the
// field accelerates and decelerates without cars wildly changing relative gaps.
export function createRace(W,statusEl,settings={}){
  const R=createRulesRace(W,statusEl,settings),baseUpdate=R.update;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const diagnostics={owner:'formation-dynamics-v2',frames:0,minKmh:Infinity,maxKmh:0,lastTargets:[]};

  function targetFor(c,elapsed,targetDistance){
    const travelled=Math.max(0,Number(c._formationTravel)||0);
    const remain=Math.max(0,targetDistance-travelled);
    // Keep the compact formation sequence, but brake progressively as the grid is reached.
    const approach=remain<160?clamp(remain/160,.16,1):1;
    // Shared large-scale pace changes preserve the train. Small per-car offsets prevent
    // every dashboard from showing the exact same number without causing overtakes.
    const primary=Math.sin(elapsed*.78)*3.45;
    const secondary=Math.sin(elapsed*1.73+.55)*1.35;
    const heatCycle=Math.max(0,Math.sin(elapsed*.39-1.05))*1.65;
    const carOffset=((Number(c.id)||0)%4-1.5)*.18+Math.sin(elapsed*.31+(Number(c.id)||0)*.37)*.32;
    const cruise=25.4+primary+secondary+heatCycle+carOffset;
    return clamp(cruise*approach,4.5,33.5);
  }

  function applyFormationDynamics(){
    if(!R.formation)return;
    const diag=R.formationDiagnostics||{},elapsed=Math.max(0,Number(diag.elapsed)||0);
    const targetDistance=Math.max(1,Number(diag.targetDistance)||Number(R.cars?.[0]?._formationTarget)||380);
    const last=[];
    for(const c of R.cars){
      if(c.retired)continue;
      const target=targetFor(c,elapsed,targetDistance);
      c.v=target;
      c.formationSpeedTarget=target;
      const kmh=target*3.6;
      diagnostics.minKmh=Math.min(diagnostics.minKmh,kmh);
      diagnostics.maxKmh=Math.max(diagnostics.maxKmh,kmh);
      last.push({carId:c.id,targetKmh:kmh});
    }
    diagnostics.frames++;
    diagnostics.lastTargets=last;
  }

  function update(dt){
    baseUpdate(dt);
    applyFormationDynamics();
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='formationSpeedDiagnostics')return{
      ...diagnostics,
      minKmh:Number.isFinite(diagnostics.minKmh)?diagnostics.minKmh:0,
      lastTargets:diagnostics.lastTargets.map(x=>({...x}))
    };
    return Reflect.get(target,prop,target);
  }});
}
