import {test,expect} from '@playwright/test';
import {SUZUKA_PIT} from '../../iphone-demo/runtime/config.js';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_REGRESSION_MONITOR__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('pit exit uses a compact home-straight blend matching the realistic Suzuka run',()=>{
  expect(SUZUKA_PIT.entryUF).toBeCloseTo(.962,3);
  expect(SUZUKA_PIT.exitBeginUF).toBeCloseTo(1.034,3);
  expect(SUZUKA_PIT.exitEndUF).toBeCloseTo(1.044,3);
  expect(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.entryUF).toBeGreaterThan(.080);
  expect(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.entryUF).toBeLessThan(.085);
  expect(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.exitBeginUF).toBeGreaterThanOrEqual(.009);
  expect(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.exitBeginUF).toBeLessThanOrEqual(.012);
});

test('pit approach stays in fast lane until close to its own box',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,cars=R.cars.filter(c=>!c.retired);const c=cars.find(x=>x.teamId>0)||cars[1];if(!c)return{supported:false};
    const box=W.pitBoxS(c.teamId),q10=W.pitPose(box-10,c.teamId,'ENTRY'),q5=W.pitPose(box-5,c.teamId,'ENTRY');
    return{supported:true,approach:W.runtimePit?.approachMeters,l10:q10?.lateral,l5:q5?.lateral,cleared:W.runtimePit?.clearedLegacyBarrierInstances||0};
  });
  expect(r.supported).toBeTruthy();expect(r.approach).toBeLessThanOrEqual(8);expect(Math.abs(r.l10||0)).toBeLessThan(.15);expect(r.l5).toBeGreaterThan(.2);expect(r.cleared).toBeGreaterThan(0);
});

test('different teams can enter service concurrently without snapping to the pit-box centre',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,cars=R.cars.filter(c=>!c.retired);const a=cars[0],b=cars.find(c=>c!==a&&c.teamId!==a.teamId);if(!a||!b)return{supported:false};
    for(const c of cars){c.pitState='NONE';c._runtimePitPhase='TRACK';c._runtimePitQueued=false;c._runtimeReleaseWait=false;c._runtimePitArrival=null;c._runtimePitServiceS=null;c._runtimePitStopCaptureDistance=0;c.pitTimer=0;}
    const total=W.total||1;
    for(const c of[a,b]){const box=W.pitBoxS(c.teamId);c.s=((box-.30)%total+total)%total;c.v=7;c.pitState='ENTRY';c._runtimePitPhase='WORKING_APPROACH';c._runtimePitQueued=false;c._runtimeReleaseWait=false;}
    R.update(.05);
    const first={a:a.pitState,b:b.pitState};
    let ticks=1;while(ticks<20&&(a.pitState!=='STOP'||b.pitState!=='STOP')){R.update(.05);ticks++;}
    return{supported:true,first,ticks,a:{team:a.teamId,state:a.pitState,phase:a._runtimePitPhase,timer:a.pitTimer,capture:a._runtimePitStopCaptureDistance,serviceS:a._runtimePitServiceS,box:W.pitBoxS(a.teamId)},b:{team:b.teamId,state:b.pitState,phase:b._runtimePitPhase,timer:b.pitTimer,capture:b._runtimePitStopCaptureDistance,serviceS:b._runtimePitServiceS,box:W.pitBoxS(b.teamId)},diag:R.pitStateDiagnostics};
  });
  expect(r.supported).toBeTruthy();expect(r.a.team).not.toBe(r.b.team);
  expect(r.first.a,JSON.stringify(r)).toBe('ENTRY');expect(r.first.b,JSON.stringify(r)).toBe('ENTRY');
  expect(r.a.state,JSON.stringify(r)).toBe('STOP');expect(r.b.state,JSON.stringify(r)).toBe('STOP');expect(r.a.phase).toBe('SERVICE');expect(r.b.phase).toBe('SERVICE');
  expect(r.a.capture,JSON.stringify(r)).toBeLessThanOrEqual(.22);expect(r.b.capture,JSON.stringify(r)).toBeLessThanOrEqual(.22);
  expect(Math.abs(r.a.serviceS-r.a.box),JSON.stringify(r)).toBeGreaterThan(0);expect(Math.abs(r.b.serviceS-r.b.box),JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.diag?.metrics?.maxServiceCaptureMeters??Infinity,JSON.stringify(r)).toBeLessThanOrEqual(.22);
});

test('working-lane exit traffic cannot deadlock another car release',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,cars=R.cars.filter(c=>!c.retired);if(cars.length<2)return{supported:false};
    for(const c of cars){c.pitState='NONE';c._runtimePitPhase='TRACK';c._runtimePitQueued=false;c._runtimeReleaseWait=false;c.pitTimer=0;}
    const service=cars[0],working=cars.find(c=>c!==service&&c.teamId!==service.teamId)||cars[1],box=W.pitBoxS(service.teamId),total=W.total||1;
    service.s=box;service.v=0;service.pitState='STOP';service.pitTimer=.001;service._pitStopInitial=.001;service._runtimePitArrival=1;service._runtimePitPhase='SERVICE';
    working.s=((box-10)%total+total)%total;working.v=8;working.pitState='EXIT';working._runtimePitPhase='WORKING_EXIT';working._runtimeReleaseWait=false;
    R.update(.016);
    return{supported:true,state:service.pitState,wait:service._runtimeReleaseWait,phase:service._runtimePitPhase,v:service.v,diag:R.pitStateDiagnostics};
  });
  expect(r.supported).toBeTruthy();expect(r.state).toBe('EXIT');expect(r.wait).toBeFalsy();expect(r.phase).not.toBe('RELEASE_WAIT');expect(r.v).toBeGreaterThan(0);
});

test('runtime recovers an EXIT car if legacy motion leaves it stationary',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired);if(!c)return{supported:false};
    for(const o of R.cars){if(o===c)continue;o.pitState='NONE';o._runtimePitPhase='TRACK';o._runtimePitQueued=false;o._runtimeReleaseWait=false;}
    const total=W.total||1,box=W.pitBoxS(c.teamId);c.s=((box+30)%total+total)%total;c.pitState='EXIT';c._runtimePitPhase='FAST_LANE_EXIT';c._runtimePitQueued=false;c._runtimeReleaseWait=false;c.v=0;c.accel=0;c.baseMax=0;c.max=0;
    const before=c.s,repairsBefore=R.pitStateDiagnostics?.metrics?.stallRecoveries||0;R.update(.05);const delta=((c.s-before)%total+total)%total;
    return{supported:true,delta,v:c.v,state:c.pitState,phase:c._runtimePitPhase,recovered:(R.pitStateDiagnostics?.metrics?.stallRecoveries||0)-repairsBefore};
  });
  expect(r.supported).toBeTruthy();expect(r.delta).toBeGreaterThan(.1);expect(r.v).toBeGreaterThan(0);expect(r.recovered).toBeGreaterThan(0);
});

test('idle pit crew starts on the garage side of the working lane',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,root=W.scene.getObjectByName?.('PIT_ANIMATION_V12'),team=root?.children?.[0];if(!team)return{supported:false};
    const xs=team.children.map(o=>o.position?.x).filter(Number.isFinite);return{supported:true,min:Math.min(...xs),max:Math.max(...xs),xs};
  });
  expect(r.supported).toBeTruthy();expect(r.max,JSON.stringify(r.xs)).toBeLessThan(-3.5);
});
