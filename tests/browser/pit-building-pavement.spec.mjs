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

test('pit lane has no legacy ground building intrusion and the garage apron is continuously paved',async({page},testInfo)=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,pit=W.runtimePit,clear=pit?.buildingClearanceAudit,paving=pit?.servicePaving,audit=pit?.servicePavingAudit;
    if(!pit||!clear||!paving||!audit)return{supported:false};
    const u=paving.userData||{};
    const boxFractions=[];
    for(let team=0;team<10;team++)boxFractions.push(W.pitUnwrappedFraction(W.pitBoxS(team)));
    return{
      supported:true,
      clearanceOwner:clear.owner,
      suppressed:clear.suppressed,
      remaining:clear.remaining,
      clearInnerOffset:clear.clearInnerOffset,
      clearOuterOffset:clear.clearOuterOffset,
      serviceStartUF:clear.serviceStartUF,
      serviceEndUF:clear.serviceEndUF,
      pavingName:paving.name,
      pavingVisible:paving.visible,
      pavingOwner:u.owner,
      pavingInnerOffset:u.innerOffset,
      pavingOuterOffset:u.outerOffset,
      pavingWidth:u.width,
      garageFrontOutward:u.garageFrontOutward,
      overlapIntoGarage:u.overlapIntoGarage,
      pavingVertexCount:paving.geometry?.getAttribute?.('position')?.count||0,
      rayOwner:audit.owner,
      rayHits:audit.hitCount,
      rayTotal:audit.total,
      rayRows:audit.rows,
      boxFractions,
      circuitAudit:W.circuitAudit?.runtimePit||null
    };
  });
  expect(r.supported,JSON.stringify(r)).toBeTruthy();
  expect(r.clearanceOwner).toBe('runtime-pit-building-clearance-v2');
  expect(r.suppressed,JSON.stringify(r)).toBeGreaterThanOrEqual(1);
  expect(r.remaining,JSON.stringify(r)).toBe(0);
  expect(r.clearOuterOffset,JSON.stringify(r)).toBeGreaterThan(8.5);
  expect(r.pavingName).toBe('PIT_SERVICE_APRON_PAVING_RUNTIME');
  expect(r.pavingVisible).toBeTruthy();
  expect(r.pavingOwner).toBe('runtime-pit-service-paving-v1');
  expect(r.pavingInnerOffset,JSON.stringify(r)).toBeLessThanOrEqual(5.05);
  expect(r.pavingOuterOffset,JSON.stringify(r)).toBeGreaterThanOrEqual(r.garageFrontOutward);
  expect(r.overlapIntoGarage,JSON.stringify(r)).toBeGreaterThan(.05);
  expect(r.pavingWidth,JSON.stringify(r)).toBeGreaterThan(5.0);
  expect(r.pavingVertexCount,JSON.stringify(r)).toBeGreaterThan(140);
  expect(r.rayOwner).toBe('runtime-pit-service-paving-audit-v1');
  expect(r.rayHits,JSON.stringify(r)).toBe(r.rayTotal);
  expect(r.rayTotal).toBe(10);
  expect(r.rayRows.every(x=>x.hit),JSON.stringify(r.rayRows)).toBeTruthy();
  expect(Math.min(...r.boxFractions),JSON.stringify(r)).toBeGreaterThan(r.serviceStartUF);
  expect(Math.max(...r.boxFractions),JSON.stringify(r)).toBeLessThan(r.serviceEndUF);
  expect(r.circuitAudit?.legacyBuildingIntrusionsAfter,JSON.stringify(r)).toBe(0);
  expect(r.circuitAudit?.servicePavingRayHits,JSON.stringify(r)).toBe(10);

  await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,pit=W.runtimePit,team=4,work=W.pitPose(W.pitBoxS(team),team,'STOP'),cam=W.camera;
    W.renderer.setAnimationLoop?.(null);
    const view=work.p.clone().addScaledVector(work.side,-11).addScaledVector(work.t,-7);view.y+=5.2;
    const target=work.p.clone().addScaledVector(work.side,5.8);target.y+=.8;
    cam.position.copy(view);cam.lookAt(target);cam.updateMatrixWorld();W.renderer.render(W.scene,cam);
  });
  await page.screenshot({path:testInfo.outputPath('pit-service-apron-proof.png'),fullPage:false});
});
