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

test('STRATEGY: remaining laps follows the authoritative current-lap index',()=>{
  const car=createVehicleState(buildEntrants()[0],100,-1),track=createTrack();
  expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(8);
  car.lap=0;expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(8);
  car.lap=1;expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(7);
  car.lap=7;expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(1);
  car.lap=8;expect(evaluatePitStrategy(car,track,8).remainingLaps).toBe(0);
});
