import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
  await page.waitForTimeout(600);
}

test('quality-preserving performance runtime is active',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,o=R.runtimeOptimizations,s=R.strategyDynamics,c=R.collisionAvoidance,p=R.pitExitLimiterDiagnostics;
    return{
      renderPath:W.runtimeRenderPath,
      optimizer:o,
      gridSize:W.runtimeSpatialNeighbours?.size||0,
      ui:W.runtimeUIBudget,
      strategy:s,
      collision:c,
      pit:p,
      shadow:{...W.hybridShadowPolicy,selected:undefined},
      renderAssets:W.renderAssets?{state:W.renderAssets.state,decoderSupport:W.renderAssets.decoderSupport}:null
    };
  });
  expect(r.renderPath).toBe('direct-webgl-no-composer');
  expect(r.optimizer?.owner).toBe('runtime-quality-preserving-optimizations-v2');
  expect(r.optimizer?.qualityLoss).toBe(false);
  expect(r.optimizer?.spatial?.owner).toBe('runtime-spatial-grid-v2-shared');
  expect(r.optimizer?.spatial?.rebuilds,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.gridSize,JSON.stringify(r)).toBeGreaterThanOrEqual(20);
  expect(r.ui?.hz).toBe(12);
  expect(r.strategy?.decisionRate).toBe('half-fleet-per-frame');
  expect(r.strategy?.decisionUpdates,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.strategy?.decisionSkips,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.collision?.spatialGrid).toBe(true);
  expect(r.pit?.snapshotAllocations).toBe(1);
  expect(r.shadow?.owner).toBe('runtime-hybrid-vehicle-shadow-v1');
  expect(r.shadow?.selectionPolicy).toBe('allocation-free-nearest-v2');
  expect(r.renderAssets?.decoderSupport).toEqual(expect.objectContaining({ktx2:expect.any(Boolean),meshopt:expect.any(Boolean),draco:expect.any(Boolean)}));
});

test('precomputed racing lookup tables remain authoritative',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{const W=window.__RACING_WORLD__,R=window.__RACING_RACE__;return{profile:W.racingLineProfile,modes:W.racingLineModes,lookup:R.runtimeOptimizations?.trackLookup};});
  expect(r.profile?.count,JSON.stringify(r)).toBeGreaterThanOrEqual(900);
  expect(r.lookup?.centrelineSamples,JSON.stringify(r)).toBe(r.profile.count);
  expect(r.modes?.length,JSON.stringify(r)).toBeGreaterThanOrEqual(5);
});
