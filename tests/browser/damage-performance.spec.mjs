import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {damageFaultState,damagePerformanceFactors,performanceFor} from '../../iphone-demo/runtime/vehicle-performance-spec.js';

test('heavy body damage is not mislabeled as suspension failure',()=>{
  const body=damageFaultState({damage:.72,suspension:.18});
  const suspension=damageFaultState({damage:.55,suspension:.76});
  expect(body.retire).toBeFalsy();
  expect(body.pit).toBeTruthy();
  expect(body.fault).toBe('HEAVY BODY DAMAGE');
  expect(body.state).toBe('HEAVY');
  expect(suspension.retire).toBeFalsy();
  expect(suspension.pit).toBeTruthy();
  expect(suspension.fault).toBe('SUSPENSION DAMAGE');
});

test('damage degrades the physical envelope continuously instead of selecting a canned speed',()=>{
  const healthy=damagePerformanceFactors({damage:0,damageZones:{suspension:0}});
  const moderate=damagePerformanceFactors({damage:.45,damageZones:{suspension:.12}});
  const heavy=damagePerformanceFactors({damage:.72,damageZones:{suspension:.18}});
  const suspension=damagePerformanceFactors({damage:.72,damageZones:{suspension:.76}});
  for(const key of ['top','accel','brake','lateral']){
    expect(healthy[key]).toBeCloseTo(1,8);
    expect(moderate[key]).toBeLessThanOrEqual(healthy[key]);
    expect(heavy[key]).toBeLessThanOrEqual(moderate[key]);
    expect(suspension[key]).toBeLessThanOrEqual(heavy[key]);
    expect(suspension[key]).toBeGreaterThan(0);
  }
  const justBelow=damagePerformanceFactors({damage:.679,damageZones:{suspension:.10}});
  const justAbove=damagePerformanceFactors({damage:.681,damageZones:{suspension:.10}});
  expect(Math.abs(justBelow.top-justAbove.top)).toBeLessThan(.002);
  expect(Math.abs(justBelow.accel-justAbove.accel)).toBeLessThan(.002);
});

test('the same damage remains class-relative rather than forcing every class to one speed',()=>{
  const damaged=damagePerformanceFactors({damage:.72,damageZones:{suspension:.18}});
  const formulaTop=performanceFor('formula').top*damaged.top;
  const touringTop=performanceFor('touring').top*damaged.top;
  expect(formulaTop).toBeGreaterThan(touringTop);
  expect(formulaTop-touringTop).toBeGreaterThan(15);
});

test('active crash layers contain no legacy 18 or 32 m/s damage target clamps',()=>{
  const physical=readFileSync(new URL('../../iphone-demo/runtime/race-physical.js',import.meta.url),'utf8');
  const base=readFileSync(new URL('../../iphone-demo/runtime/race-base.js',import.meta.url),'utf8');
  expect(physical).toContain("damageFaultState({damage:c.damage,suspension:z.suspension,forced})");
  expect(physical).not.toContain("(z.suspension||0)>=.72||(c.damage||0)>=.68");
  expect(physical).not.toContain('c.v=Math.min(c.v,18)');
  expect(physical).not.toContain('c.v=Math.min(c.v,32)');
  expect(base).toContain('damagePerformanceFactors(c)');
  expect(base).not.toContain('target=Math.min(target,18)');
  expect(base).not.toContain('target=Math.min(target,32)');
});
