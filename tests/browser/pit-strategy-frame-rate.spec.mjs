import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('pit strategy wear-rate smoothing is time based',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-pit-service.js',import.meta.url),'utf8');
  expect(source).toContain('function frameRateAlpha(per60,dt)');
  expect(source).toContain('alpha=frameRateAlpha(.015,dt)');
  expect(source).toContain('c._strategyWearRate+=(sampleRate-c._strategyWearRate)*alpha');
  expect(source).not.toContain('c._strategyWearRate=c._strategyWearRate*.985');
});
