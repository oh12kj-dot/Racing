import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('extra pit service preserves the captured stop position instead of snapping to box centre',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired&&['gt','proto','hyper','lmh','touring','supercar'].includes(x.type))||R.cars.find(x=>!x.retired);
    if(!c)return{supported:false};
    for(const o of R.cars){if(o===c)continue;o.pitState='NONE';o._runtimePitPhase='TRACK';o._runtimePitQueued=false;o._runtimeReleaseWait=false;}
    const box=W.pitBoxS(c.teamId),total=W.total||1,serviceS=((box-.10)%total+total)%total;
    c.retired=false;c.damage=.32;c.s=serviceS;c.v=.7;c.pitState='ENTRY';c._runtimePitPhase='WORKING_APPROACH';c._runtimePitQueued=false;c._runtimeReleaseWait=false;c.pitTimer=0;c._runtimePitServiceS=null;c._runtimePitStopCaptureDistance=0;
    R.update(.05);
    const first={state:c.pitState,phase:c._runtimePitPhase,s:c.s,serviceS:c._runtimePitServiceS};
    let ticks=1;while(ticks<30&&c.pitState!=='STOP'){R.update(.05);ticks++;}
    const captured=c._runtimePitServiceS==null?null:Number(c._runtimePitServiceS),afterCapture={state:c.pitState,phase:c._runtimePitPhase,s:c.s,captured,ticks};
    if(c.pitState!=='STOP'||!Number.isFinite(captured))return{supported:true,box,first,afterCapture};
    c.pitTimer=.001;c._pitStopInitial=.001;
    R.update(.05);
    return{supported:true,box,captured,first,afterCapture,afterExtra:{state:c.pitState,phase:c._runtimePitPhase,s:c.s,serviceS:c._runtimePitServiceS,pitTimer:c.pitTimer}};
  });
  expect(r.supported).toBeTruthy();
  expect(r.first?.state,JSON.stringify(r)).toBe('ENTRY');
  expect(r.afterCapture?.state,JSON.stringify(r)).toBe('STOP');
  expect(Number.isFinite(r.captured),JSON.stringify(r)).toBeTruthy();
  expect(Math.abs(r.captured-r.box),JSON.stringify(r)).toBeGreaterThan(.02);
  expect(r.afterExtra?.state,JSON.stringify(r)).toBe('STOP');
  expect(r.afterExtra?.phase,JSON.stringify(r)).toBe('SERVICE_EXTRA');
  expect(r.afterExtra?.s,JSON.stringify(r)).toBeCloseTo(r.captured,6);
  expect(r.afterExtra?.serviceS,JSON.stringify(r)).toBeCloseTo(r.captured,6);
  expect(Math.abs(r.afterExtra.s-r.box),JSON.stringify(r)).toBeGreaterThan(.02);
});
