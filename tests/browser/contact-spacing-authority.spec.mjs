import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('predictive spacing uses real headway while allowing a committed lateral pass escape',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-contact-avoidance.js',import.meta.url),'utf8');
  expect(source).toContain("reaction=caution?.24:launchAge<11?.18:(passIntent?.07:.12)");
  expect(source).toContain("desired=bodyGap+(caution?3.2:passIntent?1.5:2)");
  expect(source).toContain("ttcLimit=caution?1.9:launchAge<11?1.7:passIntent?1.02:follow.ttcLimit");
  expect(source).toContain('trafficFollowPolicy({followerType:c.type,leaderType:front.type');
  expect(source).not.toContain('c.v*reaction*.10');
});

test('physical contact uses short hysteresis so one impact is not re-emitted every frame',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-physical.js',import.meta.url),'utf8');
  expect(source).toContain('contactCooldown=new Map()');
  expect(source).toContain('now-last<.35');
  expect(source).toContain('contactCooldown.set(code,now)');
});
