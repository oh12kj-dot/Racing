import {test,expect} from '@playwright/test';
import {autoCameraMode} from '../src/presentation/camera.js';

test('VIS/AUTO: presentation camera choice is deterministic and never touches race authority',()=>{
  const first=Array.from({length:48},(_,slot)=>autoCameraMode(slot,slot%24));
  const second=Array.from({length:48},(_,slot)=>autoCameraMode(slot,slot%24));
  expect(second).toEqual(first);
  for(const mode of first)expect(['TV','FOLLOW']).toContain(mode);
});

test('VIS/AUTH: rendered car orientation follows authoritative physical yaw only',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__&&!!window.__RACING_WORLD__&&!!window.__RACING_TEST_TICK__);
  const result=await page.evaluate(()=>{
    window.__RACING_TEST_TICK__(8);
    window.__RACING_LIFECYCLE__.pauseForTest();
    const sim=window.__RACING_RACE__,world=window.__RACING_WORLD__;
    const before=sim.stateHash();
    world.update(sim.snapshot());
    const car=[...sim.cars].sort((a,b)=>Math.abs(b.laneV)-Math.abs(a.laneV))[0];
    const mesh=world.carGroups.get(car.id);
    const angleError=Math.atan2(Math.sin(mesh.rotation.y-car.yaw),Math.cos(mesh.rotation.y-car.yaw));
    const after=sim.stateHash();
    return{angleError,laneV:car.laneV,before,after};
  });
  expect(Math.abs(result.laneV)).toBeGreaterThan(.02);
  expect(Math.abs(result.angleError)).toBeLessThan(1e-6);
  expect(result.after).toBe(result.before);
});
