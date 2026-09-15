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

test('pit crew animation runs once and clears when runtime service completes',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,root=W.scene.getObjectByName?.('PIT_ANIMATION_V12'),cars=R.cars.filter(c=>!c.retired),c=cars.find(x=>(x.teamId??0)>=0);
    if(!c||!root)return{supported:false};
    for(const o of cars){
      o.pitState='NONE';o._runtimePitPhase='TRACK';o._runtimePitQueued=false;o._runtimeReleaseWait=false;o._runtimePitArrival=null;o.pitTimer=0;o._pitStopInitial=0;o.wear=0;o.fuel=1;o.damage=0;
    }
    const team=c.teamId??0,box=W.pitBoxS(team);c.s=box;c.v=0;c.pitState='STOP';c._runtimePitPhase='SERVICE';c._runtimePitQueued=false;c._runtimeReleaseWait=false;c._runtimePitArrival=1;c.pitTimer=.06;c._pitStopInitial=.06;c.pitLaneStatus='JACKS';
    const crew=root.children?.[team];
    R.update(.02);
    const during={state:c.pitState,phase:c._runtimePitPhase,timer:c.pitTimer,visible:crew?.visible===true,diag:R.pitPresentationDiagnostics};
    R.update(.05);
    const after={state:c.pitState,phase:c._runtimePitPhase,timer:c.pitTimer,visible:crew?.visible===true,diag:R.pitPresentationDiagnostics};
    R.update(.05);
    const settled={state:c.pitState,phase:c._runtimePitPhase,timer:c.pitTimer,visible:crew?.visible===true,diag:R.pitPresentationDiagnostics};
    return{supported:true,carId:c.id,team,during,after,settled};
  });
  expect(r.supported,JSON.stringify(r)).toBeTruthy();
  expect(r.during.state,JSON.stringify(r)).toBe('STOP');
  expect(r.during.phase).toBe('SERVICE');
  expect(r.during.timer).toBeGreaterThan(0);
  expect(r.during.visible,JSON.stringify(r)).toBeTruthy();
  expect(r.during.diag?.owner).toBe('runtime-pit-presentation-v1');
  expect(r.during.diag?.lastDetails?.some(x=>x.carId===r.carId)).toBeTruthy();
  expect(r.after.state,JSON.stringify(r)).toBe('EXIT');
  expect(r.after.timer).toBe(0);
  expect(r.after.visible,JSON.stringify(r)).toBeFalsy();
  expect(r.after.diag?.lastDetails?.some(x=>x.carId===r.carId)).toBeFalsy();
  expect(r.after.diag?.resets,JSON.stringify(r)).toBeGreaterThanOrEqual(1);
  expect(r.after.diag?.completedCycles,JSON.stringify(r)).toBeGreaterThanOrEqual(1);
  expect(r.settled.visible,JSON.stringify(r)).toBeFalsy();
  expect(r.settled.diag?.lastDetails?.some(x=>x.carId===r.carId)).toBeFalsy();
});
