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

test('launch and hazard lateral corrections are dt-normalized',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-launch-safety.js',import.meta.url),'utf8');
  expect(source).toContain('frameRateAlpha');
  expect(source).toContain('hold=frameRateAlpha(holdPer60,dt)');
  expect(source).toContain('step=frameRateAlpha(.22,dt)');
  expect(source).toContain("blend=frameRateAlpha(.12+urgency*.28,dt)");
  expect(source).not.toContain('(need-Math.abs(lateral))*.22');
});

test('launch speed discipline requests a cap instead of directly fighting final longitudinal control',()=>{
  const launch=readFileSync(new URL('../../iphone-demo/runtime/race-launch-safety.js',import.meta.url),'utf8');
  const avoidance=readFileSync(new URL('../../iphone-demo/runtime/race-contact-avoidance.js',import.meta.url),'utf8');
  const start=launch.indexOf('function launchDiscipline(dt)'),end=launch.indexOf('\n  function isHazard',start),body=launch.slice(start,end);
  expect(body).toContain('requestLaunchCap(c,cap)');
  expect(body).not.toContain('c.v=Math.min(c.v,cap)');
  expect(avoidance).toContain('c.predictiveSpeedCap=Number.isFinite(launch)&&launch>=0?launch:null');
});
