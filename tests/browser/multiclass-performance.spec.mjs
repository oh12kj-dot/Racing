import {test,expect} from '@playwright/test';
import {VEHICLE_PERFORMANCE,longitudinalPerformance,performanceAdvantage,resolveMulticlassPassPlan,trafficFollowPolicy} from '../../iphone-demo/runtime/vehicle-performance-spec.js';

test('2026 class calibration preserves real-world performance hierarchy',()=>{
  const p=VEHICLE_PERFORMANCE;
  expect(p.formula.mass).toBe(768);
  expect(p.formula.fuelCapacity).toBe(70);
  expect(p.formula.top*3.6).toBeCloseTo(353.9,0);
  expect(p.formula.brake).toBeGreaterThan(p.hyper.brake);
  expect(p.formula.lateralG).toBeGreaterThan(p.hyper.lateralG);
  expect(p.hyper.mass).toBe(1030);
  expect(p.proto.mass).toBe(950);
  expect(p.supercar.mass).toBe(1350);
  expect(p.supercar.top*3.6).toBeCloseTo(300,0);
  expect(p.touring.mass).toBe(1265);
  expect(p.touring.top*3.6).toBeCloseTo(253,0);
  expect(p.formula.paceIndex).toBeGreaterThan(p.hyper.paceIndex);
  expect(p.hyper.paceIndex).toBeGreaterThan(p.gt.paceIndex);
  expect(p.gt.paceIndex).toBeGreaterThan(p.touring.paceIndex);
});

test('acceleration falls with speed while aero braking grows for formula',()=>{
  const low=longitudinalPerformance('formula',15),mid=longitudinalPerformance('formula',55),high=longitudinalPerformance('formula',90);
  expect(low.accel).toBeGreaterThan(mid.accel);
  expect(mid.accel).toBeGreaterThan(high.accel);
  expect(high.brake).toBeGreaterThan(mid.brake);
  expect(mid.brake).toBeGreaterThan(low.brake);
});

test('large multiclass performance delta prepares an early pass instead of queueing',()=>{
  const adv=performanceAdvantage('formula','gt');
  expect(adv.faster).toBeTruthy();
  const plan=resolveMulticlassPassPlan({followerType:'formula',leaderType:'gt',gapM:72,closingMps:14,brakingLoad:.08,leaderLane:.4,halfWidth:3.55});
  expect(plan.eligible).toBeTruthy();
  expect(Math.abs(plan.targetLane)).toBeGreaterThan(2.1);
});

test('planned separated pass does not trigger follow braking that an unplanned queue needs',()=>{
  const pass=trafficFollowPolicy({followerType:'formula',leaderType:'touring',gapM:60,speedMps:88,leaderSpeedMps:68,bodyGapM:5,currentLateralM:0,plannedLateralM:2.75,safeLateralM:2.35,passIntent:true});
  expect(pass.passEscape).toBeTruthy();
  expect(pass.shouldCap).toBeFalsy();
  const queue=trafficFollowPolicy({followerType:'formula',leaderType:'touring',gapM:60,speedMps:88,leaderSpeedMps:68,bodyGapM:5,currentLateralM:0,plannedLateralM:0,safeLateralM:2.35,passIntent:false});
  expect(queue.shouldCap).toBeTruthy();
});

test('pass intent never disables emergency rear-end protection',()=>{
  const danger=trafficFollowPolicy({followerType:'formula',leaderType:'gt',gapM:9,speedMps:82,leaderSpeedMps:65,bodyGapM:5,currentLateralM:0,plannedLateralM:2.75,safeLateralM:2.35,passIntent:true});
  expect(danger.passEscape).toBeTruthy();
  expect(danger.shouldCap).toBeTruthy();
  expect(danger.ttc).toBeLessThan(danger.ttcLimit);
});
