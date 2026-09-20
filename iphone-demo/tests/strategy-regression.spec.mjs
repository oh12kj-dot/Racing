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
