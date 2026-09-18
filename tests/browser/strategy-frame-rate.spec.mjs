import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('strategy and draft telemetry refresh on elapsed time rather than frame parity',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-strategy-dynamics.js',import.meta.url),'utf8');
  expect(source).toContain('decisionInterval=1/30');
  expect(source).toContain('s.decisionAcc>=decisionInterval');
  expect(source).toContain("decisionRate:'time-based-30hz'");
  expect(source).not.toContain('decisionPhase^=1');
  expect(source).not.toContain("decisionRate:'half-fleet-per-frame'");
});
