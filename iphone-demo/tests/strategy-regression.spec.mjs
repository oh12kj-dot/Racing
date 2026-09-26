import {test,expect} from '@playwright/test';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {evaluatePitStrategy,PIT_REASON} from '../src/simulation/strategy.js';
import {buildEntrants} from '../src/config.js';

test('STRATEGY: residual repaired damage does not immediately request another stop',()=>{
  const car=createVehicleState(buildEntrants()[0],100,3),track=createTrack();
  car.pit.served=true;
  car.pit.lastServiceDamage=.55;
  car.incident.damage=.55;
  let decision=evaluatePitStrategy(car,track,8);
  expect(decision.request).toBeFalsy();
  expect(decision.reason).toBe(PIT_REASON.NONE);

  car.incident.damage=.70;
  decision=evaluatePitStrategy(car,track,8);
  expect(decision.request).toBeTruthy();
  expect(decision.reason).toBe(PIT_REASON.DAMAGE);
});

test('STRATEGY: existing stop opportunistically repairs meaningful minor damage',()=>{
  const car=createVehicleState(buildEntrants()[0],100,2),track=createTrack();
  car.pit.plannedLap=2;
  car.incident.damage=.12;
  let decision=evaluatePitStrategy(car,track,8);
  expect(decision.request).toBeTruthy();
  expect(decision.reason).toBe(PIT_REASON.PLANNED);
  expect(decision.service.repair).toBeTruthy();

  car.incident.damage=.08;
  decision=evaluatePitStrategy(car,track,8);
  expect(decision.request).toBeTruthy();
  expect(decision.reason).toBe(PIT_REASON.PLANNED);
  expect(decision.service.repair).toBeFalsy();
});

test('STRATEGY: remaining laps follows the authoritative current-lap index',()=>{
  const car=createVehicleState(buildEntrants()[0],100,-1),track=createTrack();
  expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(8);
  car.lap=0;expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(8);
  car.lap=1;expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(7);
  car.lap=7;expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(1);
  car.lap=8;expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(0);
});

test('STRATEGY: fuel projection follows fractional remaining distance within the current lap',()=>{
  const track={total:10000,wrapS(s){return((s%this.total)+this.total)%this.total;}};
  const car=createVehicleState(buildEntrants()[0],7500,2);
  car.pit.served=true;
  car.systems.fuel=20.5;

  let decision=evaluatePitStrategy(car,track,8);
  const expectedLate=car.systems.burnPerKm*(track.total/1000)*5.25*1.08;
  expect(decision.remainingLaps).toBe(6);
  expect(decision.remainingDistanceLaps).toBeCloseTo(5.25,6);
  expect(decision.projectedFuel).toBeCloseTo(expectedLate,6);
  expect(decision.projectedFuel).toBeLessThan(car.systems.fuel);
  expect(decision.reason).toBe(PIT_REASON.NONE);
  expect(decision.request).toBeFalsy();

  car.s=1000;
  decision=evaluatePitStrategy(car,track,8);
  const expectedEarly=car.systems.burnPerKm*(track.total/1000)*5.9*1.08;
  expect(decision.remainingDistanceLaps).toBeCloseTo(5.9,6);
  expect(decision.projectedFuel).toBeCloseTo(expectedEarly,6);
  expect(decision.projectedFuel).toBeGreaterThan(car.systems.fuel);
  expect(decision.reason).toBe(PIT_REASON.FUEL);
  expect(decision.request).toBeTruthy();
});
