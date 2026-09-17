import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('spin recovery recentres lane intent with dt-normalized damping',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-driver-dynamics.js',import.meta.url),'utf8');
  expect(source).toContain("c.laneTarget=T.MathUtils.lerp(c.laneTarget,0,1-Math.exp(-3.08*dt))");
  expect(source).not.toContain("c.laneTarget=T.MathUtils.lerp(c.laneTarget,0,.05)");
});
