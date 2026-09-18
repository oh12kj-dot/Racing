import {test,expect} from '@playwright/test';
import {damagePerformance,DAMAGE_THRESHOLDS} from '../../iphone-demo/runtime/vehicle-damage-model.js';
import fs from 'node:fs';

const zones=(suspension=0)=>({front:0,rear:0,left:0,right:0,suspension});

test('aggregate body damage no longer masquerades as suspension damage',()=>{
  const bodyDamage=damagePerformance({damage:.75,damageZones:zones(0)});
  expect(bodyDamage.heavyAggregate).toBeTruthy();
  expect(bodyDamage.severeSuspension).toBeFalsy();
  expect(bodyDamage.topSpeedScale).toBe(1);
  expect(bodyDamage.accelerationScale).toBe(1);
  expect(bodyDamage.brakeScale).toBe(1);
  expect(bodyDamage.lateralGripScale).toBe(1);
});

test('suspension damage degrades capability continuously instead of using a fixed kmh cap',()=>{
  const moderate=damagePerformance({damage:.42,damageZones:zones(.50)});
  const severe=damagePerformance({damage:.70,damageZones:zones(.80)});
  expect(moderate.severeSuspension).toBeFalsy();
  expect(severe.severeSuspension).toBeTruthy();
  for(const key of ['topSpeedScale','accelerationScale','brakeScale','lateralGripScale']){
    expect(moderate[key]).toBeLessThan(1);
    expect(severe[key]).toBeLessThan(moderate[key]);
    expect(severe[key]).toBeGreaterThan(0);
  }
  expect(DAMAGE_THRESHOLDS.severeSuspension).toBe(.72);
});

test('runtime keeps physical corner model and contains no aggregate fixed-speed punishment',()=>{
  const base=fs.readFileSync(new URL('../../iphone-demo/runtime/race-base.js',import.meta.url),'utf8');
  const physical=fs.readFileSync(new URL('../../iphone-demo/runtime/race-physical.js',import.meta.url),'utf8');
  expect(base).toContain('physicalCornerSpeedLimit');
  expect(base).toContain('tyreEnvelopeAtSpeed');
  expect(base).not.toContain('target=Math.min(target,18)');
  expect(base).not.toContain('target=Math.min(target,32)');
  expect(physical).not.toContain('c.v=Math.min(c.v,18)');
  expect(physical).not.toContain('c.v=Math.min(c.v,32)');
  expect(physical).toContain('damage.severeSuspension');
  expect(base).toContain('damagePerf.lateralGripScale');
});
