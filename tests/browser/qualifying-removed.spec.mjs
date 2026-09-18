import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_REGRESSION_MONITOR__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!window.__RACING_RACE__,status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'race runtime was not created').toBeTruthy();
}

test('qualifying session is removed from the race runtime',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__;
    return{
      phase:R.sessionPhase,
      qualifying:R.qualifying??null,
      status:document.querySelector('#status')?.textContent||'',
      gate:R.startGate||null,
      firstRows:R.cars.slice(0,6).map(c=>({id:c.id,position:c.position,lap:c.lap,s:c.s,lane:c.lane}))
    };
  });
  expect(r.phase,JSON.stringify(r)).toBe('RACE');
  expect(r.qualifying,JSON.stringify(r)).toBeNull();
  expect(r.status,JSON.stringify(r)).not.toContain('QUALIFYING');
  expect(r.gate?.nonRace,JSON.stringify(r)).toBeFalsy();
  expect(r.firstRows.map(c=>c.id)).toEqual([0,1,2,3,4,5]);
});

test('qualifying simulation presentation and qualifying-derived grid code stay deleted',async()=>{
  const championship=await readFile('iphone-demo/runtime/race-championship-core.js','utf8');
  const progress=await readFile('iphone-demo/runtime/race-progress.js','utf8');
  const director=await readFile('iphone-demo/runtime/director.js','utf8');
  expect(championship).not.toContain("sessionPhase='QUALIFYING'");
  expect(championship).not.toContain('qualifyingClock');
  expect(championship).not.toContain('POLE POSITION');
  expect(championship).not.toContain("prop==='qualifying'");
  expect(progress).not.toContain('base.qualifying');
  expect(progress).not.toContain("sessionPhase!=='QUALIFYING'");
  expect(director).not.toContain("sessionPhase==='QUALIFYING'");
  expect(director).not.toContain("banner='QUALIFYING'");
  expect(championship).toContain("const sessionPhase='RACE',raceStarted=true");
  expect(progress).toContain('const row=Math.floor(pos/2)');
});
