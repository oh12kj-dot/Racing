import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createVehicleState,stepVehicle} from '../src/simulation/vehicle.js';
import {stepSystems,energyDriveFactor} from '../src/simulation/systems.js';
import {createRaceSimulation} from '../src/simulation/race.js';

const STRAIGHT_TRACK={
  total:100000,
  curvature(){return 0;},
  sample(){return{heading:0,halfWidth:20};},
  wrapS(s){return ((s%this.total)+this.total)%this.total;}
};

function makeCar(type='formula',v=50){
  const entry=buildEntrants().find(e=>e.type===type);
  const car=createVehicleState(entry,100,0);
  car.pit.phase='TRACK';car.v=v;car.systems.grip=1;
  return car;
}

test('ERS-01: charged hybrid deploys its attack reserve under sustained attack throttle',()=>{
  const car=makeCar('formula',55),start=car.systems.energyMJ;
  car.racecraft.state='COMMIT';car.throttle=1;car.brake=0;
  for(let i=0;i<120;i++)stepSystems(car,FIXED_DT);
  expect(car.systems.energyControllerActive).toBeTruthy();
  expect(car.systems.energyDeploy).toBeGreaterThan(.9);
  expect(car.systems.energyMode).toBe('ATTACK');
  expect(car.systems.energyMJ).toBeLessThan(start-.20);
  expect(car.systems.energyMJ).toBeGreaterThan(car.systems.energyCapacityMJ*car.systems.energyAttackReserve);
});

test('ERS-02: braking harvests energy without systems writing pose or velocity',()=>{
  const car=makeCar('hyper',48);
  car.systems.energyMJ=1.0;car.throttle=0;car.brake=1;car.lane=.8;car.laneV=.3;
  const before={s:car.s,v:car.v,lane:car.lane,laneV:car.laneV,yaw:car.yaw};
  for(let i=0;i<120;i++)stepSystems(car,FIXED_DT);
  expect(car.systems.energyHarvest).toBeGreaterThan(.9);
  expect(car.systems.energyMode).toBe('HARVEST');
  expect(car.systems.energyMJ).toBeGreaterThan(1.20);
  expect({s:car.s,v:car.v,lane:car.lane,laneV:car.laneV,yaw:car.yaw}).toEqual(before);
});

test('ERS-03: depleted attack reserve reduces physical acceleration instead of imposing a speed cap',()=>{
  const charged=makeCar('formula',40),depleted=makeCar('formula',40);
  charged.racecraft.state=depleted.racecraft.state='COMMIT';
  charged.systems.energyMJ=charged.systems.energyCapacityMJ*.8;
  depleted.systems.energyMJ=depleted.systems.energyCapacityMJ*.05;
  for(let i=0;i<180;i++){
    stepVehicle(charged,STRAIGHT_TRACK,{throttle:1,brake:0,steer:0},FIXED_DT);
    stepSystems(charged,FIXED_DT);
    stepVehicle(depleted,STRAIGHT_TRACK,{throttle:1,brake:0,steer:0},FIXED_DT);
    stepSystems(depleted,FIXED_DT);
  }
  expect(charged.systems.energyDeploy).toBeGreaterThan(.5);
  expect(depleted.systems.energyDeploy).toBe(0);
  expect(energyDriveFactor(charged)).toBeGreaterThan(energyDriveFactor(depleted)+.035);
  expect(charged.v).toBeGreaterThan(depleted.v+.35);
  expect(charged.v).toBeLessThan(charged.spec.top);
  expect(depleted.v).toBeLessThan(depleted.spec.top);
});

test('ERS-04: balanced running protects discretionary energy while attack may spend it',()=>{
  const balanced=makeCar('lmh',52),attack=makeCar('lmh',52);
  balanced.systems.energyMJ=balanced.systems.energyCapacityMJ*.14;
  attack.systems.energyMJ=attack.systems.energyCapacityMJ*.14;
  balanced.throttle=attack.throttle=1;balanced.brake=attack.brake=0;
  attack.racecraft.state='COMMIT';
  stepSystems(balanced,FIXED_DT);stepSystems(attack,FIXED_DT);
  expect(balanced.systems.energyDeploy).toBe(0);
  expect(balanced.systems.energyMode).toBe('RESERVE');
  expect(energyDriveFactor(balanced)).toBe(1);
  expect(attack.systems.energyDeploy).toBeGreaterThan(.9);
  expect(attack.systems.energyMode).toBe('ATTACK');
});

test('ERS-05: non-hybrid classes remain neutral to the energy subsystem',()=>{
  const car=makeCar('gt',45);
  car.racecraft.state='COMMIT';car.throttle=1;car.brake=0;
  for(let i=0;i<120;i++)stepSystems(car,FIXED_DT);
  expect(car.systems.energyCapacityMJ).toBe(0);
  expect(car.systems.energyMJ).toBe(0);
  expect(car.systems.energyMode).toBe('NONE');
  expect(energyDriveFactor(car)).toBe(1);
});

test('ERS-06: identical full simulations keep hybrid state deterministic',()=>{
  const a=createRaceSimulation(0x6e7267,{raceLaps:20}),b=createRaceSimulation(0x6e7267,{raceLaps:20});
  for(let i=0;i<Math.round(45/FIXED_DT);i++){a.update(FIXED_DT);b.update(FIXED_DT);}
  const energyA=a.cars.map(c=>[c.id,c.systems.energyMJ,c.systems.energyDeploy,c.systems.energyHarvest,c.systems.energyMode]);
  const energyB=b.cars.map(c=>[c.id,c.systems.energyMJ,c.systems.energyDeploy,c.systems.energyHarvest,c.systems.energyMode]);
  expect(energyA).toEqual(energyB);
  expect(a.stateHash()).toBe(b.stateHash());
  expect(a.snapshot().diagnostics.finite).toBeTruthy();
});

test('ERS-07: strategic reserve releases progressively toward the final lap',()=>{
  const early=makeCar('formula',55),finalLap=makeCar('formula',55);
  early.racecraft.state=finalLap.racecraft.state='COMMIT';
  early.strategy={remainingLaps:8};finalLap.strategy={remainingLaps:1};
  early.systems.energyMJ=finalLap.systems.energyMJ=1.15;
  early.throttle=finalLap.throttle=1;early.brake=finalLap.brake=0;

  stepSystems(early,FIXED_DT);stepSystems(finalLap,FIXED_DT);
  expect(early.systems.energyStrategy).toBe('ATTACK');
  expect(finalLap.systems.energyStrategy).toBe('ENDGAME');
  expect(early.systems.energyReserveTarget).toBeGreaterThan(finalLap.systems.energyReserveTarget+.15);

  for(let i=1;i<600;i++){stepSystems(early,FIXED_DT);stepSystems(finalLap,FIXED_DT);}
  expect(early.systems.energyMJ).toBeGreaterThan(finalLap.systems.energyMJ+.60);
  expect(finalLap.systems.energyMJ).toBeLessThan(.12);
});

test('ERS-08: caution suppresses deployment while braking still regenerates energy',()=>{
  const car=makeCar('formula',48);
  car.racecraft.state='COMMIT';car.strategy={remainingLaps:4};car.cautionNoPass=true;
  car.throttle=1;car.brake=0;
  const start=car.systems.energyMJ;
  stepSystems(car,FIXED_DT);
  expect(car.systems.energyStrategy).toBe('CAUTION');
  expect(car.systems.energyDeploy).toBe(0);
  expect(car.systems.energyMJ).toBeCloseTo(start,6);

  car.systems.energyMJ=1;car.throttle=0;car.brake=1;
  for(let i=0;i<120;i++)stepSystems(car,FIXED_DT);
  expect(car.systems.energyHarvest).toBeGreaterThan(.9);
  expect(car.systems.energyMJ).toBeGreaterThan(1.10);
  expect(car.systems.energyStrategy).toBe('CAUTION');
});

test('ERS-09: defence may deploy energy but hysteresis prevents strategy flapping',()=>{
  const car=makeCar('formula',52);
  car.strategy={remainingLaps:4};car.racecraft.state='RESET';car.racecraft.defenseUsed=true;
  car.throttle=1;car.brake=0;
  stepSystems(car,FIXED_DT);
  expect(car.systems.energyStrategy).toBe('DEFEND');
  expect(car.systems.energyDeploy).toBeGreaterThan(.9);

  car.racecraft.defenseUsed=false;
  stepSystems(car,FIXED_DT);
  expect(car.systems.energyStrategy).toBe('DEFEND');
  expect(car.systems.energyDeploy).toBe(0);
  for(let i=0;i<70;i++)stepSystems(car,FIXED_DT);
  expect(car.systems.energyStrategy).toBe('BALANCED');
});

test('ERS-10: low SOC enters save mode before crossing the strategic reserve',()=>{
  const car=makeCar('formula',55);
  car.strategy={remainingLaps:10};car.racecraft.state='COMMIT';
  car.systems.energyMJ=car.systems.energyCapacityMJ*.24;car.throttle=1;car.brake=0;
  stepSystems(car,FIXED_DT);
  expect(car.systems.energyReserveTarget).toBeGreaterThan(.24);
  expect(car.systems.energyStrategy).toBe('SAVE');
  expect(car.systems.energyDeploy).toBe(0);
  expect(car.systems.energyMode).toBe('RESERVE');
});

test('ERS-11: authoritative hash and finite diagnostics include hybrid energy state',()=>{
  const sim=createRaceSimulation(0x657273,{raceLaps:8});
  const car=sim.cars.find(c=>c.systems.energyCapacityMJ>0);
  const baseline=sim.stateHash();
  car.systems.energyMJ-=.25;
  expect(sim.stateHash()).not.toBe(baseline);
  car.systems.energyMJ+=.25;
  car.systems.energyStrategy='ATTACK';
  expect(sim.stateHash()).not.toBe(baseline);
  car.systems.energyMJ=Number.NaN;
  expect(sim.snapshot().diagnostics.finite).toBeFalsy();
});