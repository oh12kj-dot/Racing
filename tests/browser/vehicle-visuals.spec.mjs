import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_ASSETS__);return ready||document.querySelector('#status')?.textContent==='ERROR';},null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_ASSETS__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('high-aero procedural fallbacks carry class-specific visual detail',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{const W=window.__RACING_WORLD__;return ['formula','proto','hyper','lmh'].map(type=>{const car=W.makeCar(0x376fa8,type),x=car.userData?.classVisualUpgrade||null;return{type,version:x?.version??0,parts:x?.parts??0,dims:car.userData?.dims||null};});});
  for(const item of result){expect(item.version,`${item.type} visual upgrade version`).toBe(2);expect(item.parts,`${item.type} added visual parts`).toBeGreaterThanOrEqual(item.type==='formula'?18:12);expect(item.dims,`${item.type} simulation dimensions must remain defined`).toBeTruthy();}
});

test('closed prototype classes do not retain the generic tall cage or pilot rig',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{const W=window.__RACING_WORLD__;return ['proto','hyper','lmh'].map(type=>{const car=W.makeCar(0x376fa8,type);return{type,suppressed:!!car.userData?.closedCockpitInteriorSuppressed,fineAttached:!!car.getObjectByName?.('V13_FINE_INTERIOR'),upgradeAttached:!!car.getObjectByName?.('CLASS_VISUAL_UPGRADE_V1'),version:car.userData?.classVisualUpgrade?.version??0};});});
  for(const c of result){expect(c.suppressed,JSON.stringify(c)).toBeTruthy();expect(c.fineAttached,JSON.stringify(c)).toBeFalsy();expect(c.upgradeAttached,JSON.stringify(c)).toBeTruthy();expect(c.version).toBe(2);}
});

test('GLB replacement path detaches legacy driver cage and procedural body permanently',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,AM=window.__RACING_ASSETS__,c=R.cars.find(x=>x.mesh?.userData?.v13Fine)||R.cars[0];
    if(!c||typeof AM?.detachLegacyCarLayers!=='function')return{supported:false};
    const before={fine:!!c.mesh.getObjectByName?.('V13_FINE_INTERIOR'),visual:c.mesh.userData?.visual?.parent===c.mesh};
    AM.detachLegacyCarLayers(c);
    // Simulate the exact path that previously resurrected the pilot/cage for near cars.
    W.updateVehicleLOD?.(R.cars);
    return{
      supported:true,before,
      fineAttached:!!c.mesh.getObjectByName?.('V13_FINE_INTERIOR'),
      damageAttached:!!c.mesh.getObjectByName?.('V13_DAMAGE_PARTS'),
      classAttached:!!c.mesh.getObjectByName?.('CLASS_VISUAL_UPGRADE_V1'),
      visualAttached:c.mesh.userData?.visual?.parent===c.mesh,
      detached:!!c.mesh.userData?.renderAssetUsesDetachedFallback,
      hidden:c.mesh.userData?.renderAssetHiddenLegacy||[]
    };
  });
  expect(result.supported,JSON.stringify(result)).toBeTruthy();
  expect(result.before.fine||result.before.visual,'the selected procedural car should contain a legacy visual layer before replacement').toBeTruthy();
  expect(result.detached,JSON.stringify(result)).toBeTruthy();expect(result.fineAttached,JSON.stringify(result)).toBeFalsy();expect(result.damageAttached,JSON.stringify(result)).toBeFalsy();expect(result.classAttached,JSON.stringify(result)).toBeFalsy();expect(result.visualAttached,JSON.stringify(result)).toBeFalsy();
});
