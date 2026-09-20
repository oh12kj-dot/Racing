import {test,expect} from '@playwright/test';
import {createRaceSimulation} from '../src/simulation/race.js';
import {FIXED_DT} from '../src/config.js';

test('SESSION-START: initial classification follows the physical grid before the start line',()=>{
  const sim=createRaceSimulation(0x5151,{raceLaps:3});
  const snap=sim.snapshot();
  expect(snap.lap).toBe(0);
  expect(snap.order.map(c=>c.id)).toEqual(sim.cars.map(c=>c.id));
  expect(sim.cars.every(c=>c.lap===-1&&c.totalProgress<0)).toBeTruthy();
  for(let i=1;i<sim.cars.length;i++){
    expect(sim.cars[i-1].totalProgress).toBeGreaterThan(sim.cars[i].totalProgress);
    expect(sim.cars[i-1].totalProgress-sim.cars[i].totalProgress).toBeGreaterThan(6);
  }
});

test('SESSION-LAPS: first line crossing starts lap one; the next crossing completes a one-lap race',()=>{
  const sim=createRaceSimulation(0x5252,{raceLaps:1});
  for(const c of sim.cars.slice(1))c.retired=true;
  for(let i=0;i<Math.round(4/FIXED_DT);i++)sim.update(FIXED_DT);

  const car=sim.cars[0],track=sim.track;
  car.finished=false;car.pit.served=true;car.pit.requested=false;car.pit.phase='TRACK';car.incident.spinTimer=0;
  car.s=track.total-.05;car.lastS=car.s;car.lap=-1;car.totalProgress=-.05;car.v=25;
  sim.update(FIXED_DT);
  expect(car.lap).toBe(0);
  expect(car.finished).toBeFalsy();
  expect(sim.snapshot().lap).toBe(1);
  expect(car.totalProgress).toBeGreaterThanOrEqual(0);
  expect(car.totalProgress).toBeLessThan(2);

  car.s=track.total-.05;car.lastS=car.s;car.lap=0;car.totalProgress=track.total-.05;car.v=25;
  sim.update(FIXED_DT);
  expect(car.lap).toBe(1);
  expect(car.finished).toBeTruthy();
  expect(sim.snapshot().winnerId).toBe(car.id);
});

test('SESSION-WRAP: a car just after the line ranks ahead of a car just before it',()=>{
  const sim=createRaceSimulation(0x5353,{raceLaps:4}),track=sim.track;
  for(const c of sim.cars.slice(2))c.retired=true;
  const ahead=sim.cars[0],behind=sim.cars[1];
  ahead.lap=0;ahead.s=.5;ahead.totalProgress=.5;
  behind.lap=-1;behind.s=track.total-.2;behind.totalProgress=-.2;
  const order=sim.snapshot().order.filter(c=>!c.retired);
  expect(order[0].id).toBe(ahead.id);
  expect(order[1].id).toBe(behind.id);
});
