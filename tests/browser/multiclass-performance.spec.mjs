import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {performanceFor,resolveMulticlassPassPlan,trafficFollowPolicy} from '../../iphone-demo/runtime/vehicle-performance-spec.js';
import {trajectoryTuneForType} from '../../iphone-demo/runtime/trajectory-controller.js';

test('2026 class envelopes preserve real hierarchy and regulatory masses',()=>{
  const formula=performanceFor('formula'),hyper=performanceFor('hyper'),proto=performanceFor('proto'),gt=performanceFor('gt'),supercar=performanceFor('supercar'),touring=performanceFor('touring');
  expect(formula.mass).toBe(768);expect(formula.top*3.6).toBeCloseTo(353.9,0);
  expect(hyper.mass).toBe(1030);expect(proto.mass).toBe(950);
  expect(supercar.mass).toBe(1350);expect(supercar.top*3.6).toBeCloseTo(300,0);
  expect(touring.mass).toBe(1265);
  expect(formula.paceIndex).toBeGreaterThan(hyper.paceIndex);expect(hyper.paceIndex).toBeGreaterThan(gt.paceIndex);expect(gt.paceIndex).toBeGreaterThan(touring.paceIndex);
  expect(formula.lateralG).toBeGreaterThan(proto.lateralG);expect(proto.lateralG).toBeGreaterThan(gt.lateralG);expect(gt.lateralG).toBeGreaterThan(supercar.lateralG);
  expect(formula.brake).toBeGreaterThan(hyper.brake);expect(hyper.brake).toBeGreaterThan(gt.brake);expect(supercar.accel).toBeGreaterThan(gt.accel);
});

test('trajectory response is derived from the same class performance source',()=>{
  const formula=trajectoryTuneForType('formula'),touring=trajectoryTuneForType('touring');
  expect(formula.latG).toBe(performanceFor('formula').laneChangeG);expect(touring.latG).toBe(performanceFor('touring').laneChangeG);
  expect(formula.latG).toBeGreaterThan(touring.latG);expect(formula.wheelbase).toBeGreaterThan(touring.wheelbase);
});

test('Formula prepares a lateral multiclass pass before old 90m follow braking',()=>{
  const plan=resolveMulticlassPassPlan({followerType:'formula',leaderType:'touring',gapM:90,closingMps:25.8,brakingLoad:.10,leaderLane:0,halfWidth:3.55});
  expect(plan.eligible).toBeTruthy();expect(Math.abs(plan.targetLane)).toBeGreaterThan(2);
  const follow=trafficFollowPolicy({followerType:'formula',leaderType:'touring',gapM:90,speedMps:98.3,leaderSpeedMps:72.5,bodyGapM:5,currentLateralM:0,plannedLateralM:Math.abs(plan.targetLane),safeLateralM:2.4,passIntent:true});
  expect(follow.passEscape).toBeTruthy();expect(follow.shouldCap).toBeFalsy();expect(follow.ttcLimit).toBeLessThan(1.2);
});

test('urgent collision risk still caps an active multiclass pass',()=>{
  const follow=trafficFollowPolicy({followerType:'formula',leaderType:'touring',gapM:14,speedMps:98.3,leaderSpeedMps:72.5,bodyGapM:5,currentLateralM:0,plannedLateralM:2.75,safeLateralM:2.4,passIntent:true});
  expect(follow.passEscape).toBeTruthy();expect(follow.shouldCap).toBeTruthy();expect(follow.allowedSpeed).toBeLessThan(83.6);
});

test('same-class traffic receives no multiclass escape exemption',()=>{
  const follow=trafficFollowPolicy({followerType:'gt',leaderType:'gt',gapM:50,speedMps:84.6,leaderSpeedMps:75,bodyGapM:5,currentLateralM:0,plannedLateralM:2.75,safeLateralM:2.4,passIntent:true});
  expect(follow.faster).toBeFalsy();expect(follow.passEscape).toBeFalsy();expect(follow.ttcLimit).toBeCloseTo(3.2,5);expect(follow.shouldCap).toBeTruthy();
});

test('runtime consumes calibrated limits before legacy baseMax and keeps physical safety authority',()=>{
  const base=readFileSync(new URL('../../iphone-demo/runtime/race-base.js',import.meta.url),'utf8');
  const contact=readFileSync(new URL('../../iphone-demo/runtime/race-contact-avoidance.js',import.meta.url),'utf8');
  const perf=readFileSync(new URL('../../iphone-demo/runtime/race-performance.js',import.meta.url),'utf8');
  expect(base).toContain('c._v18BaseMax||c.classPerformance?.top||c.baseMax');
  expect(base).toContain('trafficFollowPolicy');expect(base).toContain('physicalSafetyLimit=Math.max(safetyCap,before-brakeAvail*dt)');
  expect(contact).toContain("mode:'predictive-cap-physical-obb-authoritative'");expect(contact).toContain('passAware:true');expect(contact).toContain('requestSpeedCap(c,cap)');expect(contact).toContain('requestSpeedCap(c,front.v+');
  expect(perf).toContain("from './race-realism-calibration.js'");
});
