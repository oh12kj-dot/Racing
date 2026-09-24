import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {stepSystems} from '../src/simulation/systems.js';
import {ENERGY_POLICY,evaluateEnergyStrategy,evaluatePitStrategy} from '../src/simulation/strategy.js';
import {createTrack} from '../src/simulation/track.js';

function makeCar(type='formula',v=55){
  const entry=buildEntrants().find(e=>e.type===type);
  const car=createVehicleState(entry,120,0);
  car.pit.phase='TRACK';car.v=v;car.throttle=1;car.brake=0;
  return car;
}

function applyPolicy(car,raceLaps=20){
  car.strategy={energy:evaluateEnergyStrategy(car,raceLaps)};
  return car.strategy.energy;
}

test('ENERGY-STRAT-01: policy reads SOC and race distance without writing vehicle or energy state',()=>{
  const car=makeCar('formula');
  car.lap=2;
  const before={s:car.s,v:car.v,lane:car.lane,laneV:car.laneV,energyMJ:car.systems.energyMJ};
  const policy=evaluateEnergyStrategy(car,20);
  expect(policy.mode).toBe(ENERGY_POLICY.BALANCED);
  expect(policy.deployAllowed).toBeTruthy();
  expect(policy.remainingLaps).toBe(18);
  expect(policy.reserveFraction).toBeGreaterThan(car.systems.energyReserve);
  expect({s:car.s,v:car.v,lane:car.lane,laneV:car.laneV,energyMJ:car.systems.energyMJ}).toEqual(before);
});

test('ENERGY-STRAT-02: caution overrides combat intent and blocks discretionary deployment',()=>{
  const car=makeCar('formula');
  car.lap=8;car.racecraft.state='COMMIT';car.cautionNoPass=true;
  const policy=applyPolicy(car);
  const start=car.systems.energyMJ;
  expect(policy.mode).toBe(ENERGY_POLICY.CAUTION_SAVE);
  expect(policy.deployAllowed).toBeFalsy();
  expect(policy.reserveFraction).toBeGreaterThan(.7);
  for(let i=0;i<60;i++)stepSystems(car,FIXED_DT);
  expect(car.systems.energyPolicyMode).toBe(ENERGY_POLICY.CAUTION_SAVE);
  expect(car.systems.energyDeploy).toBe(0);
  expect(car.systems.energyMJ).toBeCloseTo(start,9);
});

test('ENERGY-STRAT-03: an early-race attack spends energy only down to its distance-aware reserve',()=>{
  const car=makeCar('formula');
  car.lap=2;car.racecraft.state='COMMIT';
  const policy=applyPolicy(car,20),start=car.systems.energyMJ;
  expect(policy.mode).toBe(ENERGY_POLICY.ATTACK);
  expect(policy.reserveFraction).toBeGreaterThan(car.systems.energyAttackReserve);
  for(let i=0;i<1800;i++)stepSystems(car,FIXED_DT);
  expect(car.systems.energyMJ).toBeLessThan(start-.2);
  expect(car.systems.energyMJ).toBeGreaterThanOrEqual(car.systems.energyCapacityMJ*policy.reserveFraction-1e-9);
});

test('ENERGY-STRAT-04: low SOC refuses an attack instead of creating reserve power',()=>{
  const car=makeCar('hyper');
  car.lap=5;car.racecraft.state='COMMIT';
  car.systems.energyMJ=car.systems.energyCapacityMJ*.12;
  const policy=applyPolicy(car,20),start=car.systems.energyMJ;
  expect(policy.mode).toBe(ENERGY_POLICY.SAVE);
  expect(policy.deployAllowed).toBeFalsy();
  for(let i=0;i<120;i++)stepSystems(car,FIXED_DT);
  expect(car.systems.energyDeploy).toBe(0);
  expect(car.systems.energyMJ).toBeCloseTo(start,9);
});

test('ENERGY-STRAT-05: final lap releases energy below the normal attack reserve without bypassing Systems',()=>{
  const car=makeCar('formula');
  car.lap=19;car.racecraft.state='COMMIT';
  car.systems.energyMJ=car.systems.energyCapacityMJ*.07;
  const policy=applyPolicy(car,20),start=car.systems.energyMJ;
  expect(policy.mode).toBe(ENERGY_POLICY.FINAL_PUSH);
  expect(policy.reserveFraction).toBeLessThan(car.systems.energyAttackReserve);
  stepSystems(car,FIXED_DT);
  expect(car.systems.energyDeploy).toBeGreaterThan(.9);
  expect(car.systems.energyMJ).toBeLessThan(start);
  expect(car.systems.energyMJ).toBeGreaterThan(car.systems.energyCapacityMJ*.02);
});

test('ENERGY-STRAT-06: active defence is a combat demand and may use managed hybrid reserve',()=>{
  const car=makeCar('lmh');
  car.lap=10;car.racecraft.state='RESET';car.racecraft.defenseUsed=true;
  const policy=applyPolicy(car,20),start=car.systems.energyMJ;
  expect(policy.combat).toBeTruthy();
  expect(policy.mode).toBe(ENERGY_POLICY.ATTACK);
  stepSystems(car,FIXED_DT);
  expect(car.systems.energyDeploy).toBeGreaterThan(.9);
  expect(car.systems.energyMJ).toBeLessThan(start);
});

test('ENERGY-STRAT-07: non-hybrid classes remain policy-neutral',()=>{
  const car=makeCar('gt');
  car.lap=19;car.racecraft.state='COMMIT';car.cautionNoPass=true;
  const policy=applyPolicy(car,20);
  expect(policy.mode).toBe(ENERGY_POLICY.NONE);
  expect(policy.deployAllowed).toBeFalsy();
  stepSystems(car,FIXED_DT);
  expect(car.systems.energyPolicyMode).toBe('NONE');
  expect(car.systems.energyMJ).toBe(0);
});

test('ENERGY-STRAT-08: normal race strategy publishes the energy policy alongside pit strategy',()=>{
  const car=makeCar('formula');
  car.lap=3;
  const strategy=evaluatePitStrategy(car,createTrack(),20,null);
  expect(strategy.energy.mode).toBe(ENERGY_POLICY.BALANCED);
  expect(strategy.energy.remainingLaps).toBe(strategy.remainingLaps);
  expect(strategy.energy.soc).toBeGreaterThan(0);
  expect(strategy.service).toBeTruthy();
});
