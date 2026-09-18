import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_REGRESSION_MONITOR__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({
    ready:!!window.__RACING_RACE__,
    status:document.querySelector('#status')?.textContent||'',
    error:document.querySelector('#error')?.textContent||''
  }));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime race was not created').toBeTruthy();
}

test('qualifying implementation is removed from the active race runtime',()=>{
  const championship=readFileSync(new URL('../../iphone-demo/runtime/race-championship-core.js',import.meta.url),'utf8');
  const gridLock=readFileSync(new URL('../../iphone-demo/runtime/race-grid-lock.js',import.meta.url),'utf8');
  const raceBase=readFileSync(new URL('../../iphone-demo/runtime/race-base.js',import.meta.url),'utf8');
  expect(championship).not.toContain("sessionPhase='QUALIFYING'");
  expect(championship).not.toContain('qualifyingClock');
  expect(championship).not.toContain('POLE POSITION');
  expect(championship).not.toContain("prop==='qualifying'");
  expect(gridLock).not.toContain("phase==='QUALIFYING'");
  expect(raceBase).not.toContain("sessionPhase==='QUALIFYING'");
});

test('runtime starts directly in the race session without qualifying data',async({page})=>{
  await boot(page);
  const state=await page.evaluate(()=>{
    const R=window.__RACING_RACE__;
    return{
      sessionPhase:R.sessionPhase,
      qualifying:R.qualifying,
      status:document.querySelector('#status')?.textContent||'',
      startGate:R.startGate
    };
  });
  expect(state.sessionPhase).toBe('RACE');
  expect(state.qualifying).toBeUndefined();
  expect(state.status).not.toContain('QUALIFYING');
  expect(state.startGate?.phase).toBe('RACE');
});
