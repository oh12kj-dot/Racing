import {test,expect} from '@playwright/test';
import {createRaceSimulation} from '../src/simulation/race.js';
import {FIXED_DT} from '../src/config.js';

function run(sim,seconds){
  for(let i=0;i<Math.round(seconds/FIXED_DT);i++)sim.update(FIXED_DT);
}

test('START-01: healthy rear-grid cars do not become stationary hazards after lights out',()=>{
  const sim=createRaceSimulation();
  run(sim,6.0);
  const snap=sim.snapshot();
  const healthyLaunchCars=snap.cars.filter(car=>car.lap<0&&!car.retired&&!car.systems?.failed);
  const falseHazards=healthyLaunchCars.filter(car=>car.racecraft?.state==='SPECIAL'&&(car.incident?.spinTimer??0)<=.2);
  const stopped=healthyLaunchCars.filter(car=>car.v<1);

  expect(falseHazards.map(car=>car.id)).toEqual([]);
  expect(stopped.map(car=>car.id)).toEqual([]);
  expect(snap.diagnostics.finite).toBeTruthy();
});
