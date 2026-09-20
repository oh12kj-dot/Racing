import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('legacy championship battle AI yields lane and battle state to runtime racecraft',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-championship-core.js',import.meta.url),'utf8');
  expect(source).toContain("laneIntentOwnedElsewhere=()=>W.runtimeRacecraftAuthority==='runtime-racecraft-v2'");
  expect(source).toContain('if(laneIntentOwnedElsewhere())continue;');
  expect(source).toContain('prepareDRSAndBattle(dt)');
  expect(source).toContain('frameRateAlpha(.22,dt)');
  expect(source).toContain('frameRateAlpha(.18+.10*c.driver.aggression,dt)');
  expect(source).toContain('frameRateAlpha(.32,dt)');
});
