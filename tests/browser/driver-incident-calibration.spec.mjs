import {test,expect} from '@playwright/test';
import {DRIVER_INCIDENT_POLICY,allocatedIncidentProbability,expectedFullSpinCount,expectedIncidentCount,fieldIncidentRatePerSecond,fullSpinShare,incidentMeanSeconds} from '../../iphone-demo/runtime/driver-incident-policy.js';

test('driver incident policy keeps dry full spins near one per 90 minute race field',()=>{
  const seconds=DRIVER_INCIDENT_POLICY.referenceRaceSeconds;
  expect(incidentMeanSeconds('LOCKUP',0)).toBe(720);
  expect(expectedIncidentCount('LOCKUP',0,seconds)).toBeCloseTo(7.5,5);
  expect(expectedIncidentCount('SPIN',0,seconds)).toBeCloseTo(2,5);
  expect(expectedFullSpinCount(0,seconds)).toBeCloseTo(1,5);
});

test('wet conditions raise mistakes without turning every lockup into a spin',()=>{
  const seconds=DRIVER_INCIDENT_POLICY.referenceRaceSeconds,wet=.70;
  expect(fullSpinShare(wet)).toBeCloseTo(.65,5);
  expect(expectedIncidentCount('LOCKUP',wet,seconds)).toBeCloseTo(18,5);
  expect(expectedIncidentCount('SPIN',wet,seconds)).toBeCloseTo(6,5);
  expect(expectedFullSpinCount(wet,seconds)).toBeCloseTo(3.9,5);
});

test('adding cars does not multiply the field-wide incident rate',()=>{
  const dt=1,now=5000,lastAt=-Infinity,fieldRate=fieldIncidentRatePerSecond('LOCKUP',0);
  for(const cars of [1,5,20,40]){
    const probabilities=Array.from({length:cars},()=>allocatedIncidentProbability('LOCKUP',{wetness:0,dt,weight:1,totalWeight:cars,now,lastAt}));
    const aggregate=probabilities.reduce((a,b)=>a+b,0);
    expect(aggregate).toBeCloseTo(fieldRate,4);
  }
});

test('incident allocation requires a physically eligible risk weight and respects spacing',()=>{
  expect(allocatedIncidentProbability('SPIN',{wetness:0,dt:1,weight:0,totalWeight:1,now:1000,lastAt:-Infinity})).toBe(0);
  expect(allocatedIncidentProbability('SPIN',{wetness:0,dt:1,weight:1,totalWeight:1,now:100,lastAt:0})).toBe(0);
  expect(allocatedIncidentProbability('SPIN',{wetness:0,dt:1,weight:1,totalWeight:1,now:1000,lastAt:0})).toBeGreaterThan(0);
});
