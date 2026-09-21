import {test,expect} from '@playwright/test';
import {buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {planRacecraft} from '../src/simulation/racecraft.js';
import {createRaceControl} from '../src/simulation/race-control.js';

function car(entry,s,v,lane=0){
  const c=createVehicleState(entry,s,0);
  c.v=v;c.lane=lane;c.totalProgress=s;c.pit.phase='TRACK';
  return c;
}

test('RACECRAFT-CAUTION-01: caution cancels attack/defence lane moves without inventing a racecraft speed cap',()=>{
  const track=createTrack(),entries=buildEntrants();
  const fast=car(entries[0],100,52,0),slow=car(entries.find(e=>e.type==='gt'),130,36,0);
  fast.cautionNoPass=true;
  const plan=planRacecraft(fast,[fast,slow],track,20);
  expect(plan.targetLane).toBeCloseTo(fast.lane,9);
  expect(plan.state).toBe('CAUTION');
  expect(plan.reason).not.toMatch(/ATTACK|PASS_COMMIT|DEFEND/);
  expect(plan.targetSpeed).toBe(Infinity);
});

test('RACECRAFT-CAUTION-02: a moving incident still has priority over the no-passing lane hold',()=>{
  const track=createTrack(),entries=buildEntrants();
  const follower=car(entries[0],100,42,0),hazard=car(entries[1],122,8,0);
  follower.cautionNoPass=true;
  hazard.incident.spinTimer=2;hazard.yawRate=1.4;hazard.laneV=1.5;
  const plan=planRacecraft(follower,[follower,hazard],track,20);
  expect(plan.reason).toMatch(/^HAZARD_/);
  expect(plan.state).toBe('SPECIAL');
});

test('RACECRAFT-CAUTION-03: race control publishes and clears the no-passing restriction with the flag',()=>{
  const track=createTrack(),entries=buildEntrants();
  const cars=[car(entries[0],500,28),car(entries[1],460,26)];
  const rc=createRaceControl();
  cars[0].incident.spinTimer=2;cars[0].yawRate=1.1;
  rc.update(20,cars,track);
  expect(rc.flag).toBe('YELLOW');
  expect(cars.every(c=>c.cautionNoPass===true)).toBeTruthy();
  const clearAt=rc.cautionUntil;
  cars[0].incident.spinTimer=0;cars[0].yawRate=0;
  rc.update(clearAt+.1,cars,track);
  expect(rc.flag).toBe('GREEN');
  expect(cars.every(c=>c.cautionNoPass===false)).toBeTruthy();
});
