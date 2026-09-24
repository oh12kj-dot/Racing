import {TYRE_COMPOUND} from './environment.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const PIT_REASON=Object.freeze({
  NONE:'NONE',
  PLANNED:'PLANNED_STOP',
  TYRES:'TYRE_WEAR',
  WEATHER:'WEATHER_TYRES',
  FUEL:'FUEL_LOW',
  ENGINE:'ENGINE_TEMP',
  DAMAGE:'DAMAGE'
});

export const ENERGY_POLICY=Object.freeze({
  NONE:'NONE',
  CAUTION_SAVE:'CAUTION_SAVE',
  SAVE:'SAVE',
  BALANCED:'BALANCED',
  ATTACK:'ATTACK',
  FINAL_PUSH:'FINAL_PUSH'
});

function combatEnergyRequested(car){
  const state=car.racecraft?.state;
  return state==='COMMIT'||state==='ALONGSIDE'||state==='SWITCHBACK'||!!car.racecraft?.defenseUsed;
}

export function evaluateEnergyStrategy(car,raceLaps){
  const s=car.systems;
  const capacity=Math.max(0,s?.energyCapacityMJ||0);
  const remainingLaps=Math.max(0,raceLaps-Math.max(0,car.lap));
  if(capacity<=0){
    return{mode:ENERGY_POLICY.NONE,deployAllowed:false,reserveFraction:0,soc:0,remainingLaps,combat:false};
  }

  const soc=clamp((s.energyMJ||0)/capacity,0,1);
  const combat=combatEnergyRequested(car);
  const attackReserve=clamp(s.energyAttackReserve||0,.02,.35);
  const normalReserve=clamp(s.energyReserve||.18,.08,.45);
  // Long races retain more discretionary SOC early, then progressively release
  // it as the finish approaches. This is only a policy floor: Systems still owns
  // the actual energy integration and Vehicle still owns acceleration.
  const distanceReserve=clamp(attackReserve+Math.min(.14,Math.max(0,remainingLaps-1)*.012),attackReserve,.32);
  const balancedReserve=clamp(normalReserve+Math.min(.12,Math.max(0,remainingLaps-2)*.007),normalReserve,.42);

  // Any neutralisation is a no-deploy period. Regeneration remains physical and
  // can only occur when the car is actually braking in Systems.
  if(car.cautionNoPass){
    return{mode:ENERGY_POLICY.CAUTION_SAVE,deployAllowed:false,reserveFraction:.80,soc,remainingLaps,combat};
  }
  if(s.failed||car.pit?.phase!=='TRACK'){
    return{mode:ENERGY_POLICY.SAVE,deployAllowed:false,reserveFraction:Math.max(.55,balancedReserve),soc,remainingLaps,combat};
  }

  // On the final lap the remaining discretionary reserve may be used, but the
  // controller still keeps a tiny floor rather than manufacturing zero-SOC power.
  if(car.lap>=0&&remainingLaps<=1&&soc>.025){
    return{mode:ENERGY_POLICY.FINAL_PUSH,deployAllowed:true,reserveFraction:.02,soc,remainingLaps,combat};
  }

  if(combat){
    const saveThreshold=Math.min(.46,distanceReserve+.045);
    if(soc<=saveThreshold){
      return{mode:ENERGY_POLICY.SAVE,deployAllowed:false,reserveFraction:distanceReserve,soc,remainingLaps,combat};
    }
    return{mode:ENERGY_POLICY.ATTACK,deployAllowed:true,reserveFraction:distanceReserve,soc,remainingLaps,combat};
  }

  if(soc<=Math.min(.48,balancedReserve+.035)){
    return{mode:ENERGY_POLICY.SAVE,deployAllowed:false,reserveFraction:balancedReserve,soc,remainingLaps,combat};
  }
  return{mode:ENERGY_POLICY.BALANCED,deployAllowed:true,reserveFraction:balancedReserve,soc,remainingLaps,combat};
}

export function evaluatePitStrategy(car,track,raceLaps,environment=null){
  const s=car.systems;
  const remainingLaps=Math.max(0,raceLaps-Math.max(0,car.lap));
  const projectedFuel=s.burnPerKm*(track.total/1000)*remainingLaps*1.08;
  const damage=car.incident?.damage||0;
  const lastServicedDamage=car.pit.lastServiceDamage??0;
  const newDamage=Math.max(0,damage-lastServicedDamage);
  const damageStop=damage>.48&&(!car.pit.served||damage>.82||newDamage>.12);
  const mechanicalRisk=s.engineTemp>112||s.mechanicalStress>.45||s.powerDerate>.12;
  // Tyre calls use the representative racing-line condition, not one local
  // puddle under this car. Local surface water still affects vehicle grip.
  const wetness=environment?.racingLineWetness??environment?.wetness??0;
  const currentCompound=s.tyreCompound||TYRE_COMPOUND.SLICK;
  let desiredCompound=currentCompound;
  if(currentCompound===TYRE_COMPOUND.SLICK){
    if(wetness>.58)desiredCompound=TYRE_COMPOUND.WET;
    else if(wetness>.18)desiredCompound=TYRE_COMPOUND.INTERMEDIATE;
  }else if(currentCompound===TYRE_COMPOUND.INTERMEDIATE){
    if(wetness<.10)desiredCompound=TYRE_COMPOUND.SLICK;
    else if(wetness>.62)desiredCompound=TYRE_COMPOUND.WET;
  }else if(currentCompound===TYRE_COMPOUND.WET){
    if(wetness<.08)desiredCompound=TYRE_COMPOUND.SLICK;
    else if(wetness<.44)desiredCompound=TYRE_COMPOUND.INTERMEDIATE;
  }
  const weatherStop=desiredCompound!==currentCompound;
  let reason=PIT_REASON.NONE;

  if(damageStop)reason=PIT_REASON.DAMAGE;
  else if(mechanicalRisk&&!s.failed)reason=PIT_REASON.ENGINE;
  else if(weatherStop)reason=PIT_REASON.WEATHER;
  else if(s.fuel<Math.max(8,s.fuelCapacity*.12)||s.fuel<projectedFuel)reason=PIT_REASON.FUEL;
  else if(s.tyreWear>.58)reason=PIT_REASON.TYRES;
  else if(!car.pit.served&&car.lap>=car.pit.plannedLap)reason=PIT_REASON.PLANNED;

  const request=reason!==PIT_REASON.NONE&&car.lap>=1;
  const tyreService=weatherStop||reason===PIT_REASON.TYRES||reason===PIT_REASON.PLANNED;
  return{
    request,
    reason,
    projectedFuel,
    remainingLaps,
    wetness,
    energy:evaluateEnergyStrategy(car,raceLaps),
    service:{
      tyres:tyreService,
      tyreCompound:tyreService?desiredCompound:currentCompound,
      fuel:reason===PIT_REASON.FUEL||reason===PIT_REASON.PLANNED,
      repair:reason===PIT_REASON.DAMAGE,
      cooling:reason===PIT_REASON.ENGINE
    }
  };
}
