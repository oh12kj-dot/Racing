import {test,expect} from '@playwright/test';
import {physicalCornerSpeedLimit,tyreEnvelopeAtSpeed} from '../../iphone-demo/runtime/vehicle-performance-spec.js';

test('corner speed emerges from mechanical grip and speed-squared aero load',()=>{
  const formulaHairpin=physicalCornerSpeedLimit('formula',1/30)*3.6;
  const formulaMedium=physicalCornerSpeedLimit('formula',1/100)*3.6;
  const gtHairpin=physicalCornerSpeedLimit('gt',1/30)*3.6;
  const gtMedium=physicalCornerSpeedLimit('gt',1/100)*3.6;
  const slow=tyreEnvelopeAtSpeed('formula',25),fast=tyreEnvelopeAtSpeed('formula',70);

  // Low-speed Formula cornering must not inherit its high-speed aero capability.
  expect(formulaHairpin).toBeGreaterThan(75);
  expect(formulaHairpin).toBeLessThan(110);
  expect(formulaMedium).toBeGreaterThan(185);
  expect(formulaMedium).toBeLessThan(250);

  // Class separation comes from tyre/aero capability, not a per-corner speed percentage.
  expect(formulaHairpin).toBeGreaterThan(gtHairpin+10);
  expect(formulaMedium).toBeGreaterThan(gtMedium+55);

  // Downforce grows with v^2, while load sensitivity prevents tyre force growing linearly with load.
  expect(fast.aeroLoadG).toBeGreaterThan(slow.aeroLoadG*5);
  expect(fast.normalLoadRatio).toBeGreaterThan(slow.normalLoadRatio);
  expect(fast.mu).toBeLessThan(slow.mu);
  expect(fast.lateralAccel).toBeGreaterThan(slow.lateralAccel);
});

test('live runtime exposes the physical corner envelope used by the controller',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const x=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,tick=window.__RACING_TEST_TICK__;if(!R||typeof tick!=='function')return{ready:false};
    for(let i=0;i<80;i++)tick(.05,false);
    const c=R.cars.find(x=>x.pitState==='NONE'&&!x.retired&&x.racingCornerPhysics)||R.cars[0],p=c?.racingCornerPhysics;
    return{ready:!!p,type:c?.type,physics:p,speed:c?.v};
  });
  expect(x.ready,JSON.stringify(x)).toBeTruthy();
  expect(x.physics.mu).toBeGreaterThan(.5);
  expect(x.physics.normalLoadRatio).toBeGreaterThanOrEqual(1);
  expect(x.physics.lateralAccel).toBeGreaterThan(8);
  expect(x.physics.plannedSpeed).toBeGreaterThan(4);
  expect(x.physics.geometricCornerLimit).toBeGreaterThan(4);
});
