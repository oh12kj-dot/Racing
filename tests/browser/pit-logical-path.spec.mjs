import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
  await page.evaluate(()=>{
    const R=window.__RACING_RACE__;
    for(let i=0;i<400;i++){
      if(R?.flag==='GREEN'&&R?.sessionPhase==='RACE'&&!R?.startGate?.preStart)break;
      R?.update?.(.05);
    }
  });
}

const mod1=x=>((x%1)+1)%1;

test('pit entry visual pose and logical lane remain the same physical path',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,c=R.cars.find(x=>!x.retired);
    if(!c||typeof W.pitOffsetAtS!=='function')return{supported:false};
    for(const o of R.cars){
      if(o===c)continue;
      o.retired=true;if(o.mesh)o.mesh.visible=false;
    }
    const total=W.total||1,entryUF=Number(W.pitCoordinateAudit?.entryUF??W.realisticPitLayout?.entryUF??W.pitEntryFraction);
    if(!Number.isFinite(entryUF))return{supported:false};
    c.s=((((entryUF+8/total)%1)+1)%1)*total;c.v=12;c.lane=0;c.laneTarget=0;c.pitState='ENTRY';c.pitTimer=0;
    c._runtimePitPhase='PIT_ENTRY';c._runtimePitPending=false;c._runtimePitQueued=false;c._runtimeReleaseWait=false;c._runtimePitArrival=1;c._runtimePitEntryLane=null;c._runtimePitLogicalOffset=null;
    R.update(.05);
    const expected=W.sample(c.s,c.lane),pathOffset=Number(W.pitOffsetAtS(c.s)),dx=c.mesh.position.x-expected.p.x,dz=c.mesh.position.z-expected.p.z;
    return{supported:true,lane:c.lane,laneTarget:c.laneTarget,logical:c._runtimePitLogicalOffset,pathOffset,visualErrorXZ:Math.hypot(dx,dz),state:c.pitState,phase:c._runtimePitPhase,blend:c._runtimePitEntryBlend};
  });
  expect(result.supported).toBeTruthy();
  expect(result.state,JSON.stringify(result)).toBe('ENTRY');
  expect(result.visualErrorXZ,JSON.stringify(result)).toBeLessThan(.03);
  expect(result.lane,JSON.stringify(result)).toBeCloseTo(result.logical,5);
  expect(result.laneTarget,JSON.stringify(result)).toBeCloseTo(result.lane,5);
  expect(Math.abs(result.lane),JSON.stringify(result)).toBeGreaterThan(0);
  expect(Math.abs(result.lane),JSON.stringify(result)).toBeLessThanOrEqual(Math.abs(result.pathOffset)+.01);
  expect(result.blend,JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.blend,JSON.stringify(result)).toBeLessThan(1);
});

test('pit exit merge starts from the physical pit path instead of a fixed lateral jump',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,c=R.cars.find(x=>!x.retired);
    if(!c||typeof W.pitOffsetAtS!=='function')return{supported:false};
    for(const o of R.cars){if(o===c)continue;o.retired=true;if(o.mesh)o.mesh.visible=false;}
    const total=W.total||1,exitUF=Number(W.realisticPitLayout?.exitEndUF??W.pitCoordinateAudit?.exitEndUF??W.pitExitFraction);
    if(!Number.isFinite(exitUF))return{supported:false};
    const justAfter=((((exitUF+.7/total)%1)+1)%1)*total;
    c.s=justAfter;c.v=22;c.pitState='EXIT';c.pitTimer=0;c.lane=.12;c.laneTarget=.12;
    c._runtimePitPhase='FAST_LANE_EXIT';c._runtimePitArrival=1;c._runtimePitQueued=false;c._runtimeReleaseWait=false;c._runtimePitMergeStartS=null;c._runtimePitMergeLastS=null;c._runtimePitMergeDistance=0;c._runtimePitMergeStartOffset=null;c._runtimePitLogicalOffset=.12;
    const expectedStart=Number(W.pitOffsetAtS(c.s));
    R.update(.05);
    const expected=W.sample(c.s,c.lane),dx=c.mesh.position.x-expected.p.x,dz=c.mesh.position.z-expected.p.z;
    return{supported:true,expectedStart,lane:c.lane,laneTarget:c.laneTarget,mergeStart:c._runtimePitMergeStartOffset,mergeDistance:c._runtimePitMergeDistance||0,visualErrorXZ:Math.hypot(dx,dz),state:c.pitState,phase:c._runtimePitPhase};
  });
  expect(result.supported).toBeTruthy();
  expect(result.phase,JSON.stringify(result)).toBe('MERGE');
  expect(Math.abs(result.mergeStart-result.expectedStart),JSON.stringify(result)).toBeLessThan(.05);
  expect(Math.abs(result.lane-result.expectedStart),JSON.stringify(result)).toBeLessThan(.25);
  expect(result.visualErrorXZ,JSON.stringify(result)).toBeLessThan(.03);
  expect(Math.abs(result.lane),JSON.stringify(result)).toBeLessThan(1);
});
