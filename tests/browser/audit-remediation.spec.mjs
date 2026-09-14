import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_DIRECTOR__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('director retains simultaneous events instead of dropping lower-priority stories',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,D=window.__RACING_DIRECTOR__,c=R.cars.find(v=>!v.retired)||R.cars[0],tag=`audit-${Date.now()}`,t=R.race.t;
    R.events.push({id:`${tag}-fast`,type:'FASTEST_LAP',carId:c.id,t},{id:`${tag}-pass`,type:'OVERTAKE',carId:c.id,t},{id:`${tag}-contact`,type:'CONTACT',carId:c.id,t});
    D.update();const afterFirst={banner:D.banner,pending:D.pendingEventCount,queue:D.pendingEvents};
    D.update();const second=D.banner,pending2=D.pendingEventCount;
    D.update();const third=D.banner,pending3=D.pendingEventCount;
    return{afterFirst,second,pending2,third,pending3};
  });
  expect(x.afterFirst.banner).toContain('CONTACT');expect(x.afterFirst.pending).toBeGreaterThanOrEqual(2);
  expect(x.second).toContain('OVERTAKE');expect(x.pending2).toBeGreaterThanOrEqual(1);
  expect(x.third).toContain('FASTEST LAP');expect(x.pending3).toBe(0);
});

test('pit state machine resolves circuit-owned layout into a generic runtime spec',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>window.__RACING_RACE__.pitStateDiagnostics.spec);
  expect(x.owner).toBe('runtime-pit-config-v1');expect(x.layoutOwner).toBe('runtime-pit-realism-v1');
  expect(x.exitEndUF).toBeCloseTo(1.044,3);expect(x.mergeTrackOffset).toBeCloseTo(5.55,1);
  expect(x.queueGapMeters).toBeGreaterThan(6);expect(x.releaseBehindMeters).toBeGreaterThan(x.releaseAheadMeters);
  expect(x.serviceTime.gt).toBeGreaterThan(x.serviceTime.formula);
});

test('formula prototype and hyper classes receive lightweight silhouette polish',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__;return['formula','proto','hyper','lmh'].map(type=>{const c=W.makeCar(0x376fa8,type),p=c.userData?.proceduralClassPolish,g=c.getObjectByName?.('RUNTIME_CLASS_POLISH_V1');return{type,owner:p?.owner,parts:p?.parts||0,children:g?.children?.length||0};});
  });
  for(const c of result){expect(c.owner,JSON.stringify(c)).toBe('runtime-procedural-class-polish-v1');expect(c.parts,JSON.stringify(c)).toBeGreaterThanOrEqual(7);expect(c.children,JSON.stringify(c)).toBe(c.parts);}
});
