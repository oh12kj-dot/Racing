import {test,expect} from '@playwright/test';
import {createRaceSimulation} from '../src/simulation/race.js';
import {FIXED_DT} from '../src/config.js';

test('RACE-02: only physical start-line passage increments lap across traffic, pit and incident states',()=>{
  const sim=createRaceSimulation(0x6201,{raceLaps:10}),track=sim.track;
  for(const c of sim.cars.slice(3))c.retired=true;
  for(let i=0;i<Math.round(4/FIXED_DT);i++)sim.update(FIXED_DT);
  const [normal,pitCar,incident]=sim.cars;

  normal.lap=0;normal.s=track.total-.12;normal.lastS=normal.s;normal.totalProgress=track.total-.12;normal.v=24;normal.pit.served=true;normal.pit.phase='TRACK';
  pitCar.lap=1;pitCar.s=track.pit.boxStart-80;pitCar.lastS=pitCar.s;pitCar.totalProgress=track.total+pitCar.s;pitCar.v=18;pitCar.pit.requested=true;pitCar.pit.served=false;pitCar.pit.phase='FAST_LANE';pitCar.pit.boxS=track.pit.boxStart;
  incident.lap=1;incident.s=500;incident.lastS=incident.s;incident.totalProgress=track.total+500;incident.v=0;incident.incident.spinTimer=2;incident.pit.served=true;incident.pit.phase='TRACK';

  sim.update(FIXED_DT);
  expect(normal.lap).toBe(1);
  expect(pitCar.lap).toBe(1);
  expect(incident.lap).toBe(1);
  expect(normal.totalProgress).toBeGreaterThanOrEqual(track.total);
  expect(pitCar.totalProgress).toBeGreaterThan(track.total);
  expect(incident.totalProgress).toBe(track.total+500);
});

test('RACE-03: classification owns overall/class position, status, gaps, intervals and pit/timing outputs',()=>{
  const sim=createRaceSimulation(0x6202,{raceLaps:4}),track=sim.track;
  const [liveA,liveB,retired,finished,pitCar]=sim.cars;
  for(const c of sim.cars.slice(5))c.retired=true;

  finished.finished=true;finished.finishTime=100;finished.lap=4;finished.totalProgress=4*track.total+.2;finished.timing.bestLap=42.1;finished.timing.lastLap=42.4;
  liveA.lap=3;liveA.totalProgress=3*track.total+800;liveA.timing.bestLap=41.8;liveA.timing.lastLap=42.0;
  liveB.lap=3;liveB.totalProgress=3*track.total+760;liveB.timing.bestLap=43.0;liveB.timing.lastLap=43.2;
  retired.retired=true;retired.lap=3;retired.totalProgress=3*track.total+980;retired.timing.bestLap=44.0;
  pitCar.lap=2;pitCar.totalProgress=2*track.total+900;pitCar.pit.phase='SERVICE';pitCar.pit.completedStops=2;pitCar.timing.bestLap=45.0;

  const snap=sim.snapshot();
  const ids=snap.order.slice(0,5).map(c=>c.id);
  expect(ids).toEqual([finished.id,liveA.id,liveB.id,pitCar.id,retired.id]);

  const rows=new Map(snap.classification.map(r=>[r.carId,r]));
  expect(rows.get(finished.id).overallPosition).toBe(1);
  expect(rows.get(finished.id).status).toBe('FINISHED');
  expect(rows.get(liveA.id).overallPosition).toBe(2);
  expect(rows.get(liveB.id).overallPosition).toBe(3);
  expect(rows.get(pitCar.id).status).toBe('PIT');
  expect(rows.get(pitCar.id).pitStops).toBe(2);
  expect(rows.get(retired.id).status).toBe('RETIRED');
  expect(rows.get(retired.id).gapToLeaderMeters).toBeNull();

  const formulaRows=snap.classification.filter(r=>['11','12','13','14'].includes(sim.cars.find(c=>c.id===r.carId)?.number));
  expect(formulaRows.map(r=>r.classPosition)).toEqual([1,2,3,4]);
  expect(rows.get(liveB.id).intervalMeters).toBeCloseTo(40,6);
  expect(rows.get(liveA.id).gapToLeaderMeters).toBeGreaterThan(0);
  expect(rows.get(finished.id).completedLaps).toBe(4);
  expect(rows.get(liveA.id).currentLap).toBe(4);
  expect(snap.fastestLap).toEqual({carId:liveA.id,time:41.8});
});

test('RACE-03: finished competitors use finish-time gaps instead of synthetic distance gaps',()=>{
  const sim=createRaceSimulation(0x6203,{raceLaps:3}),track=sim.track;
  for(const c of sim.cars.slice(2))c.retired=true;
  const [winner,second]=sim.cars;
  winner.finished=true;winner.finishTime=90;winner.lap=3;winner.totalProgress=3*track.total+.3;
  second.finished=true;second.finishTime=92.75;second.lap=3;second.totalProgress=3*track.total+.8;
  const rows=new Map(sim.snapshot().classification.map(r=>[r.carId,r]));
  expect(rows.get(winner.id).gapToLeaderSeconds).toBe(0);
  expect(rows.get(second.id).gapToLeaderSeconds).toBeCloseTo(2.75,9);
  expect(rows.get(second.id).intervalSeconds).toBeCloseTo(2.75,9);
  expect(rows.get(second.id).gapToLeaderMeters).toBeNull();
});
