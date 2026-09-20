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
function field(count=3){
  const track=createTrack(),entries=buildEntrants();
  const cars=entries.slice(0,count).map((entry,i)=>{
    const car=createVehicleState(entry,500-i*35,0);
    car.v=32;car.totalProgress=car.s;car.pit.phase='TRACK';
    return car;
  });
  return{track,cars};
}

test('RACE-06: race control is the sole caution authority and never writes vehicle pose/speed',()=>{
  const src=fs.readFileSync(path.join(root,'src/simulation/race-control.js'),'utf8');
  expect(src).not.toMatch(/\.(?:s|lane|v)\s*=/);
  expect(src).toContain("flag:'GREEN'");
  expect(src).toContain("'VSC'");
  expect(src).toContain("'SAFETY_CAR'");
});

test('RACE-07: a moving spin remains yellow and clears only after the minimum caution time',()=>{
  const {track,cars}=field(2),rc=createRaceControl();
  cars[0].incident.spinTimer=2;cars[0].v=24;
  rc.update(20,cars,track);
  expect(rc.flag).toBe('YELLOW');
  const clearAt=rc.cautionUntil;
  cars[0].incident.spinTimer=0;
  rc.update(clearAt-.1,cars,track);expect(rc.flag).toBe('YELLOW');
  rc.update(clearAt+.1,cars,track);expect(rc.flag).toBe('GREEN');
});

test('RACE-08: a stopped car triggers VSC without artificially bunching the running field',()=>{
  const {track,cars}=field(3),rc=createRaceControl();
  const incident=cars[1];
  incident.v=0;incident.incident.damage=.2;
  rc.update(20,cars,track);
  expect(rc.flag).toBe('VSC');
  const running=cars.filter(car=>car!==incident);
  const targets=running.map(car=>rc.targetFor(car,cars,track));
  expect(new Set(targets).size).toBe(1);
  expect(targets[0]).toBe(28);
  expect(rc.targetFor(incident,cars,track)).toBeLessThan(targets[0]);
  expect(rc.isCaution()).toBeTruthy();
});

test('RACE-09: severe hazards escalate to safety car and catch-up ignores the incident car',()=>{
  const {track,cars}=field(3),rc=createRaceControl();
  const [ahead,behind,incident]=cars;
  ahead.v=22;ahead.totalProgress=520;ahead.s=520;
  behind.v=22;behind.totalProgress=400;behind.s=400;
  incident.totalProgress=470;incident.s=470;incident.v=0;incident.incident.damage=.7;
  rc.update(20,cars,track);
  expect(rc.flag).toBe('SAFETY_CAR');
  expect(rc.queueCars(cars)).not.toContain(incident);

  const farTarget=rc.targetFor(behind,cars,track);
  behind.totalProgress=503;behind.s=503;
  const nearTarget=rc.targetFor(behind,cars,track);
  expect(farTarget).toBeGreaterThan(nearTarget);
  expect(farTarget).toBeLessThanOrEqual(27);
  expect(nearTarget).toBeGreaterThanOrEqual(7);
  expect(rc.targetFor(incident,cars,track)).toBe(8);
});

test('RACE-10: safety-car activation changes targets but never teleports the field',()=>{
  const sim=createRaceSimulation(0x6ca7,{raceLaps:40});
  for(let i=0;i<Math.round(14/FIXED_DT);i++)sim.update(FIXED_DT);
  const victim=sim.cars.find(c=>!c.retired&&!c.finished&&c.pit.phase==='TRACK');
  victim.lap=Math.max(0,victim.lap);victim.v=0;victim.incident.damage=.7;victim.incident.spinTimer=0;
  const before=sim.cars.map(c=>({s:c.s,v:c.v}));
  sim.update(FIXED_DT);
  const snap=sim.snapshot();
  expect(snap.flag).toBe('SAFETY_CAR');
  for(let i=0;i<sim.cars.length;i++){
    const moved=Math.abs(sim.track.signedDistance(before[i].s,sim.cars[i].s));
    expect(moved).toBeLessThan(Math.max(2,before[i].v*FIXED_DT*1.7+1));
  }
  const controlled=sim.cars.find(c=>c!==victim&&!c.retired&&!c.finished&&c.pit.phase==='TRACK');
  expect(controlled.controlSource).toBe('SAFETY_CAR_CONTROL');
  expect(controlled.targetSpeed).toBeLessThanOrEqual(27);
});

test('RACE-11: identical hazards produce identical deterministic race-control state',()=>{
  const a=field(3),b=field(3),ra=createRaceControl(),rb=createRaceControl();
  a.cars[1].v=0;b.cars[1].v=0;
  a.cars[1].incident.damage=.2;b.cars[1].incident.damage=.2;
  for(const t of [20,21,25,30]){ra.update(t,a.cars,a.track);rb.update(t,b.cars,b.track);}
  expect({flag:ra.flag,until:ra.cautionUntil,id:ra.incidentId}).toEqual({flag:rb.flag,until:rb.cautionUntil,id:rb.incidentId});
});
