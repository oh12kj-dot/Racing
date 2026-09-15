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

test('pit lane is clear, service apron is paved, and rebuilt pit building is visible',async({page},testInfo)=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,pit=W.runtimePit,clear=pit?.buildingClearanceAudit,paving=pit?.servicePaving,paveAudit=pit?.servicePavingAudit,building=pit?.serviceBuilding,buildingAudit=pit?.serviceBuildingAudit,floors=pit?.serviceFloors||[];
    if(!pit||!clear||!paving||!paveAudit||!building||!buildingAudit||!floors.length)return{supported:false};
    return{
      supported:true,
      clearanceOwner:clear.owner,
      suppressed:clear.suppressed,
      remaining:clear.remaining,
      kinds:clear.kinds||{},
      clearanceBoxes:clear.clearanceBoxes,
      oldRuntimeGarageVisible:pit.legacyGarageOpenings?.visible!==false,
      buildingName:building.name,
      buildingVisible:building.visible!==false,
      buildingOwner:buildingAudit.owner,
      buildingCount:buildingAudit.count,
      buildingVisibleCount:buildingAudit.visibleCount,
      buildingSolids:buildingAudit.solidCount,
      buildingSigns:buildingAudit.signCount,
      buildingFrontBlockers:buildingAudit.frontBlockers,
      buildingRows:buildingAudit.rows,
      pavingName:paving.name,
      pavingVisible:paving.visible,
      floorCount:floors.length,
      floorOwners:floors.map(x=>x.userData?.owner||null),
      floorLengths:floors.map(x=>x.userData?.length||0),
      floorWidths:floors.map(x=>x.userData?.width||0),
      rayOwner:paveAudit.owner,
      rayHits:paveAudit.hitCount,
      rayTotal:paveAudit.total,
      failedTopHits:paveAudit.rows.filter(x=>!x.hit),
      circuitAudit:W.circuitAudit?.runtimePit||null
    };
  });
  expect(r.supported,JSON.stringify(r)).toBeTruthy();
  expect(r.clearanceOwner).toBe('runtime-pit-building-clearance-v5');
  expect(r.suppressed,JSON.stringify(r)).toBeGreaterThanOrEqual(10);
  expect(r.kinds['legacy-garage-hospitality-row']||0,JSON.stringify(r.kinds)).toBeGreaterThanOrEqual(8);
  expect(r.remaining,JSON.stringify(r)).toBe(0);
  expect(r.clearanceBoxes,JSON.stringify(r)).toBeGreaterThan(20);
  expect(r.oldRuntimeGarageVisible,JSON.stringify(r)).toBeFalsy();
  expect(r.buildingName).toBe('PIT_SERVICE_BUILDING_RUNTIME');
  expect(r.buildingVisible).toBeTruthy();
  expect(r.buildingOwner).toBe('runtime-pit-service-building-audit-v1');
  expect(r.buildingCount).toBe(10);
  expect(r.buildingVisibleCount).toBe(10);
  expect(r.buildingSolids,JSON.stringify(r)).toBeGreaterThanOrEqual(90);
  expect(r.buildingSigns).toBe(10);
  expect(r.buildingFrontBlockers,JSON.stringify(r.buildingRows)).toBe(0);
  expect(r.buildingRows.every(x=>x.opening&&x.visible&&x.visibleSolids>=9&&x.signs===1&&x.frontBlockers===0&&x.clearance>6&&x.workEdgeToGarageFront>4.4),JSON.stringify(r.buildingRows)).toBeTruthy();
  expect(r.pavingName).toBe('PIT_SERVICE_APRON_PAVING_RUNTIME');
  expect(r.pavingVisible).toBeTruthy();
  expect(r.floorCount).toBe(10);
  expect(r.floorOwners.every(x=>x==='runtime-pit-service-paving-v4'),JSON.stringify(r)).toBeTruthy();
  expect(Math.min(...r.floorLengths),JSON.stringify(r)).toBeGreaterThan(4.0);
  expect(Math.min(...r.floorWidths),JSON.stringify(r)).toBeGreaterThan(19.0);
  expect(r.rayOwner).toBe('runtime-pit-service-paving-audit-v4');
  expect(r.rayHits,JSON.stringify(r.failedTopHits)).toBe(r.rayTotal);
  expect(r.rayTotal).toBe(150);
  expect(r.failedTopHits,JSON.stringify(r.failedTopHits)).toEqual([]);
  expect(r.circuitAudit?.legacyBuildingIntrusionsAfter,JSON.stringify(r)).toBe(0);
  expect(r.circuitAudit?.persistentPitBuildingVisibleBays,JSON.stringify(r)).toBe(10);
  expect(r.circuitAudit?.persistentPitBuildingFrontBlockers,JSON.stringify(r)).toBe(0);
  expect(r.circuitAudit?.servicePavingFloors,JSON.stringify(r)).toBe(10);
  expect(r.circuitAudit?.servicePavingTopHits,JSON.stringify(r)).toBe(150);

  await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,pit=W.runtimePit,team=4,work=W.pitPose(W.pitBoxS(team),team,'STOP'),garage=pit.garageOpenings.children[team],cam=W.camera;
    W.renderer.setAnimationLoop?.(null);garage.updateWorldMatrix?.(true,false);
    const local=new W.THREE.Vector3(Number(garage.userData?.frontLocal)||0,0,0),front=garage.localToWorld(local);
    const dir=front.clone().sub(work.p).setY(0).normalize();
    const view=work.p.clone().addScaledVector(dir,-7.5).addScaledVector(work.t,-8.5);view.y+=4.9;
    const target=work.p.clone().lerp(front,.78);target.y+=1.25;
    cam.position.copy(view);cam.lookAt(target);cam.updateMatrixWorld();W.renderer.render(W.scene,cam);
  });
  await page.screenshot({path:testInfo.outputPath('pit-service-apron-proof.png'),fullPage:false});
});
