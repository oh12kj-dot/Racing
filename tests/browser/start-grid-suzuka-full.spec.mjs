import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_REGRESSION_MONITOR__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('initial race grid gate holds HUD speed at zero until green',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const r=await page.evaluate(async()=>{
    const {resolveStartGateState,getDisplaySpeedKmh}=await import('/iphone-demo/runtime/race-grid-lock.js');
    const pre=resolveStartGateState({sessionPhase:'RACE',flag:'RED',raceTime:41,greenTime:47,launchComplete:false});
    const lights=resolveStartGateState({sessionPhase:'RACE',flag:'GREEN',raceTime:46.8,greenTime:47,launchComplete:false});
    const green=resolveStartGateState({sessionPhase:'RACE',flag:'GREEN',raceTime:47.01,greenTime:47,launchComplete:false});
    return{pre,lights,green,hidden:getDisplaySpeedKmh({v:12},true),live:getDisplaySpeedKmh({v:12},false)};
  });
  expect(r.pre.preStart).toBeTruthy();
  expect(r.lights.preStart).toBeTruthy();
  expect(r.green.canLaunch).toBeTruthy();
  expect(r.hidden).toBe(0);
  expect(r.live).toBeCloseTo(43.2,4);
});

test('launch audio gets clutch-slip presence without revving before green',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const r=await page.evaluate(async()=>{
    const {resolveLaunchAudioPolicy}=await import('/iphone-demo/runtime/audio-silent-policy.js');
    return{
      grid:resolveLaunchAudioPolicy({speedKmh:2.4,movementAllowed:false,launchAge:0}),
      launch:resolveLaunchAudioPolicy({speedKmh:1.0,movementAllowed:true,launchAge:.08}),
      settled:resolveLaunchAudioPolicy({speedKmh:18,movementAllowed:true,launchAge:1.8})
    };
  });
  expect(r.grid.moving,JSON.stringify(r)).toBeFalsy();
  expect(r.grid.audibleKmh).toBe(0);
  expect(r.launch.moving,JSON.stringify(r)).toBeTruthy();
  expect(r.launch.launchWindow).toBeTruthy();
  expect(r.launch.audibleKmh,JSON.stringify(r)).toBeGreaterThan(12);
  expect(r.launch.throttleFloor,JSON.stringify(r)).toBeGreaterThan(.8);
  expect(r.settled.launchWindow).toBeFalsy();
  expect(r.settled.audibleKmh).toBe(18);
});

test('Suzuka scenery covers the full lap and major venue landmarks',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,F=W?.suzukaFullScene,a=W?.circuitAudit?.suzukaFullScene;
    return{owner:F?.owner,count:F?.count||0,treeInstances:F?.treeInstances||0,coverage:F?.courseCoverage||null,byType:F?.byType||{},names:(F?.landmarks||[]).map(x=>x.name),audit:a};
  });
  expect(r.owner).toBe('runtime-suzuka-full-scene-v1');
  expect(r.count,JSON.stringify(r)).toBeGreaterThanOrEqual(95);
  expect(r.treeInstances).toBeGreaterThanOrEqual(160);
  expect(r.coverage?.start).toBe(0);expect(r.coverage?.end).toBe(1);expect(r.coverage?.sectors).toBe(18);
  expect(r.byType.grandstand||0).toBeGreaterThanOrEqual(10);
  expect(r.byType.marshal||0).toBeGreaterThanOrEqual(18);
  expect(r.byType.camera||0).toBeGreaterThanOrEqual(12);
  expect(r.byType['service-road']||0).toBeGreaterThanOrEqual(32);
  for(const name of['FIRST_CORNER_GRANDSTAND','S_CURVE_GRANDSTAND','GYAKU_BANK_GRANDSTAND','DUNLOP_VIEWING','DEGNER_VIEWING','HAIRPIN_GRANDSTAND','SPOON_GRANDSTAND','WEST_STRAIGHT_VIEWING','130R_GRANDSTAND','CHICANE_GRANDSTAND','WEST_CONTROL_TOWER','FERRIS_WHEEL','SUZUKA_CIRCUIT_PARK','HOTEL_THE_MAIN','FAMILY_CAMP','STEC_TRAFFIC_EDUCATION_CENTER','MAIN_GATE','WEST_FANZONE','POND'])expect(r.names,`missing ${name}: ${JSON.stringify(r)}`).toContain(name);
  expect(r.audit?.owner).toBe('runtime-suzuka-full-scene-v1');
  expect(r.audit?.treeInstances).toBe(r.treeInstances);
});
