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
  const completedLaps=Math.max(0,car.lap);
  const currentLapProgress=car.lap>=0&&track.total>0?Math.max(0,Math.min(1,track.wrapS(car.s)/track.total)):0;
  const remainingLaps=Math.max(0,raceLaps-completedLaps);
  const remainingDistanceLaps=Math.max(0,raceLaps-completedLaps-currentLapProgress);
  // Fuel demand follows physical distance still to travel, not just the integer
  // current-lap index. Using remainingLaps here overestimates demand by up to
  // almost one full lap late in a lap and can trigger an unnecessary early stop.
  const projectedFuel=s.burnPerKm*(track.total/1000)*remainingDistanceLaps*1.08;
  const damage=car.incident?.damage||0;
  const lastServicedDamage=car.pit.lastServiceDamage??0;
  const newDamage=Math.max(0,damage-lastServicedDamage);
  const damageStop=damage>.48&&(!car.pit.served||damage>.82||newDamage>.12);
  const mechanicalRisk=s.engineTemp>112||s.mechanicalStress>.45||s.powerDerate>.12;
  // Tyre calls use the representative racing-line condition, not one local
  // puddle under this car. Local surface water still affects vehicle grip.
  const wetness=environment?.racingLineWetness??environment?.wetness??0;
  const forecastWetness=environment?.forecastRacingLineWetness??wetness;
  const forecastRainRate=environment?.forecastRainRate??environment?.rainRate??0;
  const forecastTrend=environment?.forecastTrend??'STEADY';
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

  // Forecast is deliberately allowed to veto only a drying-direction change.
  // It never installs a wetter tyre early on a still-dry track. This prevents
  // WET->INT->WET and INT->SLICK->INT churn when the authoritative short-term
  // forecast says the crossing will reverse inside the forecast horizon.
  let forecastHold=false;
  if(forecastTrend==='WETTER'){
    if(currentCompound===TYRE_COMPOUND.INTERMEDIATE&&desiredCompound===TYRE_COMPOUND.SLICK&&forecastWetness>.18){
      desiredCompound=currentCompound;forecastHold=true;
    }else if(currentCompound===TYRE_COMPOUND.WET&&desiredCompound===TYRE_COMPOUND.INTERMEDIATE&&forecastWetness>.62){
      desiredCompound=currentCompound;forecastHold=true;
    }
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
  // Minor damage alone should not create an extra stop, but once the car is
  // already committed to the box it is worth repairing damage large enough to
  // measurably affect aero/drive/steering. This keeps service intent explicit
  // instead of relying on serviceSystems to perform an unrequested free repair.
  const repairService=reason===PIT_REASON.DAMAGE||(request&&damage>.10);
  return{
    request,
    reason,
    projectedFuel,
    remainingLaps,
    remainingDistanceLaps,
    wetness,
    forecastWetness,
    forecastRainRate,
    forecastTrend,
    forecastHold,
    service:{
      tyres:tyreService,
      tyreCompound:tyreService?desiredCompound:currentCompound,
      fuel:reason===PIT_REASON.FUEL||reason===PIT_REASON.PLANNED,
      repair:repairService,
      cooling:reason===PIT_REASON.ENGINE
    }
  };
}
