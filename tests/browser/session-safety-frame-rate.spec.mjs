import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('blue-flag and hydro lane corrections use elapsed-time damping',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-session-control.js',import.meta.url),'utf8');
  expect(source).toMatch(/(?:function\s+frameRateAlpha\(per60,dt\)|frameRateAlpha\s*=\s*\(per60,dt\)\s*=>)/);
  expect(source).toContain('function blueFlags(dt)');
  expect(source).toContain('frameRateAlpha(.10,dt)');
  expect(source).toContain('frameRateAlpha(.035,dt)');
  expect(source).toContain('blueFlags(step)');
  expect(source).not.toContain('T.MathUtils.lerp(c.laneTarget,side,.10)');
  expect(source).not.toContain("T.MathUtils.lerp(c.laneTarget,-Math.sign(c.lane||1)*2.5,.035)");
});