import {TYRE_COMPOUND,tyreIdealTemperature,tyreWeatherGrip} from './environment.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const PROFILE={
  formula:{fuel:110,burn:.34,wear:.0105},
  hyper:{fuel:90,burn:.48,wear:.0090},
  lmh:{fuel:90,burn:.47,wear:.0090},
  proto:{fuel:75,burn:.42,wear:.0095},
  gt:{fuel:115,burn:.50,wear:.0078},
  supercar:{fuel:105,burn:.53,wear:.0085},
  touring:{fuel:100,burn:.45,wear:.0074}
};

export function createSystems(type){
  const p=PROFILE[type]||PROFILE.gt;
  return{
    fuelCapacity:p.fuel,
    fuel:p.fuel*.64,
    burnPerKm:p.burn,
    tyreWear:0,
    tyreTemp:82,
    tyreCompound:TYRE_COMPOUND.SLICK,
    brakeTemp:310,
    engineTemp:88,
    grip:1,
    fuelUsed:0,
    serviceCount:0,
    mechanicalStress:0,
    powerDerate:0,
    failed:false,
    failureReason:null
  };
}

export function gripFactor(car,environment=null,surface=null){
  const s=car.systems;
  const wetness=clamp(surface?.wetness??environment?.wetness??0,0,1);
  const standingWater=clamp(surface?.standingWater??0,0,1);
  const compound=s.tyreCompound||TYRE_COMPOUND.SLICK;
  const idealTemp=tyreIdealTemperature(compound,wetness);
  const tempRange=compound===TYRE_COMPOUND.WET?105:compound===TYRE_COMPOUND.INTERMEDIATE?115:125;
  const tempPenalty=Math.abs(s.tyreTemp-idealTemp)/tempRange;
  const wearPenalty=Math.max(0,s.tyreWear-.18)*.24;
  const damagePenalty=(car.incident?.damage||0)*.10;
  const slipAngle=Math.abs(car.tyre?.slipAngle||0);
  const slipRatio=Math.abs(car.tyre?.slipRatio||0);
  const slidePenalty=Math.max(0,slipAngle-.10)*.22+Math.max(0,slipRatio-.10)*.18;
  const tyreState=clamp(1.015-tempPenalty-wearPenalty-damagePenalty-slidePenalty,.74,1.02);
  const hydroSpeed=clamp((car.v-22)/45,0,1);
  const waterResistance=compound===TYRE_COMPOUND.WET?.10:compound===TYRE_COMPOUND.INTERMEDIATE?.18:.28;
  const waterPenalty=standingWater*hydroSpeed*waterResistance;
  return clamp(tyreState*tyreWeatherGrip(compound,wetness)*(1-waterPenalty),.42,1.02);
}

export function stepSystems(car,dt,environment=null,surface=null){
  const s=car.systems;
  const damage=clamp(car.incident?.damage||0,0,1);
  const wetness=clamp(surface?.wetness??environment?.wetness??0,0,1);
  const standingWater=clamp(surface?.standingWater??0,0,1);
  const compound=s.tyreCompound||TYRE_COMPOUND.SLICK;
  const km=car.v*dt/1000;
  const fuelUse=km*s.burnPerKm*(.72+.45*car.throttle);
  s.fuel=Math.max(0,s.fuel-fuelUse);
  s.fuelUsed+=fuelUse;

  const latLoad=Math.min(1.5,Math.abs(car.laneA)/(Math.max(1,car.spec.laneChangeG*9.81)));
  const slipAngle=Math.min(2.5,Math.abs(car.tyre?.slipAngle||0)/.10);
  const slipRatio=Math.min(2.5,Math.abs(car.tyre?.slipRatio||0)/.10);
  const slipEnergy=slipAngle*.65+slipRatio*.55;
  const compoundWear=compound===TYRE_COMPOUND.WET
    ?1+(1-wetness)*.45
    :compound===TYRE_COMPOUND.INTERMEDIATE
      ?1+(1-wetness)*.24+wetness*.06
      :1+wetness*.18;
  s.tyreWear=clamp(s.tyreWear+km*(PROFILE[car.type]?.wear||.009)*(1+latLoad*.72+slipEnergy*.34)*compoundWear,0,1);
  const baseTyreTemp=compound===TYRE_COMPOUND.WET?64:compound===TYRE_COMPOUND.INTERMEDIATE?70:76;
  const tyreTarget=baseTyreTemp+car.v*.19+latLoad*15+slipEnergy*8+Math.abs(car.brake)*6-wetness*12-standingWater*5;
  s.tyreTemp+=clamp(tyreTarget-s.tyreTemp,-18,18)*dt*.18;
  const brakeTarget=170+car.brake*720+car.v*1.8-wetness*35-standingWater*18;
  s.brakeTemp+=clamp(brakeTarget-s.brakeTemp,-260,260)*dt*.28;
  const ambientEffect=((environment?.ambientTemp??24)-24)*.10;
  const engineTarget=84+car.throttle*23+Math.max(0,car.v-60)*.08+damage*18+ambientEffect;
  s.engineTemp+=clamp(engineTarget-s.engineTemp,-12,12)*dt*.08;

  const heatStress=Math.max(0,s.engineTemp-108)/20;
  const damageStress=Math.max(0,damage-.40)*(.25+.75*car.throttle);
  const stressGain=heatStress*.0045+damageStress*.0015;
  const stressRecovery=heatStress<.08&&damageStress<.03?.0012:0;
  s.mechanicalStress=clamp(s.mechanicalStress+(stressGain-stressRecovery)*dt,0,1.2);
  s.powerDerate=clamp(Math.max(0,s.mechanicalStress-.25)*.55+Math.max(0,s.engineTemp-110)*.012,0,.48);
  if(!s.failed&&(s.engineTemp>132||s.mechanicalStress>=.98)){
    s.failed=true;
    s.failureReason=s.engineTemp>132?'OVERHEAT':'MECHANICAL_STRESS';
    s.powerDerate=1;
  }
  if(s.failed)s.powerDerate=1;
  s.grip=gripFactor(car,environment,surface);
}

export function needsPit(car){
  const s=car.systems;
  return s.tyreWear>.58||s.fuel<Math.max(8,s.fuelCapacity*.12)||s.engineTemp>112||s.mechanicalStress>.45||s.powerDerate>.12;
}

export function serviceSystems(car,servicePlan=null){
  const s=car.systems;
  if([TYRE_COMPOUND.SLICK,TYRE_COMPOUND.INTERMEDIATE,TYRE_COMPOUND.WET].includes(servicePlan?.tyreCompound))s.tyreCompound=servicePlan.tyreCompound;
  s.fuel=Math.min(s.fuelCapacity,Math.max(s.fuel,s.fuelCapacity*.82));
  s.tyreWear=0;
  s.tyreTemp=s.tyreCompound===TYRE_COMPOUND.WET?70:s.tyreCompound===TYRE_COMPOUND.INTERMEDIATE?76:80;
  s.brakeTemp=Math.min(s.brakeTemp,260);
  s.engineTemp=Math.min(s.engineTemp,94);
  s.mechanicalStress=Math.max(0,s.mechanicalStress-.35);
  s.powerDerate=s.failed?1:0;
  s.grip=1;
  s.serviceCount++;
  if(car.incident)car.incident.damage=Math.max(0,car.incident.damage-.32);
  if(car.tyre){car.tyre.slipRatio=0;car.tyre.slipAngle=0;}
}
