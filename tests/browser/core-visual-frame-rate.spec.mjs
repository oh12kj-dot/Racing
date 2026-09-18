import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('core wheel and braking visual animation uses elapsed race time',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-core.js',import.meta.url),'utf8');
  expect(source).toContain('poseDt=Number.isFinite(last)?clamp(now-last,0,.05):0');
  expect(source).toContain('visualAlpha=1-Math.pow(1-.22,poseDt*60)');
  expect(source).toContain('c.wheelSpin+=c.v*1.08*poseDt');
  expect(source).not.toContain('c.wheelSpin+=c.v*.018');
});
