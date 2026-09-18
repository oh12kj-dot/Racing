import {buildWorld as buildPitRealismWorld} from './world-pit-realism.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildPitRealismWorld(THREE,TRACK,settings,circuitName);
  const exactFor=typeof W.racingCurvatureFor==='function'?W.racingCurvatureFor.bind(W):null;
  const exactAt=typeof W.racingCurvatureAt==='function'?W.racingCurvatureAt.bind(W):typeof W.curvatureAt==='function'?W.curvatureAt.bind(W):()=>0;
  const gridStep=Math.max(2.5,Math.min(6,Number(W.multiCornerLineDiagnostics?.step)||Number(W.racingLineProfile?.step)||4.2));
  const radius=Math.max(3.5,gridStep*1.05),offsets=[-radius,-radius*.5,0,radius*.5,radius];

  // The longitudinal planner samples the future path every few metres. A genuine
  // chicane/hairpin curvature peak can be narrower than that sample cadence, so a
  // single point sample can miss the peak until the car is already in it. Preserve
  // the exact curvature API for steering/telemetry and expose a local peak envelope
  // only for speed planning. This is spatial anti-aliasing, not a speed clamp.
  W.racingCurvatureDemandFor=(s,mode='OPTIMAL')=>{
    let demand=0;
    for(const d of offsets){
      const k=exactFor?exactFor(Number(s||0)+d,mode):exactAt(Number(s||0)+d);
      demand=Math.max(demand,Math.abs(Number(k)||0));
    }
    return demand;
  };
  W.racingCurvaturePlanningDiagnostics={owner:'runtime-curvature-demand-v1',gridStep,radius,samples:offsets.length};
  return W;
}
