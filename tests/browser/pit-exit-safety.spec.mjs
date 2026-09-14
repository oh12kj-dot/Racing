import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__);return ready||document.querySelector('#status')?.textContent==='ERROR';},null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('Suzuka pit exit keeps a long separated right-side lane toward turn one',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,P=W.runtimePit;if(!P)return{supported:false};
    const start=P.offsetUF(1.062),mid=P.offsetUF((1.062+1.095)/2),late=P.offsetUF(1.080),end=P.offsetUF(1.095);
    const positiveExitBarrier=(W.trackBarriers?.colliders||[]).filter(c=>{if(!c||c.sideSign<=0||!Number.isFinite(c.s))return false;const f=((c.s/W.total)%1+1)%1;return f>=.040&&f<=.105;}).length;
    const audit=W.auditCircuit?.()?.runtimePit||{};
    return{supported:true,start,mid,late,end,positiveExitBarrier,audit};
  });
  expect(r.supported).toBeTruthy();
  expect(r.start).toBeGreaterThan(20);
  expect(r.mid).toBeGreaterThan(6);
  expect(r.mid).toBeLessThan(r.start);
  expect(r.late).toBeGreaterThan(6);
  expect(r.end).toBeCloseTo(5.55,1);
  expect(r.positiveExitBarrier).toBe(0);
  expect(r.audit?.exit?.hits??0).toBe(0);
});

test('a pit-bound car is still protected from guardrails before the pit opening',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,S=R.barrierSafetyController;
    const c=R.cars.find(x=>!x.retired),bar=(W.trackBarriers?.colliders||[]).find(x=>x&&x.sideSign<0&&Number.isFinite(x.s)&&!W.inPitWindow?.(x.s));
    if(!c||!bar||!S)return{supported:false};
    c.retired=false;c.pitState='ENTRY';c._runtimePitPhase='PIT_ENTRY';c.spinState='NONE';c.s=bar.s;c.lane=0;c.laneTarget=0;c.v=18;
    const q=W.sample(c.s,bar.sideSign*W.trackBarriers.offset);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
    const before=!!W.barrierContact(c),count=R.barrierSafetyDiagnostics.pitIntentCorrections||0,enforced=S.enforceCar(c),after=!!W.barrierContact(c),diag=R.barrierSafetyDiagnostics;
    return{supported:true,before,enforced,after,pitIntentDelta:(diag.pitIntentCorrections||0)-count,inPit:!!W.inPitWindow?.(c.s),push:c.guardrailCorrectionPush||0};
  });
  expect(r.supported).toBeTruthy();expect(r.inPit).toBeFalsy();expect(r.before).toBeTruthy();expect(r.enforced).toBeTruthy();expect(r.after).toBeFalsy();expect(r.pitIntentDelta).toBeGreaterThan(0);expect(r.push).toBeGreaterThan(0);
});
