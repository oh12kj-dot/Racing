import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('race and world implementations stay owned by stable runtime modules',async({page})=>{
  await boot(page);
  await page.waitForTimeout(100);
  const result=await page.evaluate(()=>{
    const paths=performance.getEntriesByType('resource').map(e=>{try{return new URL(e.name).pathname;}catch{return String(e.name);}});
    const historical=paths.filter(p=>/^\/iphone-demo\/v\d+-(?:race|world)(?:-final)?\.js$/.test(p));
    // These two application-facing files are intentionally retained as one-line
    // compatibility entry shims. They contain no race/world implementation.
    const allowed=new Set(['/iphone-demo/v41-race.js','/iphone-demo/v42-world.js']);
    return{historical,unexpected:historical.filter(p=>!allowed.has(p))};
  });
  expect(result.unexpected,`unexpected historical implementation resources: ${result.unexpected.join(', ')}`).toEqual([]);
});
