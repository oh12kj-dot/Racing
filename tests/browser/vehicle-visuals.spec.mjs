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

test('planar sponsor decals use safe class fits and suppressed body graphics stay hidden',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,types=['formula','proto','hyper','lmh','gt','supercar','touring'];
    return types.map((type,index)=>{
      const car=W.makeCar(0x376fa8,type),l=car.userData?.livery,g=l?.group;
      if(W.camera&&car?.position)car.position.copy(W.camera.position);
      const before=g?.visible??null;
      W.updateVehicleLOD?.([{id:1000+index,type,mesh:car,retired:false,v:0}]);
      const decals=(g?.children||[]).filter(x=>x.name==='LIVERY_DECAL').map(x=>({w:x.geometry?.parameters?.width??null,h:x.geometry?.parameters?.height??null,x:Math.abs(x.position?.x||0),y:x.position?.y??0}));
      return{type,version:l?.version??0,profile:l?.sideFit?.profile||null,fit:l?.sideFit||null,before,after:g?.visible??null,freeFloating:l?.freeFloatingGraphics??null,mode:l?.mode||null,decals};
    });
  });
  const limits={formula:{w:.80,h:.20},proto:{w:1.00,h:.25},hyper:{w:1.00,h:.25},lmh:{w:1.00,h:.25},supercar:{w:1.00,h:.25}};
  for(const c of result){
    expect(c.version,JSON.stringify(c)).toBe(3);
    expect(c.profile,JSON.stringify(c)).toBeTruthy();
    expect(c.decals.length,JSON.stringify(c)).toBe(2);
    if(c.type==='gt'||c.type==='touring'){
      expect(c.freeFloating,JSON.stringify(c)).toBe(false);
      expect(c.mode,JSON.stringify(c)).toBe('native-body-panels');
      expect(c.before,JSON.stringify(c)).toBe(false);
      expect(c.after,JSON.stringify(c)).toBe(false);
      continue;
    }
    const limit=limits[c.type];
    expect(limit,`missing decal limit for ${c.type}`).toBeTruthy();
    for(const d of c.decals){expect(d.w,JSON.stringify(c)).toBeLessThanOrEqual(limit.w);expect(d.h,JSON.stringify(c)).toBeLessThanOrEqual(limit.h);}
  }
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
