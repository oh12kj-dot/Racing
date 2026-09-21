import {test,expect} from '@playwright/test';
import {FIXED_DT} from '../src/config.js';
import {createRaceSimulation} from '../src/simulation/race.js';

const TAU=Math.PI*2;
const wrapAngle=a=>((a+Math.PI)%TAU+TAU)%TAU-Math.PI;

test('RED-10: normal dry race and pit cycles do not falsely escalate to red',()=>{
  const sim=createRaceSimulation(0x51afe,{raceLaps:80});
  let sawRed=false,firstRed=null;
  for(let i=0;i<Math.round(180/FIXED_DT);i++){
    sim.update(FIXED_DT);
    if(sim.raceControl.flag==='RED'){
      sawRed=true;
      if(!firstRed){
        const snap=sim.snapshot();
        firstRed={
          time:+snap.time.toFixed(3),
          incidentIds:[...sim.raceControl.incidentIds],
          cars:sim.raceControl.incidentIds.map(id=>{
            const car=sim.cars.find(c=>c.id===id);
            if(!car)return{id};
            const velocityHeading=sim.track.sample(car.s).heading+Math.atan2(car.laneV,Math.max(4,car.v));
            return{
              id:car.id,
              v:+car.v.toFixed(3),
              lane:+car.lane.toFixed(3),
              laneV:+car.laneV.toFixed(3),
              damage:+car.incident.damage.toFixed(3),
              spinTimer:+car.incident.spinTimer.toFixed(3),
              yawRate:+car.yawRate.toFixed(3),
              slipAngle:+(car.tyre?.slipAngle||0).toFixed(3),
              bodySlip:+Math.abs(wrapAngle(velocityHeading-car.yaw)).toFixed(3),
              source:car.controlSource
            };
          })
        };
      }
    }
  }
  expect(sim.snapshot().diagnostics.finite).toBeTruthy();
  expect(sawRed,firstRed?`false RED: ${JSON.stringify(firstRed)}`:'false RED').toBeFalsy();
  expect(sim.events.some(event=>event.type==='RED')).toBeFalsy();
});
