import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_PM__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const s=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(s.status,s.error||'runtime boot').not.toBe('ERROR');expect(s.ready,s.error||'runtime globals').toBeTruthy();
}

test('Suzuka terrain replaces flat ground and owns scenery grounding',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{const W=window.__RACING_WORLD__;return{terrain:{...W.terrain,mesh:undefined},terrainMesh:!!W.scene.getObjectByName('SUZUKA_TERRAIN_RUNTIME'),height0:W.terrainHeightAt?.(0,0),hygiene:W.sceneHygiene,placement:W.suzukaPlacement?.clearance,landmarks:Object.keys(W.suzukaPlacement?.absoluteLandmarks||{}),tv:(W.tvCameraAnchors||[]).map(a=>a.name)};});
  expect(x.terrain.owner).toBe('runtime-suzuka-terrain-v1');expect(x.terrain.replacedFlatGround).toBeTruthy();expect(x.terrainMesh).toBeTruthy();expect(Number.isFinite(x.height0)).toBeTruthy();
  expect(x.hygiene.owner).toBe('runtime-scene-hygiene-v2');expect(x.hygiene.groundModel).toBe('terrain-height-field');expect(x.hygiene.minTreeTrackClearance).toBeGreaterThanOrEqual(41.9);
  expect(x.landmarks.length).toBeGreaterThanOrEqual(10);expect(x.tv.length).toBeGreaterThanOrEqual(9);for(const n of['T1/T2','S CURVES','DEGNER','HAIRPIN','SPOON','130R','CHICANE'])expect(x.tv).toContain(n);
  expect(x.placement.rows.filter(r=>r.bad&&r.visible).length).toBe(0);
});

test('hybrid shadows keep only a small near-camera caster set',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,P=window.__RACING_PM__,r=W.updateHybridVehicleShadows?.(R.cars,true);let castCars=0;for(const c of R.cars){const contact=c.mesh?.userData?.contactShadow;let casts=false;c.mesh?.traverse?.(o=>{if(o?.isMesh&&o!==contact&&o.castShadow)casts=true;});if(casts)castCars++;}return{policy:{...W.hybridShadowPolicy,selected:undefined},result:r,castCars,hz:P.hybridShadowHz};});
  expect(x.policy.owner).toBe('runtime-hybrid-vehicle-shadow-v1');expect(x.policy.contactShadowAll).toBeTruthy();expect(x.castCars).toBeLessThanOrEqual(x.policy.maxCasters);expect(x.castCars).toBeGreaterThan(0);expect(x.hz).toBeGreaterThan(0);
});

test('strategy helpers model tyre condition draft dirty air and pass lane',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const x=await page.evaluate(async()=>{const m=await import('/iphone-demo/runtime/race-strategy-dynamics.js');return{fresh:m.resolveTyreGrip({compound:'MEDIUM',wear:.05,tempC:92,wetness:0}),worn:m.resolveTyreGrip({compound:'MEDIUM',wear:.9,tempC:92,wetness:0}),dryWetTyre:m.resolveTyreGrip({compound:'WET',wear:.05,tempC:62,wetness:0}),wetWetTyre:m.resolveTyreGrip({compound:'WET',wear:.05,tempC:62,wetness:.85}),draft:m.resolveDraft({gapM:18,lateralM:.4,cornerLoad:.05}),dirty:m.resolveDraft({gapM:18,lateralM:.4,cornerLoad:.9}),lane:m.choosePassLane({carLane:.2,aheadLane:.5,curvature:.004,seed:4})};});
  expect(x.fresh.grip).toBeGreaterThan(x.worn.grip);expect(x.wetWetTyre.grip).toBeGreaterThan(x.dryWetTyre.grip);expect(x.draft.slipstream).toBeGreaterThan(.3);expect(x.dirty.dirtyAir).toBeGreaterThan(.2);expect(Math.abs(x.lane)).toBeLessThanOrEqual(3.05);
});

test('live race exposes evolving tyre fuel and traffic strategy telemetry',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{const R=window.__RACING_RACE__,tick=window.__RACING_TEST_TICK__,c=R.cars[0];for(let i=0;i<80;i++)tick(.05,false);return{owner:R.strategyDynamics?.owner,telemetry:c.strategyTelemetry,state:R.strategyFor?.(c.id),replay:window.__RACING_REPLAY__?.diagnostics,motion:window.__RACING_VEHICLE_MOTION__?.diagnostics};});
  expect(x.owner).toBe('runtime-strategy-dynamics-v1');expect(x.telemetry.compound).toBeTruthy();expect(x.telemetry.fuelKg).toBeGreaterThan(0);expect(x.telemetry.tyreTempC).toBeGreaterThan(30);expect(x.state.fuelKg).toBeLessThan(x.state.fuelCapacity);expect(x.replay.owner).toBe('runtime-replay-v1');expect(x.motion.owner).toBe('runtime-vehicle-motion-v1');
});
