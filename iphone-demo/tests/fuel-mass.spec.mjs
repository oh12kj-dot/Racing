import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {serviceSystems} from '../src/simulation/systems.js';
import {
  FUEL_DENSITY_KG_PER_L,
  createVehicleState,
  effectiveVehicleMass,
  stepVehicle,
  tyreLateralAccel,
  vehicleMassFactor
} from '../src/simulation/vehicle.js';

const STRAIGHT={
  total:100000,
  curvature:()=>0,
  sample:s=>({s,heading:0,halfWidth:50}),
  wrapS:s=>((s%100000)+100000)%100000
};

function make(type='formula'){
  const entry=buildEntrants().find(e=>e.type===type);
  const car=createVehicleState(entry,100,0);
  car.yaw=0;car.lane=0;car.targetLane=0;car.pit.phase='TRACK';
  return car;
}
function run(car,seconds,control){
  const steps=Math.round(seconds/FIXED_DT);
  for(let i=0;i<steps;i++)stepVehicle(car,STRAIGHT,control,FIXED_DT);
}

test('FUEL-MASS-01: default starting fuel preserves the pre-existing calibrated class mass',()=>{
  const car=make('formula');
  const expectedDry=car.spec.mass-car.systems.fuel*FUEL_DENSITY_KG_PER_L;
  expect(car.referenceMass).toBe(car.spec.mass);
  expect(car.mass).toBe(car.spec.mass);
  expect(car.dryMass).toBeCloseTo(expectedDry,9);
  expect(effectiveVehicleMass(car)).toBeCloseTo(car.spec.mass,9);
  expect(vehicleMassFactor(car)).toBeCloseTo(1,9);
});

test('FUEL-MASS-02: burning fuel reduces physical mass and improves straight-line acceleration',()=>{
  const heavy=make('formula'),light=make('formula');
  heavy.v=20;light.v=20;
  light.systems.fuel=8;

  run(heavy,2,{throttle:1,brake:0,steer:0});
  run(light,2,{throttle:1,brake:0,steer:0});

  expect(light.mass).toBeLessThan(heavy.mass-35);
  expect(vehicleMassFactor(light)).toBeGreaterThan(vehicleMassFactor(heavy));
  expect(light.v).toBeGreaterThan(heavy.v+.35);
});

test('FUEL-MASS-03: a lighter car receives more aero-supported braking authority at high speed',()=>{
  const heavy=make('formula'),light=make('formula');
  heavy.v=70;light.v=70;
  light.systems.fuel=8;
  const heavyFactor=vehicleMassFactor(heavy),lightFactor=vehicleMassFactor(light);
  const heavyLat=tyreLateralAccel(heavy.spec,70,1,1,0,heavyFactor);
  const lightLat=tyreLateralAccel(light.spec,70,1,1,0,lightFactor);
  expect(lightLat).toBeGreaterThan(heavyLat);

  run(heavy,.55,{throttle:0,brake:1,steer:0});
  run(light,.55,{throttle:0,brake:1,steer:0});
  expect(light.v).toBeLessThan(heavy.v-.12);
});

test('FUEL-MASS-04: pit refuelling adds real mass instead of only changing a strategy number',()=>{
  const car=make('gt');
  car.systems.fuel=6;
  stepVehicle(car,STRAIGHT,{throttle:0,brake:0,steer:0},FIXED_DT);
  const beforeMass=car.mass,beforeFuel=car.systems.fuel;

  serviceSystems(car,{fuel:true});
  expect(car.systems.fuel).toBeGreaterThan(beforeFuel);
  stepVehicle(car,STRAIGHT,{throttle:0,brake:0,steer:0},FIXED_DT);
  expect(car.mass).toBeGreaterThan(beforeMass+50);
  expect(car.mass).toBeCloseTo(effectiveVehicleMass(car),9);
  expect(vehicleMassFactor(car)).toBeLessThan(1);
});

test('FUEL-MASS-05: mass coupling is continuous and never depends on fuel reaching zero',()=>{
  const car=make('hyper');
  const samples=[];
  for(const fuel of [car.systems.fuel,40,20,5]){
    car.systems.fuel=fuel;
    samples.push({fuel,mass:effectiveVehicleMass(car),factor:vehicleMassFactor(car)});
  }
  for(let i=1;i<samples.length;i++){
    expect(samples[i].mass).toBeLessThan(samples[i-1].mass);
    expect(samples[i].factor).toBeGreaterThan(samples[i-1].factor);
  }
  expect(samples.at(-1).mass).toBeGreaterThan(car.dryMass);
});
