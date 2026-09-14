import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_LIFECYCLE__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_LIFECYCLE__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||'',touch:matchMedia('(pointer:coarse)').matches}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();expect(state.touch).toBeTruthy();
}

test('iPhone WebKit boots, pauses cleanly, and resumes without a simulation time jump',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,L=window.__RACING_LIFECYCLE__,tick=window.__RACING_TEST_TICK__,before=R.race.t;
    L.pauseForTest();tick(.05,false);const pausedTime=R.race.t,paused=L.diagnostics();
    L.resumeForTest();tick(.05,false);const resumedTime=R.race.t,resumed=L.diagnostics();
    return{before,pausedTime,resumedTime,paused,resumed};
  });
  expect(x.paused.owner).toBe('runtime-lifecycle-v1');expect(x.paused.paused).toBeTruthy();expect(x.pausedTime).toBeCloseTo(x.before,7);
  expect(x.resumed.paused).toBeFalsy();expect(x.resumed.resumeCount).toBeGreaterThanOrEqual(1);expect(x.resumedTime).toBeGreaterThan(x.pausedTime);
});

test('iPhone WebKit recovers the runtime boundary after a WebGL context interruption',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const L=window.__RACING_LIFECYCLE__;L.contextLostForTest();const lost=L.diagnostics();L.contextRestoredForTest();const restored=L.diagnostics();return{lost,restored};
  });
  expect(x.lost.paused).toBeTruthy();expect(x.lost.contextLosses).toBe(1);expect(x.restored.paused).toBeFalsy();expect(x.restored.contextRestores).toBe(1);
});

test('iPhone landscape resize updates renderer camera aspect',async({page})=>{
  await boot(page);await page.setViewportSize({width:844,height:390});await page.waitForTimeout(80);
  const x=await page.evaluate(()=>({aspect:window.__RACING_WORLD__.camera.aspect,width:innerWidth,height:innerHeight,error:document.querySelector('#status')?.textContent==='ERROR'}));
  expect(x.error).toBeFalsy();expect(x.aspect).toBeCloseTo(x.width/x.height,2);expect(x.aspect).toBeGreaterThan(1.8);
});
