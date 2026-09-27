import {test,expect} from '@playwright/test';
import {createRaceSimulation} from '../src/simulation/race.js';
import {createRng} from '../src/simulation/random.js';

function expectMutationChangesHash(mutator){
  const sim=createRaceSimulation(0x51a7e);
  const before=sim.stateHash();
  mutator(sim);
  expect(sim.stateHash()).not.toBe(before);
}

test('HASH-01: equal seeds and untouched authoritative state produce equal hashes',()=>{
  const a=createRaceSimulation(0x51a7e);
  const b=createRaceSimulation(0x51a7e);
  expect(a.stateHash()).toBe(b.stateHash());
});

test('HASH-02: RNG internal state is authoritative even after visible reaction values are normalized',()=>{
  const a=createRaceSimulation(0x11111111);
  const b=createRaceSimulation(0x22222222);
  for(let i=0;i<a.cars.length;i++)b.cars[i].reaction=a.cars[i].reaction;
  expect(a.cars.map(c=>c.reaction)).toEqual(b.cars.map(c=>c.reaction));
  expect(a.stateHash()).not.toBe(b.stateHash());

  const rng=createRng(123);
  const before=rng.state;
  rng.next();
  expect(rng.state).not.toBe(before);
});

test('HASH-03: racecraft latent decisions and timers are authoritative',()=>{
  for(const mutate of [
    sim=>{sim.cars[0].racecraft.targetId=sim.cars[1].id;},
    sim=>{sim.cars[0].racecraft.commitUntil=2.5;},
    sim=>{sim.cars[0].racecraft.setupUntil=1.2;},
    sim=>{sim.cars[0].racecraft.switchUntil=.8;},
    sim=>{sim.cars[0].racecraft.defenseUsed=true;},
    sim=>{sim.cars[0].racecraft.defenseResetAt=7;}
  ])expectMutationChangesHash(mutate);
});

test('HASH-04: driver mistake latent state is authoritative',()=>{
  for(const mutate of [
    sim=>{sim.cars[0].driver.mistakeTimer=.4;},
    sim=>{sim.cars[0].driver.mistakeDuration=.7;},
    sim=>{sim.cars[0].driver.steerBias=.3;},
    sim=>{sim.cars[0].driver.lift=.2;}
  ])expectMutationChangesHash(mutate);
});

test('HASH-05: pit request, service timing and requested work are authoritative',()=>{
  for(const mutate of [
    sim=>{sim.cars[0].pit.requested=true;},
    sim=>{sim.cars[0].pit.serviceTimer=2.2;},
    sim=>{sim.cars[0].pit.queue=true;},
    sim=>{sim.cars[0].pit.missedCount=1;},
    sim=>{sim.cars[0].pit.servicePlan={tyres:false,tyreCompound:'SLICK',fuel:false,repair:true,cooling:false};}
  ])expectMutationChangesHash(mutate);
});

test('HASH-06: timing and environment latent evolution state is authoritative',()=>{
  for(const mutate of [
    sim=>{sim.cars[0].timing.sectorIndex=1;},
    sim=>{sim.cars[0].timing.sectorStamp=.5;},
    sim=>{sim.environment.elapsed=.25;},
    sim=>{sim.environment.dryingRate+=.1;},
    sim=>{sim.raceControl.lastFlagChange=.25;}
  ])expectMutationChangesHash(mutate);
});

test('HASH-07: diagnostics-only mutations do not contaminate authoritative hash',()=>{
  const sim=createRaceSimulation(0x51a7e);
  const before=sim.stateHash();
  sim.cars[0].diagnostics.maxYawRate=999;
  sim.cars[0].diagnostics.recoveries=99;
  expect(sim.stateHash()).toBe(before);
});
