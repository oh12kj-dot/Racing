import {test,expect} from '@playwright/test';
import {DRIVER_INCIDENT_POLICY,expectedFullSpinCount,expectedIncidentCount,fullSpinShare,incidentMeanSeconds} from '../../iphone-demo/runtime/driver-incident-policy.js';

test('driver incident policy keeps dry full spins near one per 90 minute race',()=>{
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
