import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState,stepVehicle} from '../src/simulation/vehicle.js';
import {createRaceSimulation} from '../src/simulation/race.js';
import {planRacecraft} from '../src/simulation/racecraft.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('AUTH/RC-09: controller emits steering and vehicle physics owns lateral acceleration',()=>{
  const raceSrc=fs.readFileSync(path.join(root,'src/simulation/race.js'),'utf8');
  const vehicleSrc=fs.readFileSync(path.join(root,'src/simulation/vehicle.js'),'utf8');
  expect(raceSrc).not.toMatch(/laneAccel/);
  expect(vehicleSrc).not.toMatch(/control\.laneAccel/);

  const track=createTrack(),car=createVehicleState(buildEntrants()[0],120,0);
  car.v=50;
  let previous=car.steer;
  for(let i=0;i<18;i++){
    stepVehicle(car,track,{throttle:0,brake:0,steer:car.spec.maxSteer},FIXED_DT);
    const rate=Math.abs(car.steer-previous)/FIXED_DT;
    expect(rate).toBeLessThanOrEqual(car.spec.steerRate+1e-8);
    previous=car.steer;
  }
  expect(car.steer).toBeGreaterThan(0);
  expect(car.laneA).toBeGreaterThan(0);
  expect(car.diagnostics.maxSteerRate).toBeLessThanOrEqual(car.spec.steerRate+1e-8);
  expect(car.diagnostics.maxForceUsage).toBeLessThanOrEqual(1.000001);
});

test('PHY-03: full braking is progressive without a one-frame velocity clamp',()=>{
  const physicalTrack=createTrack();
  // PHY-03 isolates longitudinal braking. The production circuit is curved at
  // s=300, so use a zero-curvature fixture here; combined corner/brake demand is
  // covered separately by PHY-04/PHY-04A.
  const track={...physicalTrack,curvature:()=>0};
  const entry=buildEntrants().find(e=>e.type==='gt');
  const car=createVehicleState(entry,300,0);car.v=65;
  const speeds=[car.v];
  for(let i=0;i<90;i++){
    stepVehicle(car,track,{throttle:0,brake:1,steer:0},FIXED_DT);
    speeds.push(car.v);
  }
  for(let i=1;i<speeds.length;i++){
    expect(speeds[i]).toBeLessThanOrEqual(speeds[i-1]+1e-9);
    expect(speeds[i-1]-speeds[i]).toBeLessThan((car.spec.brake+2.5)*FIXED_DT);
  }
  expect(speeds.at(-1)).toBeLessThan(42);
  expect(speeds.at(-1)).toBeGreaterThan(30);
});

test('COL-01: 100 representative car-car contacts remain finite and bounded',()=>{
  const sim=createRaceSimulation(0x9911,{raceLaps:200});
  const [a,b,...rest]=sim.cars;for(const c of rest)c.retired=true;
  a.lap=0;b.lap=0;
  for(let n=0;n<100;n++){
    a.s=200;b.s=201;a.lane=0;b.lane=0;a.v=48;b.v=24;a.retired=false;b.retired=false;
    sim.update(FIXED_DT);
    let snap=sim.snapshot();
    expect(snap.diagnostics.finite).toBeTruthy();
    expect(Math.max(a.v,b.v)).toBeLessThan(80);
    a.s=200;b.s=230;a.lane=0;b.lane=0;a.v=32;b.v=32;
    sim.update(FIXED_DT);
    snap=sim.snapshot();expect(snap.diagnostics.finite).toBeTruthy();
  }
  expect(sim.snapshot().diagnostics.contacts).toBeGreaterThanOrEqual(100);
});

test('COL-03/COL-04: incident state survives ideal-line planning and traffic reacts to the hazard',()=>{
  const sim=createRaceSimulation(0x9922,{raceLaps:50});
  for(let i=0;i<Math.round(4/FIXED_DT);i++)sim.update(FIXED_DT);
  const victim=sim.cars[5];victim.s=500;victim.lane=4.8;victim.v=32;victim.incident.spinTimer=2;
  sim.update(FIXED_DT);
  expect(victim.incident.spinTimer).toBeGreaterThan(1.9);
  expect(Math.abs(victim.targetLane)).toBeGreaterThan(3.5);

  const track=createTrack(),entries=buildEntrants();
  const follower=createVehicleState(entries[0],100,0),hazard=createVehicleState(entries[1],132,0);
  follower.v=55;hazard.v=0;follower.lane=0;hazard.lane=0;hazard.incident.spinTimer=2;
  const plan=planRacecraft(follower,[follower,hazard],track,20);
  expect(['HAZARD_EVADE','HAZARD_BRAKE']).toContain(plan.reason);
  expect(Number.isFinite(plan.targetSpeed)?plan.targetSpeed:follower.v).toBeLessThanOrEqual(follower.v);
});

test('COL-05: exceptional barrier recovery increments diagnostics without progress teleport',()=>{
  const track=createTrack(),car=createVehicleState(buildEntrants()[0],700,0);
  car.v=30;car.lane=12;
  const before=car.s;
  stepVehicle(car,track,{throttle:0,brake:0,steer:0},FIXED_DT);
  expect(car.diagnostics.recoveries).toBe(1);
  expect(Math.abs(track.signedDistance(before,car.s))).toBeLessThan(1);
  expect(Math.abs(car.lane)).toBeLessThan(7);
  expect([car.s,car.v,car.lane,car.laneV,car.yaw,car.steer].every(Number.isFinite)).toBeTruthy();
});
