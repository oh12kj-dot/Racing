import {componentDamageHashValues} from './component-damage.js';

const q=(value,scale=1e6)=>Number.isFinite(value)?Math.round(value*scale):'NA';
const bool=value=>value?1:0;
const text=(value,fallback='NONE')=>value==null?fallback:String(value);

function pushServicePlan(values,plan){
  if(!plan){values.push('NO_SERVICE_PLAN');return;}
  values.push(
    bool(plan.tyres),text(plan.tyreCompound),bool(plan.fuel),bool(plan.repair),bool(plan.cooling)
  );
}

function pushRacecraft(values,state={}){
  values.push(
    text(state.state,'RESET'),state.targetId??-1,q(state.commitUntil),q(state.setupUntil),q(state.switchUntil),
    text(state.attackKind),q(state.lane),bool(state.defenseUsed),bool(state.defenseActive),q(state.defenseActiveUntil),
    q(state.defenseResetAt),q(state.alongsideAt)
  );
}

function pushDriver(values,driver={}){
  values.push(q(driver.mistakeTimer),q(driver.mistakeDuration),q(driver.steerBias),q(driver.lift));
}

function pushPit(values,pit={}){
  values.push(
    text(pit.phase,'TRACK'),bool(pit.requested),bool(pit.served),q(pit.plannedLap),q(pit.serviceTimer),bool(pit.queue),
    q(pit.boxS),q(pit.missedCount),text(pit.requestReason),bool(pit.serviceApplied),q(pit.lastServiceDamage),q(pit.completedStops)
  );
  pushServicePlan(values,pit.servicePlan);
  pushServicePlan(values,pit.lastServicePlan);
}

function pushTiming(values,timing={}){
  values.push(q(timing.lapStart),q(timing.sectorStamp),q(timing.sectorIndex),q(timing.lastLap),q(timing.bestLap));
  const current=Array.isArray(timing.currentSectors)?timing.currentSectors:[];
  values.push(current.length,...current.map(value=>q(value)));
}

function pushSystems(values,systems={}){
  values.push(
    q(systems.fuel),q(systems.tyreWear),q(systems.tyreTemp),text(systems.tyreCompound),q(systems.brakeTemp),q(systems.engineTemp),q(systems.grip),q(systems.fuelUsed),
    q(systems.serviceCount),q(systems.mechanicalStress),q(systems.powerDerate),bool(systems.failed),text(systems.failureReason),
    q(systems.energyMJ),q(systems.energyDeploy),q(systems.energyHarvest),q(systems.energyReserveTarget),q(systems.energyStrategyHold),
    bool(systems.energyControllerActive),text(systems.energyStrategy),text(systems.energyMode)
  );
}

function pushTyre(values,tyre={}){
  values.push(
    q(tyre.slipRatio),q(tyre.slipAngle),q(tyre.loadTransfer),q(tyre.longitudinalAccel),q(tyre.lateralForceUsage),q(tyre.forceUsage)
  );
}

function pushIncident(values,incident={}){
  values.push(
    q(incident.damage),...componentDamageHashValues(incident),q(incident.spinTimer),bool(incident.yawTransient),q(incident.redRecoveryTimer)
  );
}

function pushCar(values,car){
  values.push(
    car.id,car.lap,q(car.s),q(car.v),q(car.lane),q(car.laneV),q(car.laneA),q(car.yaw),q(car.yawRate),car.gear,
    q(car.steer),q(car.throttle),q(car.brake),q(car.targetSpeed),q(car.targetLane),q(car.reaction),q(car.lastS),q(car.totalProgress),
    bool(car.blueFlag),bool(car.cautionNoPass),bool(car.finished),q(car.finishTime),bool(car.retired)
  );
  pushRacecraft(values,car.racecraft);
  pushDriver(values,car.driver);
  pushPit(values,car.pit);
  pushTiming(values,car.timing);
  pushSystems(values,car.systems);
  pushTyre(values,car.tyre);
  pushIncident(values,car.incident);
}

function fnv1a(values){
  let h=2166136261>>>0;
  for(const value of values){
    const s=String(value);
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  }
  return h.toString(16).padStart(8,'0');
}

export function hashRaceAuthority({time,greenAt,raceLaps,running,finished,winnerId,rngState,raceControl,environment,cars}){
  const values=[
    'RACE_AUTHORITY_V2',q(time),q(greenAt),q(raceLaps),bool(running),bool(finished),winnerId??-1,rngState??0,
    text(raceControl?.flag,'GREEN'),q(raceControl?.cautionUntil),raceControl?.incidentId??-1,text(raceControl?.restartPhase,'NONE'),
    q(raceControl?.restartStartedAt),q(raceControl?.lastFlagChange),[...(raceControl?.incidentIds||[])].sort((a,b)=>a-b).join(','),
    q(environment?.elapsed),q(environment?.wetness),q(environment?.rainRate),q(environment?.dryingRate),q(environment?.visibility),q(environment?.ambientTemp),
    text(environment?.rainTimelineKey,''),q(environment?.forecastHorizonSeconds),q(environment?.forecastRainRate),q(environment?.forecastRacingLineWetness),
    text(environment?.forecastTrend,'STEADY'),q(environment?.racingLineWetness),q(environment?.offLineWetness)
  ];
  const line=Array.isArray(environment?.surfaceLine)?environment.surfaceLine:[];
  const off=Array.isArray(environment?.surfaceOffLine)?environment.surfaceOffLine:[];
  values.push(line.length,...line.map(value=>q(value)),off.length,...off.map(value=>q(value)));
  for(const car of [...cars].sort((a,b)=>a.id-b.id))pushCar(values,car);
  return fnv1a(values);
}
