import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__);return ready||document.querySelector('#status')?.textContent==='ERROR';},null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('high-aero procedural fallbacks carry class-specific visual detail',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{const W=window.__RACING_WORLD__;return ['formula','proto','hyper','lmh'].map(type=>{const car=W.makeCar(0x376fa8,type),x=car.userData?.classVisualUpgrade||null;return{type,version:x?.version??0,parts:x?.parts??0,dims:car.userData?.dims||null};});});
  for(const item of result){expect(item.version,`${item.type} visual upgrade version`).toBe(1);expect(item.parts,`${item.type} added visual parts`).toBeGreaterThanOrEqual(item.type==='formula'?18:12);expect(item.dims,`${item.type} simulation dimensions must remain defined`).toBeTruthy();}
});
