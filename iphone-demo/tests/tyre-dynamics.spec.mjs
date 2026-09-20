import {test,expect} from '@playwright/test';
import {FIXED_DT,VEHICLE_CLASSES,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState,stepVehicle,tyreLateralAccel} from '../src/simulation/vehicle.js';
import {stepSystems} from '../src/simulation/systems.js';

function make(type='gt',s=300){
  const entry=buildEntrants().find(e=>e.type===type);
  return createVehicleState(entry,s,0);
}

test('PHY-04: combined tyre envelope trades braking force for lateral force',()=>{
  const track=createTrack();
  const straight=make('gt'),cornering=make('gt');
  straight.v=55;cornering.v=55;
  cornering.steer=.12;
  cornering.laneA=cornering.spec.laneChangeG*9.81*.62;
  cornering.laneV=.6;

  const vStraight=straight.v,vCorner=cornering.v;
  stepVehicle(straight,track,{throttle:0,brake:1,steer:0},FIXED_DT);
  stepVehicle(cornering,track,{throttle:0,brake:1,steer:.12},FIXED_DT);

  const straightDecel=(vStraight-straight.v)/FIXED_DT;
  const cornerDecel=(vCorner-cornering.v)/FIXED_DT;
  expect(straightDecel).toBeGreaterThan(cornerDecel+.25);
  expect(straight.tyre.forceUsage).toBeLessThanOrEqual(1.000001);
  expect(cornering.tyre.forceUsage).toBeLessThanOrEqual(1.000001);
});

test('PHY-05: braking creates bounded forward load transfer and it relaxes afterward',()=>{
  const track=createTrack(),car=make('gt');
  car.v=62;
  for(let i=0;i<30;i++)stepVehicle(car,track,{throttle:0,brake:1,steer:0},FIXED_DT);
  const peak=car.tyre.loadTransfer;
  expect(peak).toBeGreaterThan(.08);
  expect(peak).toBeLessThanOrEqual(.300001);

  for(let i=0;i<120;i++)stepVehicle(car,track,{throttle:.35,brake:0,steer:0},FIXED_DT);
  expect(Math.abs(car.tyre.loadTransfer)).toBeLessThan(peak*.65);
  expect(car.diagnostics.maxLoadTransfer).toBeGreaterThanOrEqual(peak-1e-6);
});

test('PHY-06: longitudinal slip rises at saturation and recovers when demand is removed',()=>{
  const track=createTrack(),car=make('gt');
  car.v=65;
  for(let i=0;i<24;i++)stepVehicle(car,track,{throttle:0,brake:1,steer:0},FIXED_DT);
  const saturated=car.tyre.slipRatio;
  expect(saturated).toBeGreaterThan(.035);
  expect(saturated).toBeLessThanOrEqual(.240001);

  for(let i=0;i<120;i++)stepVehicle(car,track,{throttle:0,brake:0,steer:0},FIXED_DT);
  expect(car.tyre.slipRatio).toBeLessThan(saturated*.35);
  expect(car.diagnostics.maxSlipRatio).toBeGreaterThanOrEqual(saturated-1e-6);
});

test('PHY-07: sustained tyre slip adds heat and wear instead of being presentation-only',()=>{
  const clean=make('gt'),sliding=make('gt');
  clean.v=48;sliding.v=48;
  clean.throttle=.45;sliding.throttle=.45;
  clean.tyre.slipAngle=.025;clean.tyre.slipRatio=.025;
  sliding.tyre.slipAngle=.19;sliding.tyre.slipRatio=.16;

  for(let i=0;i<900;i++){
    stepSystems(clean,FIXED_DT);
    stepSystems(sliding,FIXED_DT);
  }
  expect(sliding.systems.tyreWear).toBeGreaterThan(clean.systems.tyreWear*1.15);
  expect(sliding.systems.tyreTemp).toBeGreaterThan(clean.systems.tyreTemp+2);
  expect(sliding.systems.grip).toBeLessThan(clean.systems.grip);
});

test('PHY-08: load sensitivity reduces available grip and remains class-calibrated',()=>{
  const speed=58,transfer=.24;
  const formula=VEHICLE_CLASSES.formula,touring=VEHICLE_CLASSES.touring;
  const fBase=tyreLateralAccel(formula,speed,1,1,0),fLoaded=tyreLateralAccel(formula,speed,1,1,transfer);
  const tBase=tyreLateralAccel(touring,speed,1,1,0),tLoaded=tyreLateralAccel(touring,speed,1,1,transfer);
  expect(fLoaded).toBeLessThan(fBase);
  expect(tLoaded).toBeLessThan(tBase);
  expect(tLoaded/tBase).toBeLessThan(fLoaded/fBase);
});
