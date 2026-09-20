import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {contactManifold,resolveContactImpulse} from '../src/simulation/contact.js';
import {createRaceSimulation} from '../src/simulation/race.js';

function pair(){
  const track=createTrack(),entries=buildEntrants();
  const a=createVehicleState(entries[0],300,0),b=createVehicleState(entries[1],300,0);
  return{track,a,b};
}

test('COL-06: rounded contact geometry rejects diagonal corner overlap that legacy AABB would falsely count',()=>{
  const {track,a,b}=pair();
  const long=(a.length+b.length)*.455;
  const lat=(a.width+b.width)*.455;
  b.s=track.wrapS(a.s+long);b.lane=lat;
  const legacyAabb=long<(a.length+b.length)*.48&&lat<(a.width+b.width)*.49;
  expect(legacyAabb).toBeTruthy();
  const contact=contactManifold(a,b,track);
  expect(contact.hit).toBeFalsy();
  expect(contact.separation).toBeGreaterThan(contact.radius);
});

test('COL-07: true nose-to-tail and side-to-side body overlap remain contacts',()=>{
  const {track,a,b}=pair();
  b.s=track.wrapS(a.s+(a.length+b.length)*.46);b.lane=0;
  expect(contactManifold(a,b,track).hit).toBeTruthy();
  b.s=a.s;b.lane=(a.width+b.width)*.47;
  expect(contactManifold(a,b,track).hit).toBeTruthy();
});

test('COL-08: contact geometry is symmetric and respects track wrap',()=>{
  const {track,a,b}=pair();
  a.s=track.total-1;b.s=1;a.lane=-.3;b.lane=.4;
  const ab=contactManifold(a,b,track),ba=contactManifold(b,a,track);
  expect(ab.hit).toBe(ba.hit);
  expect(ab.long).toBeCloseTo(ba.long,9);
  expect(ab.lat).toBeCloseTo(ba.lat,9);
  expect(ab.longitudinal).toBeCloseTo(-ba.longitudinal,9);
  expect(ab.lateral).toBeCloseTo(-ba.lateral,9);
});

test('COL-09: race contact counter ignores diagonal clearance but counts genuine overlap',()=>{
  const sim=createRaceSimulation(0xc0111de,{raceLaps:40});
  const [a,b,...rest]=sim.cars;
  for(const car of rest)car.retired=true;
  a.lap=0;b.lap=0;a.v=0;b.v=0;a.laneV=0;b.laneV=0;
  a.s=300;a.lane=0;
  b.s=sim.track.wrapS(a.s+(a.length+b.length)*.455);
  b.lane=(a.width+b.width)*.455;
  a.totalProgress=a.s;b.totalProgress=b.s;
  sim.update(FIXED_DT);
  expect(sim.snapshot().diagnostics.contacts).toBe(0);

  a.s=300;a.lane=0;b.s=301;b.lane=0;a.v=0;b.v=0;
  a.totalProgress=a.s;b.totalProgress=b.s;
  sim.update(FIXED_DT);
  expect(sim.snapshot().diagnostics.contacts).toBe(1);
});

test('COL-10: rear impact impulse respects vehicle mass and conserves longitudinal momentum',()=>{
  const {track,a,b}=pair();
  a.s=300;b.s=303;a.lane=0;b.lane=0;a.v=50;b.v=28;a.laneV=0;b.laneV=0;
  const contact=contactManifold(a,b,track);
  expect(contact.hit).toBeTruthy();
  expect(Math.abs(contact.normalLong)).toBeGreaterThan(.9);
  const momentumBefore=a.mass*a.v+b.mass*b.v;
  const closingBefore=a.v-b.v;
  const result=resolveContactImpulse(a,b,contact,{separationGain:0});
  const momentumAfter=a.mass*a.v+b.mass*b.v;
  expect(result.applied).toBeTruthy();
  expect(result.impactSpeed).toBeGreaterThan(20);
  expect(momentumAfter).toBeCloseTo(momentumBefore,6);
  expect(a.v).toBeLessThan(50);
  expect(b.v).toBeGreaterThan(28);
  expect(a.v-b.v).toBeLessThan(closingBefore);
});

test('COL-11: side-by-side body contact resolves laterally without arbitrary forward-speed averaging',()=>{
  const {track,a,b}=pair();
  a.s=300;b.s=300;a.lane=-.8;b.lane=.8;a.v=52;b.v=52;a.laneV=1.2;b.laneV=-1.0;
  const contact=contactManifold(a,b,track);
  expect(contact.hit).toBeTruthy();
  expect(Math.abs(contact.normalLat)).toBeGreaterThan(.9);
  const forwardA=a.v,forwardB=b.v;
  const result=resolveContactImpulse(a,b,contact);
  expect(result.applied).toBeTruthy();
  expect(a.v).toBeCloseTo(forwardA,9);
  expect(b.v).toBeCloseTo(forwardB,9);
  expect(a.laneV).toBeLessThan(1.2);
  expect(b.laneV).toBeGreaterThan(-1.0);
});

test('COL-12: contact response is deterministic and never creates non-finite velocity',()=>{
  const setup=()=>{
    const p=pair();
    p.a.s=300;p.b.s=302.7;p.a.lane=-.35;p.b.lane=.35;
    p.a.v=47;p.b.v=31;p.a.laneV=.7;p.b.laneV=-.4;
    return p;
  };
  const x=setup(),y=setup();
  const rx=resolveContactImpulse(x.a,x.b,contactManifold(x.a,x.b,x.track));
  const ry=resolveContactImpulse(y.a,y.b,contactManifold(y.a,y.b,y.track));
  expect(rx).toEqual(ry);
  expect([x.a.v,x.b.v,x.a.laneV,x.b.laneV].every(Number.isFinite)).toBeTruthy();
  expect(x.a.v).toBeGreaterThanOrEqual(0);expect(x.b.v).toBeGreaterThanOrEqual(0);
});
