import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_LIFECYCLE__),null,{timeout:30000});
}

async function expectTelemetryInViewport(page){
  const layout=await page.evaluate(()=>{
    const telemetry=document.querySelector('#telemetry')?.getBoundingClientRect();
    const controls=document.querySelector('.bottombar')?.getBoundingClientRect();
    if(!telemetry||!controls)return null;
    return{
      viewport:{width:innerWidth,height:innerHeight},
      telemetry:{left:telemetry.left,top:telemetry.top,right:telemetry.right,bottom:telemetry.bottom,width:telemetry.width,height:telemetry.height},
      controls:{left:controls.left,top:controls.top,right:controls.right,bottom:controls.bottom}
    };
  });
  expect(layout).not.toBeNull();
  expect(layout.telemetry.left).toBeGreaterThanOrEqual(0);
  expect(layout.telemetry.top).toBeGreaterThanOrEqual(0);
  expect(layout.telemetry.right).toBeLessThanOrEqual(layout.viewport.width+.5);
  expect(layout.telemetry.bottom).toBeLessThanOrEqual(layout.viewport.height+.5);
  expect(layout.telemetry.bottom).toBeLessThanOrEqual(layout.controls.top+.5);
}

async function expectTouchTargets(page){
  const sizes=await page.locator('.bottombar button').evaluateAll(buttons=>buttons.map(button=>{
    const rect=button.getBoundingClientRect();
    return{width:rect.width,height:rect.height};
  }));
  expect(sizes.length).toBeGreaterThan(0);
  for(const size of sizes){
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
}

async function expectEnergyTelemetryReadable(page){
  const layout=await page.evaluate(()=>{
    const line=[...document.querySelectorAll('#telemetry .muted')].find(node=>node.textContent?.trim().startsWith('ERS '));
    if(!line)return null;
    const rect=line.getBoundingClientRect();
    const style=getComputedStyle(line);
    return{
      text:line.textContent?.trim()||'',
      width:rect.width,
      height:rect.height,
      fontSize:parseFloat(style.fontSize)||11
    };
  });
  expect(layout).not.toBeNull();
  expect(layout.text).toContain('ERS ');
  expect(layout.width).toBeGreaterThan(170);
  expect(layout.height).toBeLessThanOrEqual(layout.fontSize*1.55);
}

test('iPhone WebKit boots, pauses/resumes and keeps touch controls usable',async({page})=>{
  await boot(page);
  expect(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches)).toBeTruthy();
  const x=await page.evaluate(()=>{
    const L=window.__RACING_LIFECYCLE__,tick=window.__RACING_TEST_TICK__;
    L.pauseForTest();const paused=tick(.1);const p=L.diagnostics();
    L.resumeForTest();const resumed=tick(.1);const r=L.diagnostics();
    return{paused,resumed,p,r};
  });
  expect(x.p.paused).toBeTruthy();expect(x.paused.paused).toBeTruthy();expect(x.r.paused).toBeFalsy();expect(x.resumed.idx).toBeGreaterThan(x.paused.idx);
  await expectTouchTargets(page);
  await page.locator('button[data-cam="ONBOARD"]').tap();await expect.poll(()=>page.evaluate(()=>window.__RACING__.director.mode)).toBe('ONBOARD');
});

test('iPhone WebKit lifecycle recovers after WebGL context interruption boundary',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{const L=window.__RACING_LIFECYCLE__;L.contextLostForTest();const lost=L.diagnostics();L.contextRestoredForTest();const restored=L.diagnostics();return{lost,restored};});
  expect(x.lost.paused).toBeTruthy();expect(x.lost.contextLosses).toBeGreaterThanOrEqual(1);expect(x.restored.paused).toBeFalsy();expect(x.restored.contextRestores).toBeGreaterThanOrEqual(1);
});

test('iPhone WebKit keeps independent pause reasons isolated',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const L=window.__RACING_LIFECYCLE__;
    L.pauseForTest();L.contextLostForTest();
    const both=L.diagnostics();
    L.contextRestoredForTest();
    const testOnly=L.diagnostics();
    L.resumeForTest();
    const clear=L.diagnostics();
    return{both,testOnly,clear};
  });
  expect(x.both.pauseReasons).toEqual(['test','webgl-context-lost']);
  expect(x.testOnly.paused).toBeTruthy();
  expect(x.testOnly.pauseReasons).toEqual(['test']);
  expect(x.clear.paused).toBeFalsy();
});

test('iPhone WebKit restarts the animation-loop owner after pagehide/pageshow restoration',async({page})=>{
  await boot(page);
  const x=await page.evaluate(async()=>{
    const L=window.__RACING_LIFECYCLE__;
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    const hidden=L.diagnostics();
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    const shown=L.diagnostics();
    return{hidden,shown};
  });
  expect(x.hidden.paused).toBeTruthy();
  expect(x.hidden.pauseReasons).toContain('pagehide');
  expect(x.hidden.rafActive).toBeFalsy();
  expect(x.shown.paused).toBeFalsy();
  expect(x.shown.pauseReasons).not.toContain('pagehide');
  expect(x.shown.rafActive).toBeTruthy();
});

test('runtime zero-duration test step is observational and does not advance simulation',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const tick=window.__RACING_TEST_TICK__;
    const before=tick(0);
    const after=tick(0);
    return{before,after};
  });
  expect(x.after.idx).toBe(x.before.idx);
  expect(x.after.time).toBe(x.before.time);
  expect(x.after.stateHash).toBe(x.before.stateHash);
});

test('iPhone hybrid telemetry stays inside the safe HUD area in portrait and landscape',async({page})=>{
  await boot(page);
  await page.evaluate(()=>window.__RACING_LIFECYCLE__.pauseForTest());
  const hybridId=await page.evaluate(()=>{
    const car=window.__RACING_RACE__.cars.find(candidate=>(candidate.systems?.energyCapacityMJ||0)>0);
    car.systems.energyMJ=car.systems.energyCapacityMJ*.625;
    car.systems.energyStrategy='DEFEND';
    car.systems.energyMode='HARVEST';
    car.systems.energyDeploy=0;
    car.systems.energyHarvest=.73;
    car.systems.energyReserveTarget=.24;
    return car.id;
  });
  await page.locator(`.lb-row[data-id="${hybridId}"]`).tap();
  await expect(page.locator('#telemetry')).toContainText('ERS 63% · DEFEND · HARVEST 73% · RSV 24%');
  await expectTelemetryInViewport(page);
  await expectEnergyTelemetryReadable(page);

  await page.setViewportSize({width:844,height:390});
  await page.waitForTimeout(100);
  await expectTelemetryInViewport(page);
  await expectEnergyTelemetryReadable(page);
});

test('small iPhone-sized portrait and landscape keep telemetry clear of controls',async({page})=>{
  await boot(page);
  await page.setViewportSize({width:320,height:568});
  await page.waitForTimeout(80);
  await expectTelemetryInViewport(page);
  await expectTouchTargets(page);
  await page.setViewportSize({width:568,height:320});
  await page.waitForTimeout(80);
  await expectTelemetryInViewport(page);
  await expectTouchTargets(page);
});

test('iPhone landscape resize updates camera aspect and keeps 24 car meshes',async({page})=>{
  await boot(page);await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);
  const x=await page.evaluate(()=>({aspect:window.__RACING_WORLD__.camera.aspect,width:innerWidth,height:innerHeight,meshes:window.__RACING_WORLD__.carGroups.size,finite:window.__RACING_RACE__.snapshot().diagnostics.finite}));
  expect(x.aspect).toBeCloseTo(x.width/x.height,2);expect(x.meshes).toBe(24);expect(x.finite).toBeTruthy();
});
