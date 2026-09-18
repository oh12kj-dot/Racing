import {test,expect} from '@playwright/test';

test('startup goes directly to the normal grid and lights without a qualifying session',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>{
    const R=window.__RACING_RACE__;
    return{
      ready:!!R,
      status:document.querySelector('#status')?.textContent||'',
      error:document.querySelector('#error')?.textContent||'',
      sessionPhase:R?.sessionPhase??null,
      hasQualifying:Array.isArray(R?.qualifying),
      carCount:R?.cars?.length||0
    };
  });
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime race was not created').toBeTruthy();
  expect(state.status).not.toContain('QUALIFYING');
  expect(state.sessionPhase).not.toBe('QUALIFYING');
  expect(state.hasQualifying).toBeFalsy();
  expect(state.carCount).toBeGreaterThan(0);
});
