import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('quality-preserving optimizer is active without lowering render path quality',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{for(let i=0;i<5;i++)window.__RACING_TEST_TICK__?.(.016,false);});
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,o=R.runtimeOptimizations,s=R.strategyDynamics,c=R.collisionAvoidance;
    return{renderPath:W.runtimeRenderPath,opt:o,ui:W.runtimeUIBudget,strategy:s,collision:c,shadow:{...W.hybridShadowPolicy,selected:undefined},atlas:W.runtimeTextureAtlas};
  });
  expect(r.renderPath).toBe('direct-webgl-no-composer');
  expect(r.opt?.qualityLoss,JSON.stringify(r)).toBe(false);
  expect(r.opt?.spatial?.entries,JSON.stringify(r)).toBeGreaterThanOrEqual(20);
  expect(r.opt?.spatial?.rebuilds,JSON.stringify(r)).toBeGreaterThanOrEqual(1);
  expect(r.opt?.vehicleResources?.geometryReused,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.opt?.staticBatch?.meshesBatched,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.ui?.hz).toBe(12);
  expect(r.strategy?.decisionRate).toBe('half-fleet-per-frame');
  expect(r.strategy?.decisionUpdates,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.collision?.spatialGrid).toBe(true);
  expect(r.shadow?.owner).toBe('runtime-hybrid-vehicle-shadow-v1');
  expect(r.shadow?.selectionPolicy).toBe('allocation-free-nearest-v2');
});

test('track/racing-line lookup tables remain the authoritative high-frequency path',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,o=R.runtimeOptimizations;return{profile:W.racingLineProfile,modes:W.racingLineModes,lookup:o?.trackLookup};});
  expect(r.profile?.count,JSON.stringify(r)).toBeGreaterThanOrEqual(900);
  expect(r.lookup?.centrelineSamples,JSON.stringify(r)).toBe(r.profile.count);
  expect(r.modes?.length,JSON.stringify(r)).toBeGreaterThanOrEqual(5);
});
