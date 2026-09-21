import {test,expect} from '@playwright/test';
import {FIXED_DT,VEHICLE_CLASSES,buildEntrants} from '../src/config.js';
import {createVehicleState,stepVehicle,cornerSpeedLimit} from '../src/simulation/vehicle.js';

const STRAIGHT_TRACK={
  total:100000,
  curvature(){return 0;},
  sample(){return{heading:0,halfWidth:20};},
  wrapS(s){return ((s%this.total)+this.total)%this.total;}
};

function makeCar(type){
  const entry=buildEntrants().find(e=>e.type===type);
  const car=createVehicleState(entry,100,0);
  car.pit.phase='TRACK';
  car.systems.grip=1;
  return car;
}

function accelerationTime(type,target=55.5555556){
  const car=makeCar(type);
  let elapsed=0;
  while(car.v<target&&elapsed<30){
    stepVehicle(car,STRAIGHT_TRACK,{throttle:1,brake:0,steer:0},FIXED_DT);
    elapsed+=FIXED_DT;
  }
  return elapsed;
}

function stoppingDistance(type,start=55.5555556){
  const car=makeCar(type);
  car.v=start;
  let distance=0,elapsed=0;
  while(car.v>.5&&elapsed<20){
    const before=car.v;
    stepVehicle(car,STRAIGHT_TRACK,{throttle:0,brake:1,steer:0},FIXED_DT);
    distance+=(before+car.v)*.5*FIXED_DT;
    elapsed+=FIXED_DT;
  }
  return{distance,elapsed};
}

test('PHY-02A: real straight-line acceleration separates classes even when headline top speeds are close',()=>{
  const f=accelerationTime('formula');
  const h=accelerationTime('hyper');
  const l=accelerationTime('lmh');
  const p=accelerationTime('proto');
  const g=accelerationTime('gt');
  const s=accelerationTime('supercar');
  const t=accelerationTime('touring');

  expect(f).toBeLessThan(h-1.0);
  expect(h).toBeLessThan(p-.35);
  expect(Math.abs(h-l)).toBeLessThan(.5);
  expect(p).toBeLessThan(g-1.4);
  expect(s).toBeGreaterThan(p+.8);
  expect(t).toBeGreaterThan(g+3.0);

  // Formula/Hyper/LMH may have similar terminal speed in real multiclass racing;
  // the model must distinguish them through acceleration/braking/cornering rather
  // than inventing an arbitrary top-speed gap.
  expect(Math.abs(VEHICLE_CLASSES.formula.top-VEHICLE_CLASSES.hyper.top)).toBeLessThan(2);
});

test('PHY-02B: braking distances emerge from class tyre/aero/brake capability',()=>{
  const f=stoppingDistance('formula').distance;
  const h=stoppingDistance('hyper').distance;
  const l=stoppingDistance('lmh').distance;
  const p=stoppingDistance('proto').distance;
  const g=stoppingDistance('gt').distance;
  const s=stoppingDistance('supercar').distance;
  const t=stoppingDistance('touring').distance;

  expect(f).toBeLessThan(h*.82);
  expect(Math.abs(h-l)).toBeLessThan(4);
  expect(Math.max(h,p)).toBeLessThan(g*.88);
  expect(g).toBeLessThan(Math.min(s,t)*.94);
});

test('PHY-02C: low- and high-speed corner envelopes separate by aero without making low speed identical',()=>{
  const lowK=.030;
  const highK=.008;
  const low={};
  const high={};
  for(const [name,spec] of Object.entries(VEHICLE_CLASSES)){
    low[name]=cornerSpeedLimit(spec,lowK,1);
    high[name]=cornerSpeedLimit(spec,highK,1);
  }

  expect(low.formula).toBeGreaterThan(low.hyper*1.10);
  expect(low.formula).toBeLessThan(low.hyper*1.30);
  expect(low.proto).toBeGreaterThan(low.gt*1.05);

  expect(high.formula).toBeGreaterThan(high.hyper*1.35);
  expect(high.formula).toBeGreaterThan(high.proto*1.35);
  expect(Math.min(high.hyper,high.proto)).toBeGreaterThan(high.gt*1.15);
  expect(high.gt).toBeGreaterThan(Math.max(high.supercar,high.touring)*1.04);
});

test('PHY-02D: terminal-speed hierarchy stays plausible without being the sole class discriminator',()=>{
  const c=VEHICLE_CLASSES;
  expect(c.formula.top).toBeGreaterThan(c.hyper.top);
  expect(c.hyper.top).toBeGreaterThan(c.lmh.top);
  expect(c.lmh.top).toBeGreaterThan(c.proto.top*1.05);
  expect(c.proto.top).toBeGreaterThan(c.gt.top*1.05);
  expect(c.gt.top).toBeGreaterThan(c.touring.top*1.15);

  const formulaVsHyper=(c.formula.top-c.hyper.top)/c.formula.top;
  const formulaVsGt=(c.formula.top-c.gt.top)/c.formula.top;
  expect(formulaVsHyper).toBeLessThan(.03);
  expect(formulaVsGt).toBeGreaterThan(.12);
});
