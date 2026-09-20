import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState,performanceFactors,stepVehicle} from '../src/simulation/vehicle.js';
import {stepSystems,serviceSystems} from '../src/simulation/systems.js';
import {evaluatePitStrategy,PIT_REASON} from '../src/simulation/strategy.js';
import {createRaceSimulation} from '../src/simulation/race.js';

function carOf(type='formula'){
  const entry=buildEntrants().find(e=>e.type===type);
  return createVehicleState(entry,120,0);
}

test('REL-01: a healthy car does not receive a random mechanical failure under sustained running',()=>{
  const car=carOf('formula');
  car.v=60;car.throttle=.92;car.brake=0;
  for(let i=0;i<Math.round(600/FIXED_DT);i++)stepSystems(car,FIXED_DT);
  expect(car.systems.failed).toBeFalsy();
  expect(car.systems.mechanicalStress).toBeLessThan(.08);
  expect(car.systems.powerDerate).toBeLessThan(.03);
});

test('REL-02: incident damage causally reduces aero, drive, steering response and top-speed capability',()=>{
  const car=carOf('gt');
  const healthy=performanceFactors(car);
  car.incident.damage=.72;
  const damaged=performanceFactors(car);
  expect(damaged.aero).toBeLessThan(healthy.aero);
  expect(damaged.drive).toBeLessThan(healthy.drive);
  expect(damaged.steering).toBeLessThan(healthy.steering);
  expect(damaged.top).toBeLessThan(healthy.top);
  expect(damaged.drag).toBeGreaterThan(healthy.drag);
});

test('REL-03: accumulated mechanical stress derates power and requests an engine service before failure',()=>{
  const car=carOf('proto'),track=createTrack();
  car.lap=2;car.systems.mechanicalStress=.56;car.systems.engineTemp=114;car.throttle=.7;car.v=52;
  stepSystems(car,FIXED_DT);
  const strategy=evaluatePitStrategy(car,track,20);
  expect(car.systems.failed).toBeFalsy();
  expect(car.systems.powerDerate).toBeGreaterThan(.12);
  expect(strategy.request).toBeTruthy();
  expect(strategy.reason).toBe(PIT_REASON.ENGINE);
  expect(strategy.service.cooling).toBeTruthy();
});

test('REL-04: overheat failure is deterministic and follows an explicit physical threshold',()=>{
  const healthy=carOf('hyper'),hot=carOf('hyper');
  healthy.v=50;healthy.throttle=1;
  hot.v=50;hot.throttle=1;hot.systems.engineTemp=133;
  stepSystems(healthy,FIXED_DT);stepSystems(hot,FIXED_DT);
  expect(healthy.systems.failed).toBeFalsy();
  expect(hot.systems.failed).toBeTruthy();
  expect(hot.systems.failureReason).toBe('OVERHEAT');
  expect(hot.systems.powerDerate).toBe(1);
});

test('REL-05: a failed power unit removes drive but vehicle motion remains physical',()=>{
  const car=carOf('formula'),track=createTrack();
  car.v=46;car.throttle=1;car.brake=0;car.systems.failed=true;car.systems.failureReason='MECHANICAL_STRESS';car.systems.powerDerate=1;
  const beforeS=car.s,beforeV=car.v;
  stepVehicle(car,track,{throttle:1,brake:0,steer:0},FIXED_DT);
  expect(car.v).toBeLessThan(beforeV);
  const moved=track.signedDistance(beforeS,car.s);
  expect(moved).toBeGreaterThan(0);
  expect(moved).toBeLessThan(beforeV*FIXED_DT*1.1+.1);
});

test('REL-06: service can cool and reduce stress but cannot resurrect a failed unit',()=>{
  const stressed=carOf('gt');
  stressed.systems.engineTemp=120;stressed.systems.mechanicalStress=.7;stressed.systems.powerDerate=.3;
  serviceSystems(stressed);
  expect(stressed.systems.engineTemp).toBeLessThanOrEqual(94);
  expect(stressed.systems.mechanicalStress).toBeCloseTo(.35,5);
  expect(stressed.systems.failed).toBeFalsy();

  const failed=carOf('gt');
  failed.systems.failed=true;failed.systems.failureReason='OVERHEAT';failed.systems.powerDerate=1;failed.systems.mechanicalStress=1;
  serviceSystems(failed);
  expect(failed.systems.failed).toBeTruthy();
  expect(failed.systems.powerDerate).toBe(1);
});

test('REL-07: full simulation failure coasts to retirement without teleporting or disappearing instantly',()=>{
  const sim=createRaceSimulation(0x7e11ab1e,{raceLaps:40});
  for(let i=0;i<Math.round(16/FIXED_DT);i++)sim.update(FIXED_DT);
  const car=sim.cars.find(c=>!c.retired&&!c.finished&&c.pit.phase==='TRACK'&&c.v>20);
  expect(car).toBeTruthy();
  car.systems.engineTemp=133;car.systems.mechanicalStress=.2;
  const startS=car.s,startProgress=car.totalProgress;
  sim.update(FIXED_DT);
  expect(car.systems.failed).toBeTruthy();
  expect(car.retired).toBeFalsy();
  expect(sim.events.some(e=>e.type==='MECHANICAL_FAILURE'&&e.carId===car.id)).toBeTruthy();

  let previousProgress=car.totalProgress;
  let maxFrameAdvance=0;
  for(let i=0;i<Math.round(25/FIXED_DT)&&!car.retired;i++){
    const previousS=car.s;
    sim.update(FIXED_DT);
    maxFrameAdvance=Math.max(maxFrameAdvance,Math.abs(sim.track.signedDistance(previousS,car.s)));
    expect(car.totalProgress+1e-6).toBeGreaterThanOrEqual(previousProgress);
    previousProgress=car.totalProgress;
  }
  expect(car.retired).toBeTruthy();
  expect(car.v).toBeLessThan(1.2);
  expect(maxFrameAdvance).toBeLessThan(2);
  expect(car.totalProgress).toBeGreaterThan(startProgress);
  expect(Math.abs(sim.track.signedDistance(startS,car.s))).toBeGreaterThan(.1);
});
