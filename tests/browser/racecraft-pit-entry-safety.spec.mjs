import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_TEST_TICK__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('strategy pit request stays on the racing surface until the physical pit-entry blend',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired);if(!c||!Number.isFinite(W.pitEntryFraction))return{supported:false};
    for(const o of R.cars){o.pitState='NONE';o._runtimePitPending=false;o._runtimePitQueued=false;o._runtimeReleaseWait=false;o._runtimePitPhase='TRACK';o.pitTimer=0;}
    const total=W.total||1,entry=W.pitEntryFraction*total,wrap=s=>((s%total)+total)%total;
    c.s=wrap(entry-250);c.lane=1.25;c.laneTarget=1.25;c.v=42;
    const initialTrack=W.sample(c.s,c.lane);c.mesh.position.x=initialTrack.p.x;c.mesh.position.z=initialTrack.p.z;
    c._spectatorPitRequest={lap:2,reason:'TEST',mode:'BOX'};
    R.update(.016);
    const earlyTrack=W.sample(c.s,c.lane),earlyPit=W.pitPose(c.s,c.teamId,'ENTRY');
    const early={state:c.pitState,pending:!!c._spectatorPitRequest,runtimePending:!!c._runtimePitPending,phase:c._runtimePitPhase,offset:W.pitOffsetAtS?.(c.s)??null,trackDistance:Math.hypot(c.mesh.position.x-earlyTrack.p.x,c.mesh.position.z-earlyTrack.p.z),pitDistance:Math.hypot(c.mesh.position.x-earlyPit.p.x,c.mesh.position.z-earlyPit.p.z)};
    let gateS=null;
    for(let d=.5;d<=300;d+=.5){
      const s=wrap(entry+d),off=Math.abs(Number(W.pitOffsetAtS?.(s))||0);
      if(W.inPitWindow?.(s)&&!W.inPitSpeedZone?.(s)&&off<=3.8){gateS=s;break;}
    }
    if(gateS==null)return{supported:true,early,gateFound:false};
    c.s=gateS;c.lane=.15;c.laneTarget=.15;c.v=30;
    const gateTrack=W.sample(c.s,c.lane);c.mesh.position.x=gateTrack.p.x;c.mesh.position.z=gateTrack.p.z;
    R.update(.016);
    const gate={state:c.pitState,pending:!!c._spectatorPitRequest,runtimePending:!!c._runtimePitPending,phase:c._runtimePitPhase,offset:W.pitOffsetAtS?.(c.s)??null};
    return{supported:true,early,gateFound:true,gate};
  });
  expect(r.supported).toBeTruthy();
  expect(r.early.state,JSON.stringify(r)).toBe('NONE');expect(r.early.pending).toBeTruthy();expect(r.early.runtimePending).toBeFalsy();expect(r.early.trackDistance,JSON.stringify(r)).toBeLessThan(1.5);expect(r.early.pitDistance,JSON.stringify(r)).toBeGreaterThan(5);
  expect(r.gateFound,JSON.stringify(r)).toBeTruthy();expect(r.gate.pending,JSON.stringify(r)).toBeFalsy();expect(r.gate.runtimePending).toBeFalsy();expect(['ENTRY','STOP']).toContain(r.gate.state);expect(Math.abs(r.gate.offset||0)).toBeLessThanOrEqual(3.8);
});

test('stable pit controller defers an early legacy ENTRY instead of pulling the car sideways',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired);if(!c||!Number.isFinite(W.pitEntryFraction))return{supported:false};
    for(const o of R.cars){o.pitState='NONE';o._runtimePitPending=false;o._runtimePitQueued=false;o._runtimeReleaseWait=false;o._runtimePitPhase='TRACK';o.pitTimer=0;}
    const total=W.total||1,entry=W.pitEntryFraction*total;c.s=((entry-180)%total+total)%total;c.lane=1.6;c.laneTarget=1.6;c.v=45;c.pitState='ENTRY';
    const beforeLane=c.lane;R.update(.016);
    return{supported:true,state:c.pitState,pending:!!c._runtimePitPending,phase:c._runtimePitPhase,beforeLane,lane:c.lane,laneTarget:c.laneTarget,diag:R.pitStateDiagnostics?.metrics||{}};
  });
  expect(r.supported).toBeTruthy();expect(r.state,JSON.stringify(r)).toBe('NONE');expect(r.pending).toBeTruthy();expect(r.phase).toBe('PIT_APPROACH');expect(r.diag.earlyEntriesDeferred).toBeGreaterThan(0);expect(Math.abs(r.laneTarget)).toBeLessThan(3.5);
});
