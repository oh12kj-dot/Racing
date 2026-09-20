import {TYRE_COMPOUND} from './environment.js';

export const PIT_REASON=Object.freeze({
  NONE:'NONE',
  PLANNED:'PLANNED_STOP',
  TYRES:'TYRE_WEAR',
  WEATHER:'WEATHER_TYRES',
  FUEL:'FUEL_LOW',
  ENGINE:'ENGINE_TEMP',
  DAMAGE:'DAMAGE'
});

export function evaluatePitStrategy(car,track,raceLaps,environment=null){
  const s=car.systems;
  const remainingLaps=Math.max(0,raceLaps-Math.max(0,car.lap));
  const projectedFuel=s.burnPerKm*(track.total/1000)*remainingLaps*1.08;
  const damage=car.incident?.damage||0;
  const lastServicedDamage=car.pit.lastServiceDamage??0;
  const newDamage=Math.max(0,damage-lastServicedDamage);
  const damageStop=damage>.48&&(!car.pit.served||damage>.82||newDamage>.12);
  const mechanicalRisk=s.engineTemp>112||s.mechanicalStress>.45||s.powerDerate>.12;
  const wetness=environment?.wetness??0;
  const currentCompound=s.tyreCompound||TYRE_COMPOUND.SLICK;
  const desiredCompound=currentCompound===TYRE_COMPOUND.WET
    ?(wetness<.20?TYRE_COMPOUND.SLICK:TYRE_COMPOUND.WET)
    :(wetness>.40?TYRE_COMPOUND.WET:TYRE_COMPOUND.SLICK);
  const weatherStop=desiredCompound!==currentCompound;
  let reason=PIT_REASON.NONE;

  if(damageStop)reason=PIT_REASON.DAMAGE;
  else if(mechanicalRisk&&!s.failed)reason=PIT_REASON.ENGINE;
  else if(weatherStop)reason=PIT_REASON.WEATHER;
  else if(s.fuel<Math.max(8,s.fuelCapacity*.12)||s.fuel<projectedFuel)reason=PIT_REASON.FUEL;
  else if(s.tyreWear>.58)reason=PIT_REASON.TYRES;
  else if(!car.pit.served&&car.lap>=car.pit.plannedLap)reason=PIT_REASON.PLANNED;

  const request=reason!==PIT_REASON.NONE&&car.lap>=1;
  const tyreService=reason===PIT_REASON.TYRES||reason===PIT_REASON.PLANNED||reason===PIT_REASON.WEATHER;
  return{
    request,
    reason,
    projectedFuel,
    remainingLaps,
    wetness,
    service:{
      tyres:tyreService,
      tyreCompound:tyreService?desiredCompound:currentCompound,
      fuel:reason===PIT_REASON.FUEL||reason===PIT_REASON.PLANNED,
      repair:reason===PIT_REASON.DAMAGE,
      cooling:reason===PIT_REASON.ENGINE
    }
  };
}
