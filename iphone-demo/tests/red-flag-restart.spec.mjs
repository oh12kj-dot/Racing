import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {createRaceControl} from '../src/simulation/race-control.js';
import {createRaceSimulation} from '../src/simulation/race.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function field(count=6){
  const track=createTrack(),entries=buildEntrants();
  const cars=entries.slice(0,count).map((entry,i)=>{
    const s=600-i*35,car=createVehicleState(entry,s,0);
    car.v=32;car.totalProgress=s;car.pit.phase='TRACK';
    return car;
  });
  return{track,cars};
}
function makeBlocked(cars){
  for(let i=0;i<3;i++){
    const car=cars[i];
    car.s=500+i*10;car.totalProgress=car.s;car.lane=-3+i*3;car.v=0;car.incident.damage=.22;
  }
  return cars.slice(0,3);
}

test('RED-01: race control owns RED without writing vehicle pose, lane or velocity',()=>{
  const src=fs.readFileSync(path.join(root,'src/simulation/race-control.js'),'utf8');
  expect(src).not.toMatch(/\.(?:s|lane|v)\s*=/);
  expect(src).toContain("'RED'");
  expect(src).toContain("restartPhase:'NONE'");
});

test('RED-02: a physically blocked track escalates above safety car to RED',()=>{
  const {track,cars}=field(),rc=createRaceControl(),blocked=makeBlocked(cars);
  rc.update(20,cars,track);
  expect(rc.flag).toBe('RED');
  expect(rc.restartPhase).toBe('RED_STOP');
  expect(new Set(rc.incidentIds)).toEqual(new Set(blocked.map(c=>c.id)));
  for(const car of cars)expect(rc.targetFor(car,cars,track)).toBe(0);
});

test('RED-03: extreme visibility can trigger RED without inventing an incident car',()=>{
  const {track,cars}=field(4),rc=createRaceControl();
  rc.update(20,cars,track,undefined,{visibility:.35});
  expect(rc.flag).toBe('RED');
  expect(rc.incidentIds).toEqual([]);
  expect(rc.incidentId).toBeNull();
});

test('RED-04: cars stopped by RED are not reclassified as new hazards and restart proceeds through safety car',()=>{
  const {track,cars}=field(4),rc=createRaceControl();
  rc.update(20,cars,track,undefined,{visibility:.35});
  expect(rc.flag).toBe('RED');
  for(const car of cars)car.v=0;
  rc.update(29,cars,track,undefined,{visibility:1});
  expect(rc.flag).toBe('SAFETY_CAR');
  expect(rc.restartPhase).toBe('SC_FORMATION');
  rc.update(43.1,cars,track,undefined,{visibility:1});
  expect(rc.flag).toBe('GREEN');
  expect(rc.restartPhase).toBe('NONE');
});

test('RED-05: restart cannot go green until the safety-car queue has physically formed',()=>{
  const {track,cars}=field(5),rc=createRaceControl();
  rc.update(20,cars,track,undefined,{visibility:.35});
  for(let i=0;i<cars.length;i++){
    cars[i].v=0;cars[i].s=700-i*100;cars[i].totalProgress=cars[i].s;
  }
  rc.update(29,cars,track,undefined,{visibility:1});
  expect(rc.flag).toBe('SAFETY_CAR');
  rc.update(44,cars,track,undefined,{visibility:1});
  expect(rc.flag).toBe('SAFETY_CAR');
  for(let i=0;i<cars.length;i++){
    cars[i].s=700-i*25;cars[i].totalProgress=cars[i].s;
  }
  rc.update(45,cars,track,undefined,{visibility:1});
  expect(rc.flag).toBe('GREEN');
});

test('RED-06: full simulation slows physically under RED and does not teleport the field',()=>{
  const sim=createRaceSimulation(0x5edf1a6,{raceLaps:40});
  for(let i=0;i<Math.round(14/FIXED_DT);i++)sim.update(FIXED_DT);
  const active=sim.cars.find(c=>!c.retired&&!c.finished&&c.pit.phase==='TRACK'&&c.v>20);
  expect(active).toBeTruthy();
  const before=sim.cars.map(c=>({s:c.s,v:c.v,lane:c.lane}));
  sim.environment.wetness=1;sim.environment.rainRate=1;
  sim.update(FIXED_DT);
  expect(sim.snapshot().flag).toBe('RED');
  expect(active.controlSource).toBe('RED_CONTROL');
  expect(active.targetSpeed).toBe(0);
  expect(active.targetLane).toBeCloseTo(active.lane,6);
  for(let i=0;i<sim.cars.length;i++){
    const moved=Math.abs(sim.track.signedDistance(before[i].s,sim.cars[i].s));
    expect(moved).toBeLessThan(Math.max(2,before[i].v*FIXED_DT*1.8+1));
  }
  for(let i=0;i<Math.round(8/FIXED_DT);i++)sim.update(FIXED_DT);
  expect(sim.cars.filter(c=>!c.retired&&!c.finished).every(c=>c.v<2.2)).toBeTruthy();
});

test('RED-07: red-flag incident recovery is explicit, counted and does not advance the removed cars',()=>{
  const sim=createRaceSimulation(0x7edc0de,{raceLaps:40});
  for(let i=0;i<Math.round(14/FIXED_DT);i++)sim.update(FIXED_DT);
  const incidents=sim.cars.filter(c=>!c.retired&&!c.finished&&c.pit.phase==='TRACK').slice(0,3);
  for(const car of incidents){car.v=0;car.incident.damage=.22;}
  const progress=incidents.map(c=>c.totalProgress);
  sim.raceControl.transition('RED',sim.snapshot().time,incidents[0],undefined,incidents.map(c=>c.id));
  sim.raceControl.restartPhase='RED_STOP';
  for(let i=0;i<Math.round(6.5/FIXED_DT);i++)sim.update(FIXED_DT);
  for(let i=0;i<incidents.length;i++){
    expect(incidents[i].retired).toBeTruthy();
    expect(incidents[i].diagnostics.recoveries).toBeGreaterThanOrEqual(1);
    expect(incidents[i].totalProgress-progress[i]).toBeLessThan(1);
  }
  expect(sim.events.filter(e=>e.type==='RECOVERY_RETIRE').length).toBeGreaterThanOrEqual(3);
});

test('RED-08: identical severe-weather red procedures remain deterministic in authoritative state',()=>{
  const a=createRaceSimulation(0x8ed5eed,{raceLaps:40}),b=createRaceSimulation(0x8ed5eed,{raceLaps:40});
  for(let i=0;i<Math.round(14/FIXED_DT);i++){a.update(FIXED_DT);b.update(FIXED_DT);}
  for(const sim of [a,b]){sim.environment.wetness=1;sim.environment.rainRate=1;}
  for(let i=0;i<Math.round(5/FIXED_DT);i++){a.update(FIXED_DT);b.update(FIXED_DT);}
  expect(a.snapshot().flag).toBe('RED');
  expect(a.snapshot().restartPhase).toBe('RED_STOP');
  expect(a.stateHash()).toBe(b.stateHash());
});
