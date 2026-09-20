import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
  const gate=await page.evaluate(()=>{
    const R=window.__RACING_RACE__;
    for(let i=0;i<400;i++){
      if(R?.flag==='GREEN'&&R?.sessionPhase==='RACE'&&!R?.startGate?.preStart)break;
      R?.update?.(.05);
    }
    return{flag:R?.flag||'',phase:R?.sessionPhase||'',preStart:!!R?.startGate?.preStart};
  });
  expect(gate,JSON.stringify(gate)).toMatchObject({flag:'GREEN',phase:'RACE',preStart:false});
}

test('pit entry blends from the current track lane instead of snapping to pit geometry',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,c=R.cars.find(x=>!x.retired);if(!c)return{supported:false};
    for(const o of R.cars){if(o===c)continue;o.pitState='NONE';o._runtimePitPhase='TRACK';o._runtimePitQueued=false;o._runtimeReleaseWait=false;}
    const total=W.total||1,entryUF=W.pitCoordinateAudit?.entryUF;if(!Number.isFinite(entryUF))return{supported:false};
    const entryS=entryUF*total,lane=3.6;
    c.s=((entryS+1)%total+total)%total;c.v=8;c.lane=lane;c.laneTarget=3.8;c.pitState='ENTRY';c._runtimePitPhase='PIT_ENTRY';c._runtimePitQueued=false;c._runtimeReleaseWait=false;c._runtimePitEntryLane=lane;
    R.update(.016);
    const track=W.sample(c.s,lane),pit=W.pitPose(c.s,c.teamId,'ENTRY'),trackPos=track.p.clone(),pitPos=pit.p.clone();trackPos.y+=.12;pitPos.y+=.12;
    const near={blend:c._runtimePitEntryBlend,actualToTrack:c.mesh.position.distanceTo(trackPos),trackToPit:trackPos.distanceTo(pitPos),actualToPit:c.mesh.position.distanceTo(pitPos)};
    c.s=((entryS+50)%total+total)%total;c.v=8;c.pitState='ENTRY';c._runtimePitPhase='FAST_LANE';c._runtimePitEntryLane=lane;R.update(.001);
    const pitFar=W.pitPose(c.s,c.teamId,'ENTRY'),pitFarPos=pitFar.p.clone();pitFarPos.y+=.12;
    return{supported:true,near,far:{blend:c._runtimePitEntryBlend,actualToPit:c.mesh.position.distanceTo(pitFarPos)},diag:R.pitTrafficIsolation};
  });
  expect(r.supported).toBeTruthy();
  expect(r.near.trackToPit,JSON.stringify(r)).toBeGreaterThan(.5);
  expect(r.near.blend,JSON.stringify(r)).toBeGreaterThanOrEqual(0);
  expect(r.near.blend,JSON.stringify(r)).toBeLessThan(.05);
  expect(r.near.actualToTrack,JSON.stringify(r)).toBeLessThan(r.near.trackToPit*.20);
  expect(r.far.blend,JSON.stringify(r)).toBe(1);
  expect(r.far.actualToPit,JSON.stringify(r)).toBeLessThan(.35);
  expect(r.diag?.entryBlendFrames||0).toBeGreaterThan(0);
});

test('radio acknowledgements never begin with bare Understood and recover prior intent',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,c=R.cars.find(x=>!x.retired);if(!c)return{supported:false};
    const base=`ctx-${Date.now()}`,ids=[];
    R.radio.push({id:`${base}-strategy`,t:R.race.t,carId:c.id,name:c.name,text:'Box this lap.',kind:'STRATEGY'});
    for(let i=0;i<6;i++){const id=`${base}-driver-${i}`;ids.push(id);R.radio.push({id,t:R.race.t,carId:c.id,name:c.name,text:`Acknowledgement probe ${i}`,kind:'DRIVER'});}
    R.update(.001);
    const messages=R.radio.filter(m=>ids.includes(m.id)).map(m=>({id:m.id,text:m.text,original:m.originalContextText||m.originalText||null}));
    return{supported:true,messages,diag:R.radioContextDiagnostics};
  });
  expect(r.supported).toBeTruthy();
  expect(r.messages).toHaveLength(6);
  for(const m of r.messages)expect(/^understood\b/i.test(m.text),JSON.stringify(r)).toBeFalsy();
  expect(r.messages.some(m=>m.text==='Copy. Boxing this lap.'),JSON.stringify(r)).toBeTruthy();
  expect(r.diag?.repaired||0,JSON.stringify(r)).toBeGreaterThan(0);
});