import {test,expect} from '@playwright/test';
import {projectedSideBySideRisk} from '../../iphone-demo/runtime/race-contact-avoidance.js';

test('narrow but parallel straight-line overlap does not request avoidance',()=>{
  const a={width:2.0,lane:-1.03,laneTarget:-1.08,lateralVelocity:-.05};
  const b={width:2.0,lane:1.03,laneTarget:1.08,lateralVelocity:.05};
  const risk=projectedSideBySideRisk(a,b,{horizon:1,cornerLoad:0});
  expect(risk.currentSep).toBeCloseTo(2.06,2);
  expect(risk.currentSep).toBeGreaterThan(risk.physicalClearance);
  expect(risk.parallelClear).toBeTruthy();
  expect(risk.projectedContact).toBeFalsy();
});

test('side-by-side cars that converge toward each other remain an avoidance threat',()=>{
  const a={width:2.0,lane:-1.05,laneTarget:-.70,lateralVelocity:.70};
  const b={width:2.0,lane:1.05,laneTarget:.70,lateralVelocity:-.70};
  const risk=projectedSideBySideRisk(a,b,{horizon:1,cornerLoad:0});
  expect(risk.projectedContact).toBeTruthy();
  expect(risk.parallelClear).toBeFalsy();
  expect(risk.minFutureSep).toBeLessThan(risk.riskClearance);
});

test('corner load increases the clearance required for a projected parallel pass',()=>{
  const a={width:2.0,lane:-1.05,laneTarget:-1.075,lateralVelocity:-.025};
  const b={width:2.0,lane:1.05,laneTarget:1.075,lateralVelocity:.025};
  const straight=projectedSideBySideRisk(a,b,{horizon:1,cornerLoad:0});
  const corner=projectedSideBySideRisk(a,b,{horizon:1,cornerLoad:1});
  expect(straight.parallelClear).toBeTruthy();
  expect(corner.riskClearance).toBeGreaterThan(straight.riskClearance);
  expect(corner.projectedContact).toBeTruthy();
});
