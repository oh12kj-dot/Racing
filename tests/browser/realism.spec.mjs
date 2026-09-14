import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('Suzuka pit run is compact and merges on the home straight',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{const W=window.__RACING_WORLD__,p=W.realisticPitLayout,s=W.total*.055;return{total:W.total,p,entry:W.pitEntryFraction,exit:W.pitExitFraction,afterExitOffset:W.pitOffsetAtS(s),afterExitInPit:W.inPitWindow(s)};});
  expect(x.total).toBeGreaterThan(5200);expect(x.total).toBeLessThan(6400);
  expect(x.p?.owner).toBe('runtime-pit-realism-v1');expect(x.p.totalMeters).toBeGreaterThan(420);expect(x.p.totalMeters).toBeLessThan(520);
  expect(x.p.speedZoneMeters).toBeGreaterThan(330);expect(x.p.speedZoneMeters).toBeLessThan(410);expect(x.p.mergeAfterLineMeters).toBeLessThan(300);
  expect(x.entry).toBeCloseTo(.962,3);expect(x.exit).toBeCloseTo(.044,3);expect(x.afterExitInPit).toBeFalsy();expect(x.afterExitOffset).toBeCloseTo(5.55,1);
});

test('GT and touring hide free-floating decals and keep real-scale dimensions',async({page})=>{
  await boot(page);
  const cars=await page.evaluate(()=>['gt','touring'].map(type=>{const W=window.__RACING_WORLD__,c=W.makeCar(0x376fa8,type),l=c.userData?.livery;return{type,dims:c.userData?.dims,mode:l?.mode,free:l?.freeFloatingGraphics,visible:l?.group?.visible,decals:l?.group?.children?.filter(x=>x.name==='LIVERY_DECAL').length??0,audit:W.vehicleSizeAudit};}));
  const gt=cars.find(x=>x.type==='gt'),touring=cars.find(x=>x.type==='touring');
  for(const c of cars){expect(c.mode,JSON.stringify(c)).toBe('native-body-panels');expect(c.free,JSON.stringify(c)).toBe(false);expect(c.visible,JSON.stringify(c)).toBe(false);expect(c.decals,JSON.stringify(c)).toBe(2);}
  expect(gt.dims.length).toBeGreaterThanOrEqual(4.9);expect(gt.dims.length).toBeLessThanOrEqual(5.2);expect(gt.dims.width).toBeGreaterThanOrEqual(2.0);expect(gt.dims.width).toBeLessThanOrEqual(2.1);
  expect(touring.dims.length).toBeGreaterThanOrEqual(4.6);expect(touring.dims.length).toBeLessThanOrEqual(4.9);expect(touring.dims.width).toBeGreaterThanOrEqual(1.9);expect(touring.dims.width).toBeLessThanOrEqual(2.0);
});

test('final kinematic envelope prevents teleport acceleration and absurd corner speed',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,c=R.cars.find(x=>x.type==='gt'&&!x.retired)||R.cars[0],orig=W.braking;
    c.pitState='NONE';c.spinState='NONE';c.v=20;W.braking=()=>0;const start=c.v;R.update(.05);const accelDelta=c.v-start;
    c.v=70;W.braking=()=>1;const cornerStart=c.v;for(let i=0;i<40;i++)R.update(.05);const cornerEnd=c.v;W.braking=orig;
    return{type:c.type,accelDelta,cornerStart,cornerEnd,policy:R.kinematicPolicy};
  });
  expect(x.policy?.owner).toBe('runtime-kinematic-envelope-v1');const lim=x.policy.limits[x.type]||x.policy.limits.gt;
  expect(x.accelDelta).toBeLessThanOrEqual(lim.accel*.05+.03);expect(x.cornerEnd).toBeLessThan(x.cornerStart-15);expect(x.cornerEnd*3.6).toBeLessThan(190);expect(x.policy.corrections).toBeGreaterThan(0);
});

test('radio declares ambient iOS audio-session policy and distant rendering keeps a crisp floor',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>({audio:window.__RACING_AUDIO__?.sessionPolicy,crisp:window.__RACING_PM__?.crispPolicy,depth:window.__RACING_WORLD__?.distantRenderPolicy}));
  expect(x.audio?.desired).toBe('ambient');expect(x.crisp?.owner).toBe('runtime-crisp-distant-v1');expect(x.depth?.owner).toBe('runtime-distant-clarity-v1');expect(x.depth.cameraNear).toBeGreaterThanOrEqual(.55);expect(x.depth.cameraFar).toBeLessThanOrEqual(3400);
});
