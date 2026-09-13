import {createRace as createV38Race} from './v38-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV38Race(W,statusEl,settings),baseUpdate=R.update,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const latG={formula:3.75,hyper:2.85,lmh:2.85,proto:2.95,gt:2.05,supercar:1.82,touring:1.72},look=[0,18,38,62,92,128,170,215];
  const clearState=c=>!c.retired&&c.pitState==='NONE'&&c.spinState==='NONE'&&!c.hazardAvoiding&&(c.incident||0)<=0;

  function applyLine(c,dt){
    if(!clearState(c)||R.flag!=='GREEN'||R.sessionPhase==='FORMATION'||R.sessionPhase==='QUALIFYING')return;
    const ideal=clamp(W.racingLineAt?.(c.s)||0,-3.0,3.0),battle=c.battleState||'CLEAR',traffic=battle!=='CLEAR'||(c.avoid||0)>0||c.blueFlag||c.coolingMode;
    c.racingLineTarget=ideal;
    if(traffic)return; // Overtake, defence, blue flag and hazard logic always owns the lane first.
    const strength=clamp(Math.abs(W.racingCurvatureAt?.(c.s+55)||W.curvatureAt?.(c.s+55)||0)*55+Math.abs(W.racingCurvatureAt?.(c.s)||W.curvatureAt?.(c.s)||0)*25,0,1),rate=1.55+strength*2.25,f=1-Math.exp(-rate*dt);
    c.laneTarget+=(ideal-c.laneTarget)*f;
  }

  function speedEnvelope(c){
    const top=Math.max(24,c.classPerformance?.top||c.baseMaxNominal||c.max||72),wet=clamp(W.env?.wetness||0,0,1),wear=clamp(c.wear||0,0,1),tempGrip=clamp(c.tempGrip||1,.75,1.08),surface=clamp(c.surfaceGrip||1,.80,1.08),aero=clamp(Math.min(c.aeroFront??1,c.aeroRear??1),.55,1),tyreGrip=clamp(tempGrip*surface*(1-wear*.13)*(1-wet*.20),.58,1.06),ideal=W.racingLineAt?.(c.s)||0,deviation=Math.abs((c.lane||0)-ideal),cornerDemand=clamp(Math.abs(W.racingCurvatureAt?.(c.s+28)||W.curvatureAt?.(c.s+28)||0)*70,0,1),lineEfficiency=1-cornerDemand*clamp(deviation/3,0,1)*.10,g=(latG[c.type]||2.0)*9.81*tyreGrip*(.82+.18*aero)*lineEfficiency,brakeBase=Math.max(7,c._v18BaseBrake||c.brake||15.5),brake=brakeBase*clamp(.74+.26*tyreGrip,.62,1.04)*(1-wet*.20);let target=top;
    for(const d of look){const k=Math.abs(W.racingCurvatureAt?.(c.s+d)||W.curvatureAt?.(c.s+d)||0);if(k<.00105)continue;const corner=Math.min(top,Math.sqrt(Math.max(1,g/k))),allowed=Math.sqrt(corner*corner+2*brake*d);if(allowed<target)target=allowed;}
    if(c.damageState==='HEAVY'||(c.damage||0)>.68)target=Math.min(target,18);else if((c.damage||0)>.38)target=Math.min(target,32);
    c.racingLineDeviation=deviation;
    return{target:Math.max(8,target),brake};
  }

  // v24's legacy rubber/marbles model was centreline-relative. Correct it to the actual
  // racing line so using the outside on entry/exit is not incorrectly treated as dirty track.
  function correctSurfaceLine(c,dt){
    if(!clearState(c)||!R.trackEvolution)return;
    const ideal=W.racingLineAt?.(c.s)||0,deviation=Math.abs((c.lane||0)-ideal),off=clamp((deviation-1.25)/2.3,0,1),e=R.trackEvolution,desired=1+(e.dryLine||0)*.018*(1-off)-(e.marbles||0)*.055*off,old=c.trackEvolutionGrip||1;
    c.v*=Math.max(.985,1+(desired-old)*dt*.55);c.trackEvolutionGrip=desired;c.racingLineDeviation=deviation;
  }

  function postSpeed(c,dt){
    if(!clearState(c)||R.flag!=='GREEN')return;
    const x=speedEnvelope(c),before=c.v||0;c.racingSpeedTarget=x.target;
    if(before>x.target){
      c.v=Math.max(x.target,before-x.brake*dt);
      const dec=(before-c.v)/Math.max(.001,dt),pressure=clamp(dec/Math.max(1,x.brake),0,1);c.brakeVisual=Math.max(c.brakeVisual||0,pressure);
      c.racingThrottle=0;c.racingBrake=pressure;
    }else{
      const gap=x.target-before;c.racingBrake=0;c.racingThrottle=clamp(gap/Math.max(6,(c._v18BaseAccel||c.accel||6)*2.2),0,1);
    }
  }

  function update(dt){
    for(const c of R.cars)applyLine(c,dt);
    baseUpdate(dt);
    for(const c of R.cars){correctSurfaceLine(c,dt);postSpeed(c,dt);}
  }

  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='racingDynamics')return R.cars.map(c=>({carId:c.id,line:c.racingLineTarget??0,lineDeviation:c.racingLineDeviation??0,targetSpeed:c.racingSpeedTarget??0,brake:c.racingBrake??0,throttle:c.racingThrottle??0}));return Reflect.get(target,prop,target);}});
}
