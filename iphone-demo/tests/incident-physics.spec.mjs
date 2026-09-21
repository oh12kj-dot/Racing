import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState,stepVehicle} from '../src/simulation/vehicle.js';
import {contactManifold,resolveContactImpulse} from '../src/simulation/contact.js';
import {createRaceControl} from '../src/simulation/race-control.js';
import {planRacecraft} from '../src/simulation/racecraft.js';
import {createRaceSimulation} from '../src/simulation/race.js';

function vehiclePair(){
  const track=createTrack(),entries=buildEntrants();
  const a=createVehicleState(entries[0],300,0),b=createVehicleState(entries[1],303,0);
  a.yaw=track.sample(a.s).heading;b.yaw=track.sample(b.s).heading;
  return{track,a,b};
}

function configureObliqueRace(sim){
  const [a,b,...rest]=sim.cars;
  for(const car of rest)car.retired=true;
  a.reaction=-10;b.reaction=-10;a.lap=0;b.lap=0;
  a.s=300;b.s=303;a.totalProgress=300;b.totalProgress=303;
  a.lane=-.3;b.lane=.3;a.laneV=3;b.laneV=-3;a.v=40;b.v=40;
  a.yaw=sim.track.sample(a.s).heading;b.yaw=sim.track.sample(b.s).heading;
  a.yawRate=0;b.yawRate=0;
  return[a,b];
}

function configureSoloRace(sim){
  const [car,...rest]=sim.cars;
  for(const other of rest)other.retired=true;
  car.reaction=-10;car.lap=0;car.s=300;car.totalProgress=300;
  car.lane=0;car.laneV=0;car.laneA=0;car.v=34;
  car.yaw=sim.track.sample(car.s).heading;car.yawRate=0;
  return car;
}

test('INC-01: active incident stabilises the current corridor without scripted lateral oscillation',()=>{
  const sim=createRaceSimulation(0x1ac1001,{raceLaps:40});
  const [car,...rest]=sim.cars;
  for(const other of rest)other.retired=true;
  car.reaction=-10;car.lap=0;car.s=300;car.totalProgress=300;
  car.lane=4.2;car.laneV=.8;car.v=34;car.yaw=sim.track.sample(car.s).heading;car.yawRate=.3;
  car.incident.spinTimer=.5;
  const laneBefore=car.lane,sBefore=car.s;
  sim.update(FIXED_DT);
  expect(car.controlSource).toBe('INCIDENT_SPIN');
  expect(car.targetLane).toBeCloseTo(laneBefore,9);
  expect(Math.abs(car.lane-laneBefore)).toBeLessThan(.12);
  expect(Math.abs(sim.track.signedDistance(sBefore,car.s))).toBeLessThan(1);
});

test('INC-02: oblique lateral impulse away from the centre of mass creates physical yaw rate',()=>{
  const {track,a,b}=vehiclePair();
  a.lane=-.3;b.lane=.3;a.laneV=3;b.laneV=-3;a.v=40;b.v=40;
  const contact=contactManifold(a,b,track);
  expect(contact.hit).toBeTruthy();
  expect(Math.abs(contact.normalLat)).toBeGreaterThan(.9);
  const response=resolveContactImpulse(a,b,contact);
  expect(response.applied).toBeTruthy();
  expect(response.impactImpulse).toBeGreaterThan(0);
  expect(Math.abs(response.deltaYawRateA)).toBeGreaterThan(.65);
  expect(Math.abs(response.deltaYawRateB)).toBeGreaterThan(.65);
  const yawBefore=a.yaw,rateBefore=Math.abs(a.yawRate);
  a.incident.spinTimer=2;a.incident.yawTransient=true;
  for(let i=0;i<30;i++)stepVehicle(a,track,{throttle:0,brake:.2,steer:0},FIXED_DT);
  expect(Math.abs(a.yaw-yawBefore)).toBeGreaterThan(.1);
  expect(Math.abs(a.yawRate)).toBeLessThan(rateBefore);
  expect([a.s,a.v,a.lane,a.laneV,a.yaw,a.yawRate].every(Number.isFinite)).toBeTruthy();
});

test('INC-03: door-to-door lateral contact at the centre station has no artificial yaw lever',()=>{
  const {track,a,b}=vehiclePair();
  a.s=300;b.s=300;a.lane=-.75;b.lane=.75;a.laneV=3;b.laneV=-3;a.v=42;b.v=42;
  const contact=contactManifold(a,b,track);
  expect(contact.hit).toBeTruthy();
  const response=resolveContactImpulse(a,b,contact);
  expect(response.applied).toBeTruthy();
  expect(Math.abs(response.deltaYawRateA)).toBeLessThan(1e-9);
  expect(Math.abs(response.deltaYawRateB)).toBeLessThan(1e-9);
});

test('INC-04: race contact triggers spin state from yaw impulse and vehicle physics advances the rotation',()=>{
  const sim=createRaceSimulation(0x1ac1004,{raceLaps:40});
  const [a,b]=configureObliqueRace(sim);
  sim.update(FIXED_DT);
  expect(sim.snapshot().diagnostics.contacts).toBe(1);
  const victim=Math.abs(a.yawRate)>=Math.abs(b.yawRate)?a:b;
  expect(victim.incident.spinTimer).toBeGreaterThan(1);
  expect(victim.incident.yawTransient).toBeTruthy();
  expect(Math.abs(victim.yawRate)).toBeGreaterThan(.65);
  const yawAfterImpact=victim.yaw;
  sim.update(FIXED_DT);
  expect(Math.abs(victim.yaw-yawAfterImpact)).toBeGreaterThan(.005);
  expect([victim.yaw,victim.yawRate,victim.incident.spinTimer].every(Number.isFinite)).toBeTruthy();
});

test('INC-05: authoritative hash includes angular velocity, yaw transient and spin state',()=>{
  const a=createRaceSimulation(0x1ac1005,{raceLaps:40});
  const b=createRaceSimulation(0x1ac1005,{raceLaps:40});
  expect(a.stateHash()).toBe(b.stateHash());
  b.cars[0].yawRate=.5;
  expect(a.stateHash()).not.toBe(b.stateHash());
  b.cars[0].yawRate=0;
  expect(a.stateHash()).toBe(b.stateHash());
  b.cars[0].incident.yawTransient=true;
  expect(a.stateHash()).not.toBe(b.stateHash());
  b.cars[0].incident.yawTransient=false;
  expect(a.stateHash()).toBe(b.stateHash());
  b.cars[0].incident.spinTimer=1;
  expect(a.stateHash()).not.toBe(b.stateHash());
});

test('INC-06: identical oblique incidents remain deterministic through physical yaw recovery',()=>{
  const a=createRaceSimulation(0x1ac1006,{raceLaps:40});
  const b=createRaceSimulation(0x1ac1006,{raceLaps:40});
  configureObliqueRace(a);configureObliqueRace(b);
  for(let i=0;i<180;i++){
    a.update(FIXED_DT);b.update(FIXED_DT);
    expect(a.stateHash()).toBe(b.stateHash());
  }
  expect(a.snapshot().diagnostics.finite).toBeTruthy();
  expect(b.snapshot().diagnostics.finite).toBeTruthy();
});

test('INC-07: overlap separation correction cannot manufacture crash yaw without closing speed',()=>{
  const {track,a,b}=vehiclePair();
  a.lane=-.3;b.lane=.3;a.laneV=0;b.laneV=0;a.v=40;b.v=40;a.yawRate=0;b.yawRate=0;
  const contact=contactManifold(a,b,track);
  expect(contact.hit).toBeTruthy();
  const response=resolveContactImpulse(a,b,contact);
  expect(response.applied).toBeTruthy();
  expect(response.impactSpeed).toBe(0);
  expect(response.impactImpulse).toBe(0);
  expect(response.separationImpulse).toBeGreaterThan(0);
  expect(response.deltaYawRateA).toBe(0);
  expect(response.deltaYawRateB).toBe(0);
});

test('INC-08: incident state cannot prescribe a synthetic lower target speed',()=>{
  const normal=createRaceSimulation(0x1ac1008,{raceLaps:40});
  const incident=createRaceSimulation(0x1ac1008,{raceLaps:40});
  const normalCar=configureSoloRace(normal),incidentCar=configureSoloRace(incident);
  incidentCar.incident.spinTimer=.5;
  incidentCar.yawTransient=true;
  incidentCar.yawRate=.2;
  normal.update(FIXED_DT);incident.update(FIXED_DT);
  expect(incidentCar.controlSource).toBe('INCIDENT_SPIN');
  expect(incidentCar.targetSpeed).toBeCloseTo(normalCar.targetSpeed,9);
  expect(incidentCar.targetSpeed).toBeGreaterThan(incidentCar.v*.8);
  expect(incidentCar.throttle).toBe(0);
});

test('INC-09: spin speed loss comes from body-slip tyre scrub rather than the incident timer itself',()=>{
  const track=createTrack(),entry=buildEntrants()[0];
  const aligned=createVehicleState(entry,300,0),sideways=createVehicleState(entry,300,0);
  const heading=track.sample(300).heading;
  for(const car of [aligned,sideways]){
    car.v=40;car.lane=0;car.laneV=0;car.laneA=0;car.yawRate=0;car.incident.spinTimer=1;car.incident.yawTransient=true;
  }
  aligned.yaw=heading;
  sideways.yaw=heading+Math.PI/2;
  stepVehicle(aligned,track,{throttle:0,brake:0,steer:0},FIXED_DT);
  stepVehicle(sideways,track,{throttle:0,brake:0,steer:0},FIXED_DT);
  expect(40-aligned.v).toBeLessThan(.05);
  expect(sideways.v).toBeLessThan(aligned.v-.05);
  expect(40-sideways.v).toBeLessThan(1);
});

test('INC-10: a recovered car is not kept under caution merely because spin time remains',()=>{
  const track=createTrack(),car=createVehicleState(buildEntrants()[0],500,0),rc=createRaceControl();
  car.v=24;car.lap=0;car.pit.phase='TRACK';car.incident.spinTimer=3;
  car.yawRate=.2;car.laneV=.3;car.tyre.slipAngle=.05;
  rc.update(20,[car],track);
  expect(rc.flag).toBe('GREEN');
  expect(rc.incidentIds).toEqual([]);
});

test('INC-11: race control still reacts to a physically unstable tagged incident',()=>{
  const track=createTrack(),car=createVehicleState(buildEntrants()[0],500,0),rc=createRaceControl();
  car.v=24;car.lap=0;car.pit.phase='TRACK';car.incident.spinTimer=3;
  car.yawRate=1.1;car.laneV=.3;car.tyre.slipAngle=.05;
  rc.update(20,[car],track);
  expect(rc.flag).toBe('YELLOW');
  expect(rc.incidentIds).toEqual([car.id]);
});

test('INC-12: following traffic evades a spinning car swept corridor instead of its current lane only',()=>{
  const track=createTrack(),entries=buildEntrants();
  const car=createVehicleState(entries[0],300,0),hazard=createVehicleState(entries[1],330,0);
  car.v=42;car.lane=0;car.yaw=track.sample(car.s).heading;car.totalProgress=car.s;
  hazard.v=8;hazard.lane=-1;hazard.laneV=3.2;hazard.yaw=track.sample(hazard.s).heading+Math.PI/2;
  hazard.incident.spinTimer=2;hazard.incident.yawTransient=true;hazard.totalProgress=hazard.s;
  const plan=planRacecraft(car,[car,hazard],track,20);
  expect(plan.reason).toBe('HAZARD_EVADE');
  expect(plan.targetLane).toBeLessThan(-4.5);
  expect(plan.targetSpeed).toBeLessThan(car.v);
  expect(plan.targetSpeed).toBeGreaterThanOrEqual(hazard.v);
});

test('INC-13: recoverable oblique contact creates a damped yaw transient without declaring a spin',()=>{
  const sim=createRaceSimulation(0x1ac1013,{raceLaps:40});
  const [a,b,...rest]=sim.cars;
  for(const car of rest)car.retired=true;
  a.reaction=-10;b.reaction=-10;a.lap=0;b.lap=0;
  a.s=300;b.s=303;a.totalProgress=300;b.totalProgress=303;
  a.lane=-.3;b.lane=.3;a.laneV=1;b.laneV=-1;a.v=40;b.v=40;
  a.yaw=sim.track.sample(a.s).heading;b.yaw=sim.track.sample(b.s).heading;a.yawRate=0;b.yawRate=0;
  sim.update(FIXED_DT);
  expect(sim.snapshot().diagnostics.contacts).toBe(1);
  expect(a.incident.spinTimer).toBe(0);
  expect(b.incident.spinTimer).toBe(0);
  const victim=Math.abs(a.yawRate)>=Math.abs(b.yawRate)?a:b;
  const other=victim===a?b:a;
  expect(victim.incident.yawTransient).toBeTruthy();
  expect(Math.abs(victim.yawRate)).toBeGreaterThan(.12);
  other.retired=true;
  for(let i=0;i<120;i++)stepVehicle(victim,sim.track,{throttle:.2,brake:0,steer:0},FIXED_DT);
  expect(victim.incident.spinTimer).toBe(0);
  expect(victim.incident.yawTransient).toBeFalsy();
  expect([victim.v,victim.lane,victim.yaw,victim.yawRate].every(Number.isFinite)).toBeTruthy();
});
