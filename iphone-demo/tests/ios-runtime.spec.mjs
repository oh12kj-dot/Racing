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
  await page.locator('button[data-cam="ONBOARD"]').tap();await expect.poll(()=>page.evaluate(()=>window.__RACING__.director.mode)).toBe('ONBOARD');
});

test('iPhone WebKit lifecycle recovers after WebGL context interruption boundary',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{const L=window.__RACING_LIFECYCLE__;L.contextLostForTest();const lost=L.diagnostics();L.contextRestoredForTest();const restored=L.diagnostics();return{lost,restored};});
  expect(x.lost.paused).toBeTruthy();expect(x.lost.contextLosses).toBeGreaterThanOrEqual(1);expect(x.restored.paused).toBeFalsy();expect(x.restored.contextRestores).toBeGreaterThanOrEqual(1);
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

  await page.setViewportSize({width:844,height:390});
  await page.waitForTimeout(100);
  await expectTelemetryInViewport(page);
});

test('iPhone landscape resize updates camera aspect and keeps 24 car meshes',async({page})=>{
  await boot(page);await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);
  const x=await page.evaluate(()=>({aspect:window.__RACING_WORLD__.camera.aspect,width:innerWidth,height:innerHeight,meshes:window.__RACING_WORLD__.carGroups.size,finite:window.__RACING_RACE__.snapshot().diagnostics.finite}));
  expect(x.aspect).toBeCloseTo(x.width/x.height,2);expect(x.meshes).toBe(24);expect(x.finite).toBeTruthy();
});