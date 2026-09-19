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

test('compatibility entry points re-export canonical runtime symbols',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const same=await page.evaluate(async()=>{
    const [legacySettings,settings,legacyCircuits,circuits,legacyUI,uiCore,legacyConfig,config]=await Promise.all([
      import('/iphone-demo/v10-settings.js'),
      import('/iphone-demo/runtime/settings.js'),
      import('/iphone-demo/v10-circuits.js'),
      import('/iphone-demo/runtime/circuits.js'),
      import('/iphone-demo/v16-ui.js'),
      import('/iphone-demo/runtime/ui-core.js'),
      import('/iphone-demo/v42-config.js'),
      import('/iphone-demo/runtime/config.js')
    ]);
    return{
      settings:legacySettings.DEFAULT_SETTINGS===settings.DEFAULT_SETTINGS&&legacySettings.loadSettings===settings.loadSettings&&legacySettings.saveSettings===settings.saveSettings&&legacySettings.resolveCircuit===settings.resolveCircuit,
      circuits:legacyCircuits.CIRCUITS===circuits.CIRCUITS&&legacyCircuits.getCircuitTrack===circuits.getCircuitTrack,
      ui:legacyUI.createUI===uiCore.createUI,
      logPolicy:legacyConfig.LOG_POLICY===config.LOG_POLICY
    };
  });
  expect(same).toEqual({settings:true,circuits:true,ui:true,logPolicy:true});
});
