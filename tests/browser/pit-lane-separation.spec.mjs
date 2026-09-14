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

test('pit intent stays on the circuit until the physical pit entry',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired);
    if(!c)return{supported:false};
    for(const o of R.cars)if(o!==c)o.retired=true;
    c.retired=false;c.pitState='ENTRY';c._runtimePitPhase='PIT_ENTRY';c._runtimePitQueued=false;c._runtimeReleaseWait=false;
    c.s=W.total*.86;c.lap=1;c.lane=0;c.laneTarget=0;c.v=32;c.accel=6;c.baseMax=70;c.max=70;
    R.update(.016);
    const q=W.sample(c.s,c.lane),pit=W.pitPose(c.s,c.teamId,'ENTRY');
    const dx=c.mesh.position.x-q.p.x,dz=c.mesh.position.z-q.p.z;
    const pdx=c.mesh.position.x-pit.p.x,pdz=c.mesh.position.z-pit.p.z;
    return{supported:true,inPit:W.inPitWindow(c.s),trackDistance:Math.hypot(dx,dz),pitDistance:Math.hypot(pdx,pdz),lane:c.lane,diag:R.pitTrafficIsolation};
  });
  expect(r.supported).toBeTruthy();
  expect(r.inPit).toBeFalsy();
  expect(r.trackDistance,JSON.stringify(r)).toBeLessThan(.35);
  expect(r.pitDistance,JSON.stringify(r)).toBeGreaterThan(2.5);
  expect(r.diag?.preEntryCorrections||0).toBeGreaterThan(0);
});

test('fast-lane traffic passes a stationary working-lane service car',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,live=R.cars.filter(c=>!c.retired);
    const stopped=live.find(c=>(c.teamId??0)===0)||live[0];
    const passer=live.find(c=>c!==stopped&&(c.teamId??0)!==(stopped.teamId??0)&&((c.teamId??0)>=7))||live.find(c=>c!==stopped&&(c.teamId??0)!==(stopped.teamId??0));
    if(!stopped||!passer)return{supported:false};
    for(const c of R.cars)if(c!==stopped&&c!==passer)c.retired=true;
    stopped.retired=false;passer.retired=false;
    const total=W.total,box=W.pitBoxS(stopped.teamId),wrap=s=>((s%total)+total)%total;
    stopped.s=box;stopped.lap=1;stopped.v=0;stopped.pitState='STOP';stopped.pitTimer=99;stopped._pitStopInitial=99;stopped._runtimePitPhase='SERVICE';stopped._runtimePitQueued=false;stopped._runtimeReleaseWait=false;stopped.lane=3.7;stopped.laneTarget=3.7;
    passer.s=wrap(box-7);passer.lap=1;passer.v=18;passer.pitState='ENTRY';passer.pitTimer=0;passer._runtimePitPhase='FAST_LANE';passer._runtimePitQueued=false;passer._runtimeReleaseWait=false;passer.lane=3.7;passer.laneTarget=3.7;passer.baseMax=72;passer.max=72;passer.accel=7;passer.brake=16.5;
    const before=passer.s;
    R.update(.5);
    const delta=((passer.s-before)%total+total)%total;
    const stopDelta=Math.abs(((stopped.s-box+total*.5)%total)-total*.5);
    const fastPose=W.pitFastPose(passer.s),workPose=W.pitPose(stopped.s,stopped.teamId,'STOP');
    return{supported:true,delta,stopDelta,v:passer.v,passState:passer.pitState,stopState:stopped.pitState,visualSeparation:Math.hypot(fastPose.p.x-workPose.p.x,fastPose.p.z-workPose.p.z),diag:R.pitTrafficIsolation};
  });
  expect(r.supported).toBeTruthy();
  expect(r.stopState).toBe('STOP');
  expect(r.stopDelta,JSON.stringify(r)).toBeLessThan(.3);
  expect(r.visualSeparation,JSON.stringify(r)).toBeGreaterThan(2.8);
  expect(r.delta,JSON.stringify(r)).toBeGreaterThan(6);
  expect(r.v,JSON.stringify(r)).toBeGreaterThan(12);
  expect(r.diag?.lastFast||0).toBeGreaterThan(0);
  expect(r.diag?.lastWorking||0).toBeGreaterThan(0);
});
