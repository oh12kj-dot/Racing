import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {pitApproachVelocityStep} from '../../iphone-demo/runtime/race-pit-exit-release.js';

test('pit approach braking is acceleration bounded and cannot snap to target speed',()=>{
  const start=20,target=4,decel=7,dt=.05,next=pitApproachVelocityStep(start,target,decel,dt);
  expect(next).toBeCloseTo(19.65,8);
  expect(next).toBeGreaterThan(target+10);
  expect(start-next).toBeLessThanOrEqual(decel*dt+.000001);
});

test('pit approach integration converges to the target without overshoot',()=>{
  let v=20;for(let i=0;i<100;i++)v=pitApproachVelocityStep(v,4,7,.05);
  expect(v).toBeCloseTo(4,8);
  expect(v).toBeGreaterThanOrEqual(4);
});

test('active pit approach no longer contains instantaneous distance-triggered velocity clamps',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-pit-exit-release.js',import.meta.url),'utf8');
  expect(source).toContain('brakingDistance=current*current/(2*decel)+stopMargin');
  expect(source).toContain('pitApproachVelocityStep(current,target,decel,step)');
  expect(source).not.toContain('if(dist<34)c.v=Math.min');
  expect(source).not.toContain('if(dist<8)c.v=Math.min');
  expect(source).not.toContain('if(dist<2.2)c.v=Math.min');
});
