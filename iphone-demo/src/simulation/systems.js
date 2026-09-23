import {TYRE_COMPOUND,tyreIdealTemperature,tyreWeatherGrip} from './environment.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const PROFILE={
  formula:{fuel:110,burn:.34,wear:.0105,hybrid:{capacityMJ:4.0,deployMW:.12,regenMW:.10,regenEfficiency:.74,assistShare:.10,minDeploySpeed:22,reserve:.18,attackReserve:.08}},
  hyper:{fuel:90,burn:.48,wear:.0090,hybrid:{capacityMJ:6.0,deployMW:.20,regenMW:.16,regenEfficiency:.76,assistShare:.08,minDeploySpeed:25,reserve:.20,attackReserve:.10}},
  lmh:{fuel:90,burn:.47,wear:.0090,hybrid:{capacityMJ:6.0,deployMW:.18,regenMW:.15,regenEfficiency:.76,assistShare:.08,minDeploySpeed:25,reserve:.20,attackReserve:.10}},
  proto:{fuel:75,burn:.42,wear:.0095},
  gt:{fuel:115,burn:.50,wear:.0078},
  supercar:{fuel:105,burn:.53,wear:.0085},
  touring:{fuel:100,burn:.45,wear:.0074}
};

export function createSystems(type){
  const p=PROFILE[type]||PROFILE.gt;
  const h=p.hybrid||null;
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
    failureReason:null,
    energyCapacityMJ:h?.capacityMJ??0,
    energyMJ:h?h.capacityMJ*.76:0,
    energyDeploy:0,
    energyHarvest:0,
    energyAssistShare:h?.assistShare??0,
    energyDeployMW:h?.deployMW??0,
    energyRegenMW:h?.regenMW??0,
    energyRegenEfficiency:h?.regenEfficiency??0,
    energyMinDeploySpeed:h?.minDeploySpeed??Infinity,
    energyReserve:h?.reserve??0,
    energyAttackReserve:h?.attackReserve??0,
    energyControllerActive:false,
    energyMode:h?'BALANCED':'NONE'
  };
}

export function energyDriveFactor(car){
  const s=car.systems;
  if(!s||s.energyCapacityMJ<=0||!s.energyControllerActive)return 1;
  // Hybrid availability only changes maximum requested power. At partial throttle,
  // low speed or while braking, the combustion powertrain can satisfy the driver's
  // requested torque without treating "not deploying" as a blanket drivetrain loss.
  const highDemand=(car.throttle??0)>.72&&(car.brake??0)<.05&&car.v>=s.energyMinDeploySpeed;
  if(!highDemand)return 1;
  const deploy=clamp(s.energyDeploy||0,0,1);
  const assist=clamp(s.energyAssistShare||0,0,.25);
  return clamp(1-assist*(1-deploy),1-assist,1);
}

function stepHybridEnergy(car,dt){
  const s=car.systems;
  const capacity=Math.max(0,s.energyCapacityMJ||0);
  if(capacity<=0){
    s.energyMJ=0;s.energyDeploy=0;s.energyHarvest=0;s.energyControllerActive=false;s.energyMode='NONE';
    return;
  }

  s.energyControllerActive=true;
  const attacking=car.racecraft?.state==='COMMIT'||car.racecraft?.state==='ALONGSIDE';
  const reserveFraction=attacking?(s.energyAttackReserve||0):(s.energyReserve||0);
  const reserveMJ=capacity*clamp(reserveFraction,0,.8);
  const deployDemand=!s.failed&&car.v>=s.energyMinDeploySpeed&&car.brake<.05&&car.throttle>.72;
  const deployRequest=deployDemand?clamp((car.throttle-.72)/.28,0,1):0;
  const available=Math.max(0,(s.energyMJ||0)-reserveMJ);
  const deployEnergy=Math.min(available,Math.max(0,s.energyDeployMW||0)*deployRequest*dt);
  s.energyDeploy=(s.energyDeployMW||0)>0&&dt>0?clamp(deployEnergy/(s.energyDeployMW*dt),0,1):0;

  const harvestRequest=!s.failed&&car.v>10&&car.brake>.08?clamp(car.brake,0,1):0;
  const harvestPotential=Math.max(0,s.energyRegenMW||0)*harvestRequest*clamp(s.energyRegenEfficiency||0,0,1)*dt;
  const harvestEnergy=Math.min(Math.max(0,capacity-(s.energyMJ-deployEnergy)),harvestPotential);
  s.energyHarvest=(s.energyRegenMW||0)>0&&s.energyRegenEfficiency>0&&dt>0
    ?clamp(harvestEnergy/(s.energyRegenMW*s.energyRegenEfficiency*dt),0,1):0;
  s.energyMJ=clamp(s.energyMJ-deployEnergy+harvestEnergy,0,capacity);

  if(s.energyHarvest>.02)s.energyMode='HARVEST';
  else if(s.energyDeploy>.02)s.energyMode=attacking?'ATTACK':'DEPLOY';
  else if(s.energyMJ<=reserveMJ+.01)s.energyMode='RESERVE';
  else s.energyMode='BALANCED';
}

export function gripFactor(car,environment=null,surface=null){
  const s=car.systems;
  const wetness=clamp(surface?.wetness??environment?.wetness??0,0,1);
  const standingWater=clamp(surface?.standingWater??0,0,1);
  const compound=s.tyreCompound||TYRE_COMPOUND.SLICK;
  const idealTemp=tyreIdealTemperature(compound,wetness);
  const tempPenalty=Math.abs(s.tyreTemp-idealTemp)/(compound===TYRE_COMPOUND.WET?105:125);
  const wearPenalty=Math.max(0,s.tyreWear-.18)*.24;
  const damagePenalty=(car.incident?.damage||0)*.10;
  const slipAngle=Math.abs(car.tyre?.slipAngle||0);
  const slipRatio=Math.abs(car.tyre?.slipRatio||0);
  const slidePenalty=Math.max(0,slipAngle-.10)*.22+Math.max(0,slipRatio-.10)*.18;
  const tyreState=clamp(1.015-tempPenalty-wearPenalty-damagePenalty-slidePenalty,.74,1.02);
  const hydroSpeed=clamp((car.v-22)/45,0,1);
  const waterPenalty=standingWater*hydroSpeed*(compound===TYRE_COMPOUND.WET?.10:.28);
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
  stepHybridEnergy(car,dt);

  const latLoad=Math.min(1.5,Math.abs(car.laneA)/(Math.max(1,car.spec.laneChangeG*9.81)));
  const slipAngle=Math.min(2.5,Math.abs(car.tyre?.slipAngle||0)/.10);
  const slipRatio=Math.min(2.5,Math.abs(car.tyre?.slipRatio||0)/.10);
  const slipEnergy=slipAngle*.65+slipRatio*.55;
  const compoundWear=compound===TYRE_COMPOUND.WET?1+(1-wetness)*.45:1+wetness*.18;
  s.tyreWear=clamp(s.tyreWear+km*(PROFILE[car.type]?.wear||.009)*(1+latLoad*.72+slipEnergy*.34)*compoundWear,0,1);
  const baseTyreTemp=compound===TYRE_COMPOUND.WET?64:76;
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
    s.energyDeploy=0;
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
  if(servicePlan?.tyreCompound===TYRE_COMPOUND.WET||servicePlan?.tyreCompound===TYRE_COMPOUND.SLICK)s.tyreCompound=servicePlan.tyreCompound;
  s.fuel=Math.min(s.fuelCapacity,Math.max(s.fuel,s.fuelCapacity*.82));
  s.tyreWear=0;
  s.tyreTemp=s.tyreCompound===TYRE_COMPOUND.WET?70:80;
  s.brakeTemp=Math.min(s.brakeTemp,260);
  s.engineTemp=Math.min(s.engineTemp,94);
  s.mechanicalStress=Math.max(0,s.mechanicalStress-.35);
  s.powerDerate=s.failed?1:0;
  s.grip=1;
  s.serviceCount++;
  if(car.incident)car.incident.damage=Math.max(0,car.incident.damage-.32);
  if(car.tyre){car.tyre.slipRatio=0;car.tyre.slipAngle=0;}
}
