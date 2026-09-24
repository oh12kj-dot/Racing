import {test,expect} from '@playwright/test';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {planRacecraft} from '../src/simulation/racecraft.js';
import {planPit} from '../src/simulation/pit.js';
import {createRaceSimulation} from '../src/simulation/race.js';
import {buildEntrants,FIXED_DT} from '../src/config.js';

test('RACECRAFT: finished cars are not treated as live traffic',()=>{
  const track=createTrack(),entries=buildEntrants();
  const follower=createVehicleState(entries[0],100,1),finished=createVehicleState(entries[1],110,1);
  follower.v=42;follower.lane=0;
  finished.v=0;finished.lane=0;finished.finished=true;
  const plan=planRacecraft(follower,[follower,finished],track,20);
  expect(plan.reason).toBe('RACING_LINE');
  expect(plan.targetSpeed).toBe(Infinity);
});

test('RACECRAFT: a PIT_APPROACH car remains live traffic until it enters the separated pit corridor',()=>{
  const track=createTrack(),entries=buildEntrants();
  const follower=createVehicleState(entries[6],100,1),pitting=createVehicleState(entries[7],114,1);
  follower.v=49;follower.lane=0;
  pitting.v=39;pitting.lane=.8;pitting.pit.phase='PIT_APPROACH';
  const plan=planRacecraft(follower,[follower,pitting],track,20);
  expect(plan.reason).toBe('TRAFFIC_FOLLOW');
  expect(plan.targetSpeed).toBeLessThan(follower.v);
  expect(plan.state).not.toBe('SETUP');
});

test('PIT: every team owns a distinct box and the final team remains inside pit lane',()=>{
  const track=createTrack(),entries=buildEntrants();
  const first=createVehicleState(entries.find(e=>e.teamId===0),track.pit.boxStart-150,1);
  const last=createVehicleState(entries.find(e=>e.teamId===12),track.pit.boxStart-150,1);
  first.pit.phase='FAST_LANE';last.pit.phase='FAST_LANE';
  planPit(first,[first,last],track,FIXED_DT);
  planPit(last,[first,last],track,FIXED_DT);
  expect(last.pit.boxS).not.toBe(first.pit.boxS);
  expect(last.pit.boxS).toBeGreaterThan(first.pit.boxS);
  expect(last.pit.boxS).toBeLessThan(track.pit.exitStart);
});

test('PIT: retired same-team queue car cannot block the active car forever',()=>{
  const track=createTrack(),entries=buildEntrants();
  const active=createVehicleState(entries[0],track.pit.boxStart-8,2);
  const inactive=createVehicleState(entries[1],track.pit.boxStart-8,2);
  active.pit.phase='QUEUE';active.pit.boxS=track.pit.boxStart;
  inactive.pit.phase='QUEUE';inactive.pit.boxS=track.pit.boxStart;inactive.retired=true;
  planPit(active,[active,inactive],track,FIXED_DT);
  expect(active.pit.phase).toBe('WORKING_APPROACH');
});

test('RACE: finish requires completed race distance and a physically completed pit sequence',()=>{
  const sim=createRaceSimulation(0x9090,{raceLaps:1});
  for(const c of sim.cars.slice(1))c.retired=true;
  for(let i=0;i<Math.round(5/FIXED_DT);i++)sim.update(FIXED_DT);
  const car=sim.cars[0];

  car.lap=0;car.pit.served=true;car.pit.phase='TRACK';
  sim.update(FIXED_DT);
  expect(car.finished).toBeFalsy();

  car.lap=1;car.pit.phase='SERVICE';car.pit.serviceTimer=100;
  sim.update(FIXED_DT);
  expect(car.finished).toBeFalsy();

  car.pit.phase='TRACK';
  sim.update(FIXED_DT);
  expect(car.finished).toBeTruthy();
});
