import {test,expect} from '@playwright/test';
import {VEHICLE_PERFORMANCE,longitudinalPerformance,performanceFor,resolveMulticlassPassPlan,trafficFollowPolicy} from '../../iphone-demo/runtime/vehicle-performance-spec.js';

test('vehicle class calibration keeps 2026 mass and hierarchy targets coherent',()=>{
  expect(VEHICLE_PERFORMANCE.formula.mass).toBe(768);
  expect(VEHICLE_PERFORMANCE.hyper.mass).toBe(1030);
  expect(VEHICLE_PERFORMANCE.lmh.mass).toBe(1030);
  expect(VEHICLE_PERFORMANCE.supercar.mass).toBe(1350);
  expect(VEHICLE_PERFORMANCE.touring.mass).toBe(1265);
  expect(VEHICLE_PERFORMANCE.formula.lateralG).toBeGreaterThan(VEHICLE_PERFORMANCE.proto.lateralG);
  expect(VEHICLE_PERFORMANCE.proto.lateralG).toBeGreaterThan(VEHICLE_PERFORMANCE.gt.lateralG);
  expect(VEHICLE_PERFORMANCE.formula.brake).toBeGreaterThan(VEHICLE_PERFORMANCE.hyper.brake);
  expect(VEHICLE_PERFORMANCE.hyper.brake).toBeGreaterThan(VEHICLE_PERFORMANCE.gt.brake);
  expect(VEHICLE_PERFORMANCE.gt.brake).toBeGreaterThan(VEHICLE_PERFORMANCE.touring.brake);
  expect(VEHICLE_PERFORMANCE.supercar.top*3.6).toBeCloseTo(300,0);
  expect(VEHICLE_PERFORMANCE.touring.top*3.6).toBeCloseTo(253,0);
});

test('all supported classes expose a complete performance envelope',()=>{
  for(const type of ['formula','hyper','lmh','proto','gt','supercar','touring']){
    const p=performanceFor(type);
    for(const key of ['top','accel','brake','tyre','wet','mass','paceIndex','lateralG','laneChangeG','aero','traction','tyreWear','fuelCapacity','fuelBurnPerMeter','wheelbase','steer','steerRate','draftGain','dirtyAirLoss'])expect(Number.isFinite(p[key]),`${type}.${key}`).toBeTruthy();
    for(const band of ['accelBand','brakeBand'])for(const key of ['low','mid','high'])expect(Number.isFinite(p[band][key]),`${type}.${band}.${key}`).toBeTruthy();
  }
});

test('formula acceleration falls with speed while aero braking grows',()=>{
  const low=longitudinalPerformance('formula',15),mid=longitudinalPerformance('formula',55),high=longitudinalPerformance('formula',90);
  expect(low.accel).toBeGreaterThan(mid.accel);
  expect(mid.accel).toBeGreaterThan(high.accel);
  expect(high.brake).toBeGreaterThan(mid.brake);
  expect(mid.brake).toBeGreaterThan(low.brake);
});

test('faster class arms a multiclass pass before collision braking traps it behind traffic',()=>{
  const plan=resolveMulticlassPassPlan({followerType:'formula',leaderType:'touring',gapM:82,closingMps:19,brakingLoad:.08,leaderLane:.3,halfWidth:3.55});
  expect(plan.eligible).toBeTruthy();
  expect(Math.abs(plan.targetLane)).toBeGreaterThan(2.1);
  expect(plan.paceDelta).toBeGreaterThan(.25);
});

test('same-class traffic does not receive the multiclass early-pass exemption',()=>{
  const plan=resolveMulticlassPassPlan({followerType:'gt',leaderType:'gt',gapM:60,closingMps:8,brakingLoad:.05,leaderLane:0,halfWidth:3.55});
  expect(plan.eligible).toBeFalsy();
});

test('planned lateral escape prevents premature follow braking while blocked lane still caps speed',()=>{
  const passing=trafficFollowPolicy({followerType:'formula',leaderType:'touring',gapM:50,speedMps:90,leaderSpeedMps:65,bodyGapM:5,currentLateralM:.3,plannedLateralM:2.8,safeLateralM:2.4,passIntent:true});
  const blocked=trafficFollowPolicy({followerType:'formula',leaderType:'touring',gapM:50,speedMps:90,leaderSpeedMps:65,bodyGapM:5,currentLateralM:.3,plannedLateralM:.4,safeLateralM:2.4,passIntent:true});
  expect(passing.passEscape).toBeTruthy();
  expect(passing.shouldCap).toBeFalsy();
  expect(blocked.passEscape).toBeFalsy();
  expect(blocked.shouldCap).toBeTruthy();
});
