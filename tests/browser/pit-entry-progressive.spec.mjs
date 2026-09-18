import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_TEST_TICK__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
  for(let i=0;i<400;i++){
    const gate=await page.evaluate(()=>{const R=window.__RACING_RACE__;return{flag:R?.flag||'',phase:R?.sessionPhase||'',preStart:!!R?.startGate?.preStart};});
    if(gate.flag==='GREEN'&&gate.phase==='RACE'&&!gate.preStart)return;
    await page.evaluate(()=>window.__RACING_RACE__?.update?.(.05));
  }
  throw new Error('race did not reach green');
}

test('pit entry prepares lane and brakes progressively before the limiter',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired);if(!c||!Number.isFinite(W.pitEntryFraction))return{supported:false};
    const total=W.total||1,wrap=s=>((s%total)+total)%total,entry=W.pitEntryFraction*total,limit=Number(W.pitSpeedLimit)||22.22;
    for(const o of R.cars){
      o._spectatorPitRequest=null;o._runtimePitPending=false;o._runtimePitQueued=false;o._runtimeReleaseWait=false;o._runtimePitPhase='TRACK';o.pitState='NONE';o.pitTimer=0;
      if(o!==c){o.s=wrap(entry+700+o.id*35);o.v=18;o.lane=0;o.laneTarget=0;}
    }
    c.s=wrap(entry-220);c.lap=2;c.v=72;c.lane=-1.4;c.laneTarget=-1.4;c.spinState='NONE';c.offTrack=false;c.hazardAvoiding=false;c.incident=0;
    const start=W.sample(c.s,c.lane);c.mesh.position.copy(start.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(start.t.x,start.t.z);
    c._spectatorPitRequest={lap:2,reason:'TEST',mode:'BOX'};
    let firstApproach=null,firstEntry=null,firstLimiter=null,maxLatRate=0,maxBrakeRate=0,lastLat=null,lastV=c.v;
    const dt=.016;
    for(let i=0;i<1400;i++){
      R.update(dt);
      const q=W.sample(c.s,0),side=q?.side,lat=q?.p&&side?(c.mesh.position.x-q.p.x)*(side.x||0)+(c.mesh.position.z-q.p.z)*(side.z||0):0;
      if(lastLat!=null)maxLatRate=Math.max(maxLatRate,Math.abs(lat-lastLat)/dt);lastLat=lat;
      maxBrakeRate=Math.max(maxBrakeRate,Math.max(0,lastV-(Number(c.v)||0))/dt);lastV=Number(c.v)||0;
      if(!firstApproach&&c._runtimePitApproachLaneActive)firstApproach={lane:c.lane,laneTarget:c.laneTarget,v:c.v,target:c.pitEntryTargetSpeed,dist:c.pitEntryDistanceToLimiter};
      if(!firstEntry&&c.pitState==='ENTRY'&&W.inPitWindow?.(c.s))firstEntry={v:c.v,lane:c.lane,lat};
      if(!firstLimiter&&W.inPitSpeedZone?.(c.s)){
        firstLimiter={v:c.v,lat,limit};break;
      }
    }
    return{supported:true,firstApproach,firstEntry,firstLimiter,maxLatRate,maxBrakeRate,diag:R.pitExitLimiterDiagnostics||{},laneSign:Math.sign(Number(W.pitLaneOffset)||1)};
  });
  expect(r.supported).toBeTruthy();
  expect(r.firstApproach,JSON.stringify(r)).toBeTruthy();
  expect(Math.sign(r.firstApproach.laneTarget),JSON.stringify(r)).toBe(r.laneSign);
  expect(Math.abs(r.firstApproach.laneTarget),JSON.stringify(r)).toBeGreaterThan(.5);
  expect(r.firstEntry,JSON.stringify(r)).toBeTruthy();
  expect(r.firstLimiter,JSON.stringify(r)).toBeTruthy();
  expect(r.firstLimiter.v,JSON.stringify(r)).toBeLessThanOrEqual(r.firstLimiter.limit*1.06);
  expect(r.maxBrakeRate,JSON.stringify(r)).toBeLessThan(13);
  expect(r.maxLatRate,JSON.stringify(r)).toBeLessThan(14);
  expect(r.diag.approachFrames,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.diag.approachBrakeFrames,JSON.stringify(r)).toBeGreaterThan(0);
});
