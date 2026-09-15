import {createRace as createGridRace} from './race-grid-lock.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const TYRE_COMPOUNDS={
  SOFT:{grip:1.030,wear:1.34,opt:96,window:22},
  MEDIUM:{grip:1.000,wear:1.00,opt:92,window:25},
  HARD:{grip:.982,wear:.74,opt:88,window:29},
  INTERMEDIATE:{grip:.955,wear:1.05,opt:72,window:24},
  WET:{grip:.925,wear:.88,opt:62,window:22}
};

export function resolveTyreGrip({compound='MEDIUM',wear=0,tempC=90,wetness=0}={}){
  const p=TYRE_COMPOUNDS[compound]||TYRE_COMPOUNDS.MEDIUM,w=clamp(Number(wear)||0,0,1),wet=clamp(Number(wetness)||0,0,1),temp=Number(tempC)||p.opt;
  const thermal=clamp(1-Math.abs(temp-p.opt)/Math.max(1,p.window)*.16,.78,1);
  let weather=1;if(compound==='INTERMEDIATE')weather=clamp(.88+wet*.23,.84,1.06);else if(compound==='WET')weather=clamp(.80+wet*.31,.78,1.07);else weather=1-wet*.24;
  const wearGrip=1-w*w*.18;
  return{grip:clamp(p.grip*thermal*weather*wearGrip,.58,1.07),thermal,weather,wearGrip};
}

export function resolveDraft({gapM=999,lateralM=99,cornerLoad=0}={}){
  const gap=Math.max(0,Number(gapM)||999),lat=Math.max(0,Number(lateralM)||99),corner=clamp(Number(cornerLoad)||0,0,1);
  if(gap>70||lat>3.6)return{slipstream:0,dirtyAir:0};
  const align=clamp(1-lat/3.6,0,1),range=clamp((70-gap)/58,0,1),close=clamp((38-gap)/30,0,1);
  return{slipstream:clamp(range*align*(1-corner*.55),0,1),dirtyAir:clamp(close*align*corner,0,1)};
}

export function choosePassLane({carLane=0,aheadLane=0,curvature=0,seed=0}={}){
  const inside=Math.sign(Number(curvature)||0)*2.55,away=(Number(aheadLane)||0)>=Number(carLane)||0?-2.65:2.65;
  const preferInside=((Number(seed)||0)%4)===0&&Math.abs(curvature)>.0015;
  return clamp(preferInside?inside:away,-3.05,3.05);
}

export function createRace(W,statusEl,settings={}){
  const R=createGridRace(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,Number(W.total)||1),states=new Map(),saved=new Map(),pitPrev=new Map();
  const fuelCapacity={formula:110,hyper:94,lmh:92,proto:88,gt:105,supercar:82,touring:78};
  const burnPerMeter={formula:.000255,hyper:.000225,lmh:.000225,proto:.000215,gt:.000235,supercar:.000205,touring:.000195};
  let updates=0,passesPrepared=0,defencesPrepared=0,pitResets=0;

  function initialCompound(c){const wet=Number(W.env?.wetness)||0;if(wet>.62)return'WET';if(wet>.24)return'INTERMEDIATE';return c.id%5===0?'SOFT':c.id%3===0?'HARD':'MEDIUM';}
  function ensure(c){
    if(states.has(c.id))return states.get(c.id);const cap=fuelCapacity[c.type]||95,compound=initialCompound(c),p=TYRE_COMPOUNDS[compound];
    const s={compound,wear:clamp(Number(c.wear)||0,0,1),tempC:p.opt-8+(c.id%7),fuelCapacity:cap,fuelKg:cap*(.82+(c.id%4)*.025),aggression:.46+((c.id*37)%36)/100,slipstream:0,dirtyAir:0,gapAhead:999,passLane:0,lastPit:R.race?.t||0};
    states.set(c.id,s);pitPrev.set(c.id,c.pitState||'NONE');return s;
  }
  function progress(c){return (Number(c.lap)||0)*total+(Number(c.s)||0);}
  function aheadFor(c){
    const spatial=R.spatialNeighbours?.get?.(c.id),candidate=spatial?.aheadView||spatial?.ahead;if(candidate?.car)return{car:candidate.car,dist:Number(candidate.dist)||999};
    let best=null,bestD=Infinity,cp=progress(c);for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE')continue;let d=progress(o)-cp;if(d<=0)d+=total;if(d<bestD){bestD=d;best=o;}}
    return best?{car:best,dist:bestD}:null;
  }
  function upcomingLoad(c){return clamp(Math.abs(Number(W.racingCurvatureAt?.((c.s||0)+55)??W.curvatureAt?.((c.s||0)+55))||0)*70,0,1);}
  function savePerformance(c){
    const m=c.machine||{},x={power:m.power,brake:m.brake,aeroFront:c.aeroFront,aeroRear:c.aeroRear,accel:c._v18BaseAccel,baseBrake:c._v18BaseBrake};saved.set(c.id,x);return x;
  }
  function prepareCar(c,dt){
    if(!c||c.retired)return;const s=ensure(c),x=savePerformance(c),wet=clamp(Number(W.env?.wetness)||0,0,1),gr=resolveTyreGrip({compound:s.compound,wear:s.wear,tempC:s.tempC,wetness:wet}),ahead=aheadFor(c),corner=upcomingLoad(c);
    let draft={slipstream:0,dirtyAir:0},lat=99;if(ahead?.car){lat=Math.abs((ahead.car.lane||0)-(c.lane||0));draft=resolveDraft({gapM:ahead.dist,lateralM:lat,cornerLoad:corner});}
    s.slipstream=draft.slipstream;s.dirtyAir=draft.dirtyAir;s.gapAhead=ahead?.dist??999;c.slipstream=draft.slipstream;c.dirtyAir=draft.dirtyAir;c.wear=s.wear;c.tempGrip=gr.grip;

    const cap=s.fuelCapacity,fuelLoad=clamp(s.fuelKg/cap,0,1),massFactor=1-(fuelLoad-.45)*.018,traction=clamp(.90+gr.grip*.10,.92,1.015),draftPower=1+draft.slipstream*.018;
    if(c.machine){if(Number.isFinite(Number(x.power)))c.machine.power=x.power*massFactor*traction*draftPower;if(Number.isFinite(Number(x.brake)))c.machine.brake=x.brake*clamp(.86+gr.grip*.14-draft.dirtyAir*.035,.78,1.03);}
    if(Number.isFinite(Number(x.accel)))c._v18BaseAccel=x.accel*massFactor*traction;
    if(Number.isFinite(Number(x.baseBrake)))c._v18BaseBrake=x.baseBrake*clamp(.86+gr.grip*.14,.76,1.04);
    if(Number.isFinite(Number(x.aeroFront)))c.aeroFront=x.aeroFront*(1-draft.dirtyAir*.13);
    if(Number.isFinite(Number(x.aeroRear)))c.aeroRear=x.aeroRear*(1-draft.dirtyAir*.075);

    const green=R.flag==='GREEN'&&R.sessionPhase==='RACE'&&c.pitState==='NONE'&&c.spinState==='NONE'&&!c.hazardAvoiding;
    if(green&&ahead?.car&&!ahead.car.retired&&ahead.car.pitState==='NONE'&&ahead.dist>5.5&&ahead.dist<34&&draft.slipstream>.08){
      const curv=Number(W.racingCurvatureAt?.((c.s||0)+65)??W.curvatureAt?.((c.s||0)+65))||0,pass=choosePassLane({carLane:c.lane,aheadLane:ahead.car.lane,curvature:curv,seed:c.id});s.passLane=pass;c.battleState='ATTACK';c.laneTarget+=(pass-c.laneTarget)*clamp(dt*(1.15+s.aggression),0,.20);passesPrepared++;
      const lead=ahead.car,leadState=ensure(lead);if(ahead.dist<23&&lead.pitState==='NONE'&&lead.spinState==='NONE'&&leadState.aggression>.52){lead.battleState='DEFEND';const defend=clamp(pass*.48,-1.35,1.35);lead.laneTarget+=(defend-lead.laneTarget)*clamp(dt*.85,0,.12);defencesPrepared++;}
    }
    c.strategyTelemetry={compound:s.compound,tyreWear:s.wear,tyreTempC:s.tempC,tyreGrip:gr.grip,fuelKg:s.fuelKg,slipstream:s.slipstream,dirtyAir:s.dirtyAir,gapAhead:s.gapAhead,passLane:s.passLane};
  }
  function restoreCar(c){
    const x=saved.get(c.id);if(!x)return;if(c.machine){if(x.power!==undefined)c.machine.power=x.power;if(x.brake!==undefined)c.machine.brake=x.brake;}c.aeroFront=x.aeroFront;c.aeroRear=x.aeroRear;c._v18BaseAccel=x.accel;c._v18BaseBrake=x.baseBrake;saved.delete(c.id);
  }
  function evolve(c,dt){
    if(!c||c.retired)return;const s=ensure(c),wet=clamp(Number(W.env?.wetness)||0,0,1),distance=Math.max(0,Number(c.v)||0)*dt,p=TYRE_COMPOUNDS[s.compound]||TYRE_COMPOUNDS.MEDIUM,brake=clamp(Number(c.racingBrake??c.brakeVisual)||0,0,1),throttle=clamp(Number(c.racingThrottle)||0,0,1);
    const dryPenalty=(s.compound==='WET'||s.compound==='INTERMEDIATE')?1+Math.max(0,.28-wet)*1.8:1;
    s.wear=clamp(s.wear+distance/148000*p.wear*dryPenalty*(1+brake*.28+Math.abs(c.lane||0)*.006),0,1);
    const target=p.opt-7+brake*18+throttle*10+Math.min(8,(c.v||0)*.08)-wet*15,rate=1-Math.exp(-dt*(distance>1?.16:.06));s.tempC+=(target-s.tempC)*rate;
    const burn=(burnPerMeter[c.type]||.00022)*distance*(.72+throttle*.55+(c.energyMode==='PUSH'?.08:0));s.fuelKg=Math.max(0,s.fuelKg-burn);
    if(s.fuelKg<=.01&&c.pitState==='NONE'){c.v=Math.min(c.v||0,16);c.racingThrottle=0;c.strategyFuelStarved=true;}else c.strategyFuelStarved=false;

    const prev=pitPrev.get(c.id)||'NONE',now=c.pitState||'NONE';if(prev==='STOP'&&now!=='STOP'){
      const nextWet=Number(W.env?.wetness)||0;s.compound=nextWet>.62?'WET':nextWet>.24?'INTERMEDIATE':s.compound==='SOFT'?'MEDIUM':s.compound==='MEDIUM'?'HARD':'MEDIUM';s.wear=.015;s.tempC=(TYRE_COMPOUNDS[s.compound]?.opt||90)-12;s.fuelKg=Math.max(s.fuelKg,s.fuelCapacity*.72);s.lastPit=R.race?.t||0;pitResets++;
    }pitPrev.set(c.id,now);
    c.wear=s.wear;c.tempGrip=resolveTyreGrip({compound:s.compound,wear:s.wear,tempC:s.tempC,wetness:wet}).grip;c.tyreCompound=s.compound;c.fuelKg=s.fuelKg;
  }
  function update(dt){
    const step=clamp(Number(dt)||.016,.001,.05);for(const c of R.cars)prepareCar(c,step);
    try{baseUpdate(dt);}finally{for(const c of R.cars)restoreCar(c);}
    for(const c of R.cars)evolve(c,step);updates++;
  }
  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='strategyFor')return id=>{const s=states.get(Number(id));return s?{...s}:null;};
    if(prop==='strategyDynamics')return{owner:'runtime-strategy-dynamics-v1',updates,passesPrepared,defencesPrepared,pitResets,cars:R.cars.map(c=>({id:c.id,...(c.strategyTelemetry||{})}))};
    return Reflect.get(target,prop,target);
  }});
}
