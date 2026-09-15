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

test('Suzuka scenery covers the full lap with figure-eight clearance',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,F=W?.suzukaFullScene,a=W?.circuitAudit?.suzukaFullScene,T=W?.THREE;
    const root=F?.root,trunks=root?.getObjectByName?.('SUZUKA_PERIMETER_TREE_TRUNKS'),m=new T.Matrix4(),p=new T.Vector3(),track=[];
    for(let i=0;i<720;i++){const q=W.sample(W.total*i/720).p;track.push([q.x,q.z]);}
    let minTreeClearance=Infinity;
    if(trunks)for(let i=0;i<trunks.count;i++){trunks.getMatrixAt(i,m);p.setFromMatrixPosition(m);for(const q of track)minTreeClearance=Math.min(minTreeClearance,Math.hypot(p.x-q[0],p.z-q[1]));}
    const y=name=>root?.getObjectByName?.(name)?.position?.y;
    return{owner:F?.owner,count:F?.count||0,treeInstances:F?.treeInstances||0,treeRejected:F?.treeRejected||0,minTreeClearance,groundedFarObjects:F?.groundedFarObjects||0,skippedUnsafeObjects:F?.skippedUnsafeObjects||0,coverage:F?.courseCoverage||null,byType:F?.byType||{},names:(F?.landmarks||[]).map(x=>x.name),audit:a,farY:{wheel:y('SUZUKA_FERRIS_WHEEL'),hotel:y('SUZUKA_HOTEL_THE_MAIN'),parking:y('SUZUKA_WEST_COURSE_PARKING')}};
  });
  expect(r.owner).toBe('runtime-suzuka-full-scene-v2');
  expect(r.count,JSON.stringify(r)).toBeGreaterThanOrEqual(90);
  expect(r.treeInstances).toBeGreaterThanOrEqual(150);
  expect(r.minTreeClearance,JSON.stringify(r)).toBeGreaterThan(17.5);
  expect(r.groundedFarObjects).toBeGreaterThan(10);
  for(const y of Object.values(r.farY))expect(y).toBeCloseTo(-.22,2);
  expect(r.coverage?.start).toBe(0);expect(r.coverage?.end).toBe(1);expect(r.coverage?.sectors).toBe(18);
  expect((r.byType.grandstand||0)+(r.byType['grandstand-skipped']||0)).toBe(10);
  expect((r.byType.marshal||0)+(r.byType['marshal-skipped']||0)).toBe(18);
  expect((r.byType.camera||0)+(r.byType['camera-skipped']||0)).toBe(12);
  expect((r.byType['service-road']||0)+(r.byType['service-road-skipped']||0)).toBe(32);
  for(const name of['FIRST_CORNER_GRANDSTAND','S_CURVE_GRANDSTAND','GYAKU_BANK_GRANDSTAND','DUNLOP_VIEWING','DEGNER_VIEWING','HAIRPIN_GRANDSTAND','SPOON_GRANDSTAND','WEST_STRAIGHT_VIEWING','130R_GRANDSTAND','CHICANE_GRANDSTAND','WEST_CONTROL_TOWER','FERRIS_WHEEL','SUZUKA_CIRCUIT_PARK','HOTEL_THE_MAIN','FAMILY_CAMP','STEC_TRAFFIC_EDUCATION_CENTER','MAIN_GATE','WEST_FANZONE','POND'])expect(r.names,`missing ${name}: ${JSON.stringify(r)}`).toContain(name);
  expect(r.audit?.owner).toBe('runtime-suzuka-full-scene-v2');
  expect(r.audit?.treeInstances).toBe(r.treeInstances);
});

test('superseded generic scenery is removed and moving cars use frame-locked contact shadows',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,scene=W.scene;
    let oldTrees=0,oldStands=0,oldGantries=0;
    for(const o of scene.children){
      if(o.isMesh&&o.geometry){const p=o.geometry.parameters||{};if((o.geometry.type==='CylinderGeometry'&&Math.abs((p.height||0)-5.5)<.08&&(p.radialSegments||0)===6)||(o.geometry.type==='IcosahedronGeometry'&&(p.radius||0)>3.5))oldTrees++;}
      if(!o.isGroup)continue;let tiers=0,posts=0,beam=0;o.traverse(x=>{if(!x.isMesh||x.geometry?.type!=='BoxGeometry')return;const p=x.geometry.parameters||{};if(Math.abs((p.width||0)-38)<.08&&Math.abs((p.height||0)-1.2)<.08&&Math.abs((p.depth||0)-5)<.08)tiers++;if(Math.abs((p.width||0)-.5)<.04&&Math.abs((p.height||0)-7)<.08&&Math.abs((p.depth||0)-.5)<.04)posts++;if(Math.abs((p.width||0)-19)<.10&&Math.abs((p.height||0)-.65)<.05&&Math.abs((p.depth||0)-.7)<.05)beam++;});if(tiers>=5)oldStands++;if(posts>=2&&beam>=1)oldGantries++;
    }
    const cars=R.cars.map(c=>{let casters=0,contact=0;c.mesh.traverse(o=>{if(!o.isMesh)return;if(o.name==='CAR_CONTACT_SHADOW')contact++;else if(o.castShadow)casters++;});return{casters,contact,policy:c.mesh.userData?.vehicleShadowPolicy||null};});
    return{cleanup:W.legacyWorldCleanup||{},oldTrees,oldStands,oldGantries,cars,visualPolicy:W.visualEnhancements?.vehicleShadowPolicy,disabled:W.visualEnhancements?.dynamicVehicleCastersDisabled||0};
  });
  expect(r.oldTrees,JSON.stringify(r)).toBe(0);
  expect(r.oldStands,JSON.stringify(r)).toBe(0);
  expect(r.oldGantries,JSON.stringify(r)).toBe(0);
  expect(r.cleanup.legacyTreesRemoved).toBeGreaterThan(0);
  expect(r.visualPolicy).toBe('contact-only');
  expect(r.disabled).toBeGreaterThan(0);
  for(const c of r.cars){expect(c.contact,JSON.stringify(r.cars)).toBe(1);expect(c.casters,JSON.stringify(r.cars)).toBe(0);expect(c.policy).toBe('contact-only');}
});
