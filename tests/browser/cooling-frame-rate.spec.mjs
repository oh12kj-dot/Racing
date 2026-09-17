import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('cooling-line correction uses elapsed-time damping',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-vehicle-systems.js',import.meta.url),'utf8');
  expect(source).toContain('function frameRateAlpha(per60,dt)');
  expect(source).toContain('frameRateAlpha(.025,dt)');
  expect(source).not.toContain('T.MathUtils.lerp(c.laneTarget,side,.025)');
});
