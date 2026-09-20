import {test,expect} from '@playwright/test';
import {FIXED_DT} from '../src/config.js';
import {createRaceSimulation} from '../src/simulation/race.js';

test('RED-10: normal dry race and pit cycles do not falsely escalate to red',()=>{
  const sim=createRaceSimulation(0x51afe,{raceLaps:80});
  let sawRed=false;
  for(let i=0;i<Math.round(180/FIXED_DT);i++){
    sim.update(FIXED_DT);
    if(sim.raceControl.flag==='RED')sawRed=true;
  }
  expect(sim.snapshot().diagnostics.finite).toBeTruthy();
  expect(sawRed).toBeFalsy();
  expect(sim.events.some(event=>event.type==='RED')).toBeFalsy();
});
