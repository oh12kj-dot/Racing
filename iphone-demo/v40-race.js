import {createRace as createV38Race} from './v38-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV38Race(W,statusEl,settings),baseUpdate=R.update,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const latG={formula:3.75,hyper:2.85,lmh:2.85,proto:2.95,gt:2.05,supercar:1.82,touring:1.72},look=[0,18,38,62,92,128,170,215],longitudinal=new Map(),preSpeed=[];
  const clearState=c=>!c.retired&&c.pitState==='NONE'&&c.spinState==='NONE'&&!c.hazardAvoiding&&(c.incident||0)<=0;
  for(const c of R.cars)longitudinal.set(c.id,{target:c.v||0,accel:0,mode:'COAST',hold:0,raw:c.v||0});

  function applyLine(c,dt){
    if(!clearState(c)||R.flag!=='GREEN'||R.sessionPhase==='FORMATION'||R.sessionPhase==='QUALIFYING')return;
    const ideal=clamp(W.racingLineAt?.(c.s)||0,-3.0,3.0),battle=c.battleState||'CLEAR',traffic=battle!=='CLEAR'||(c.avoid||0)>0||c.blueFlag||c.coolingMode;
    c.racingLineTarget=ideal;
    if(traffic)return;
    const strength=clamp(Math.abs(W.racingCurvatureAt?.(c.s+55)||W.curvatureAt?.(c.s+55)||0)*55+Math.abs(W.racingCurvatureAt?.(c.s)||W.curvatureAt?.(c.s)||0)*25,0,1),rate=1.35+strength*1.90,f=1-Math.exp(-rate*dt);
    c.laneTarget+=(ideal-c.laneTarget)*f;
  }

  function correctSurfaceLine(c){
    if(!clearState(c)||!R.trackEvolution)return;
    const ideal=W.racingLineAt?.(c.s)||0,deviation=Math.abs((c.lane||0)-ideal),off=clamp((deviation-1.25)/2.3,0,1),e=R.trackEvolution;
    c.trackEvolutionGrip=1+(e.dryLine||0)*.018*(1-off)-(e.marbles||0)*.055*off;c.racingLineDeviation=deviation;
  }

  function speedEnvelope(c){
    const top=Math.max(24,c.classPerformance?.top||c.baseMaxNominal||c.max||72),wet=clamp(W.env?.wetness||0,0,1),wear=clamp(c.wear||0,0,1),tempGrip=clamp(c.tempGrip||1,.75,1.08),surface=clamp(c.surfaceGrip||1,.80,1.08),evolution=clamp(c.trackEvolutionGrip||1,.88,1.04),aero=clamp(Math.min(c.aeroFront??1,c.aeroRear??1),.55,1),tyreGrip=clamp(tempGrip*surface*evolution*(1-wear*.13)*(1-wet*.20),.56,1.06),ideal=W.racingLineAt?.(c.s)||0,deviation=Math.abs((c.lane||0)-ideal),cornerDemand=clamp(Math.abs(W.racingCurvatureAt?.(c.s+28)||W.curvatureAt?.(c.s+28)||0)*70,0,1),lineEfficiency=1-cornerDemand*clamp(deviation/3,0,1)*.10,g=(latG[c.type]||2.0)*9.81*tyreGrip*(.82+.18*aero)*lineEfficiency,brakeBase=Math.max(7,c._v18BaseBrake||c.brake||15.5),brake=brakeBase*clamp(.74+.26*tyreGrip,.62,1.04)*(1-wet*.20);let target=top;
    for(const d of look){const k=Math.abs(W.racingCurvatureAt?.(c.s+d)||W.curvatureAt?.(c.s+d)||0);if(k<.00105)continue;const corner=Math.min(top,Math.sqrt(Math.max(1,g/k))),allowed=Math.sqrt(corner*corner+2*brake*d);if(allowed<target)target=allowed;}
    if(c.damageState==='HEAVY'||(c.damage||0)>.68)target=Math.min(target,18);else if((c.damage||0)>.38)target=Math.min(target,32);
    c.racingLineDeviation=deviation;
    return{target:Math.max(8,target),brake};
  }

  function longitudinalControl(c,dt,before){
    const st=longitudinal.get(c.id);if(!st)return;
    if(!clearState(c)||R.flag!=='GREEN'||R.sessionPhase==='FORMATION'||R.sessionPhase==='QUALIFYING'){
      st.target=c.v||0;st.raw=st.target;st.accel=0;st.mode='COAST';st.hold=0;c.racingThrottle=0;c.racingBrake=0;return;
    }
    const x=speedEnvelope(c);st.raw=x.target;
    if(!Number.isFinite(st.target)||Math.abs(st.target-before)>35)st.target=x.target;
    const tau=x.target<st.target?.18:.68,blend=1-Math.exp(-dt/tau);st.target+=(x.target-st.target)*blend;
    const error=st.target-before;st.hold=Math.max(0,st.hold-dt);
    let wanted=error<-1.15?'BRAKE':error>1.55?'THROTTLE':'COAST';
    if(wanted!==st.mode&&(st.hold<=0||error<-4.5)){st.mode=wanted;st.hold=wanted==='COAST'?.16:.24;}
    const accelBase=Math.max(2.5,c._v18BaseAccel||c.accel||6),brakeBase=x.brake;
    let desiredA=0;
    if(st.mode==='BRAKE'){const demand=clamp((-error-.35)/7.5,.10,1);desiredA=-brakeBase*demand;}
    else if(st.mode==='THROTTLE'){const demand=clamp((error-.35)/8.5,.08,1);desiredA=accelBase*demand;}
    else desiredA=-clamp(.18+before*.004,.18,.55);
    const jerk=desiredA<st.accel?30:10,maxDelta=jerk*dt;st.accel+=clamp(desiredA-st.accel,-maxDelta,maxDelta);
    const controlled=Math.max(0,before+st.accel*dt),core=c.v||0;
    if(core>before)c.v=Math.min(core,controlled);else if(st.accel<0&&core>controlled)c.v=controlled;
    c.racingSpeedRaw=x.target;c.racingSpeedTarget=st.target;c.racingLongAccel=st.accel;c.racingMode=st.mode;c.racingBrake=clamp(-st.accel/Math.max(1,brakeBase),0,1);c.racingThrottle=clamp(st.accel/Math.max(1,accelBase),0,1);
    if(c.racingBrake>.02)c.brakeVisual=Math.max(c.brakeVisual||0,c.racingBrake);
  }

  function update(dt){
    for(const c of R.cars){preSpeed[c.id]=c.v||0;applyLine(c,dt);}
    baseUpdate(dt);
    for(const c of R.cars){correctSurfaceLine(c);longitudinalControl(c,dt,preSpeed[c.id]??c.v??0);}
  }

  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='racingDynamics')return R.cars.map(c=>({carId:c.id,line:c.racingLineTarget??0,lineDeviation:c.racingLineDeviation??0,rawTarget:c.racingSpeedRaw??0,targetSpeed:c.racingSpeedTarget??0,longAccel:c.racingLongAccel??0,mode:c.racingMode||'COAST',brake:c.racingBrake??0,throttle:c.racingThrottle??0}));return Reflect.get(target,prop,target);}});
}
