import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('hazard avoidance is applied once after the lower race stack',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-launch-safety.js',import.meta.url),'utf8');
  const start=source.indexOf('function update(dt){');
  const end=source.indexOf('\n  return new Proxy',start);
  expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
  const body=source.slice(start,end),calls=body.match(/avoidHazards\(dt\)/g)||[];
  expect(calls).toHaveLength(1);
  expect(body.indexOf('baseUpdate(dt)')).toBeGreaterThanOrEqual(0);
  expect(body.indexOf('avoidHazards(dt)')).toBeGreaterThan(body.indexOf('baseUpdate(dt)'));
});
