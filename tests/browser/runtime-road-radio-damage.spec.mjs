import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('pit entry stays on main asphalt then follows the rendered pit-road pose',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,p=R.runtimeRoadPolicy,total=W.total,entryS=p.entryUF*total;
    const samples=[150,120,90,60,30,5,0].map(m=>({m,offset:p.offsetFor((entryS-m+total)%total,0)}));
    const atEntry=W.pitPose(entryS,0,'ENTRY'),road=W.sample(entryS,p.mergeOffset);
    return{policy:{owner:p.owner,approachMeters:p.approachMeters,mergeOffset:p.mergeOffset,roadHalf:p.roadHalf},samples,entryGap:atEntry.p.distanceTo(road.p),entryOffset:atEntry.offset};
  });
  expect(x.policy.owner).toBe('runtime-pit-road-v1');expect(x.policy.approachMeters).toBeGreaterThanOrEqual(120);
  for(const s of x.samples){expect(Math.abs(s.offset),JSON.stringify(s)).toBeLessThanOrEqual(x.policy.roadHalf+.001);}
  for(let i=1;i<x.samples.length;i++)expect(x.samples[i].offset,JSON.stringify(x.samples)).toBeGreaterThanOrEqual(x.samples[i-1].offset-.001);
  expect(x.samples[0].offset).toBeCloseTo(0,2);expect(x.samples.at(-1).offset).toBeCloseTo(x.policy.mergeOffset,2);
  expect(x.entryGap).toBeLessThan(.12);expect(x.entryOffset).toBeCloseTo(x.policy.mergeOffset,2);
});

test('pit intent outside the physical pit road does not trap cars at pit-limiter speed',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired),p=R.runtimeRoadPolicy,total=W.total;
    c.s=((p.entryUF*total-700)%total+total)%total;c.lap=2;c.pitState='ENTRY';c.v=48;c.prevV=48;c.damage=.1;if(c.damageZones)c.damageZones.suspension=.05;c.fault='';
    const before=c.v;for(let i=0;i<10;i++)R.update(.03);
    return{before,after:c.v,inPit:W.inPitWindow(c.s),pitState:c.pitState,diag:R.runtimeDamageLimpPolicy};
  });
  expect(x.inPit).toBeFalsy();expect(x.pitState).toBe('ENTRY');expect(x.after).toBeGreaterThan(25);expect(x.after).toBeGreaterThan(x.before*.55);
  expect(x.diag.preEntrySpeedRepairs).toBeGreaterThan(0);
});

test('aggregate body damage is not mislabeled as suspension damage or fixed at 64.8 kmh',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired),p=R.runtimeRoadPolicy,total=W.total;
    c.s=((p.entryUF*total-650)%total+total)%total;c.lap=2;c.pitState='ENTRY';c.v=34;c.prevV=34;c.damage=.72;c.damageState='HEAVY';c.fault='SUSPENSION DAMAGE';
    if(c.damageZones)c.damageZones.suspension=.18;
    R.update(.04);
    return{fault:c.fault,v:c.v,susp:c.damageZones?.suspension||0,inPit:W.inPitWindow(c.s),diag:R.runtimeDamageLimpPolicy};
  });
  expect(x.inPit).toBeFalsy();expect(x.susp).toBeLessThan(.72);expect(x.fault).toBe('HEAVY BODY DAMAGE');expect(x.v).toBeGreaterThan(18.5);expect(x.diag.falseSuspensionRepairs).toBeGreaterThan(0);
});

test('true suspension damage keeps its emergency limp behavior',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,c=R.cars.find(x=>!x.retired);c.damage=.45;c.fault='SUSPENSION DAMAGE';c.v=18;if(c.damageZones)c.damageZones.suspension=.82;R.update(.03);return{fault:c.fault,v:c.v,susp:c.damageZones?.suspension||0};
  });
  expect(x.susp).toBeGreaterThanOrEqual(.72);expect(x.fault).toBe('SUSPENSION DAMAGE');expect(x.v).toBeLessThanOrEqual(19);
});

test('radio acknowledgements are rewritten into complete contextual conversation turns',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,car=R.cars[0],stamp=`dialog-${Date.now()}`;
    R.radio.push({id:`${stamp}-prompt`,t:R.race.t,carId:car.id,name:'ENGINEER',kind:'STRATEGY',text:'Box this lap. Pit entry is clear.'});
    const phrases=['Okay.','Okay, understood.','Understood.','Copy that.','Received.','Roger.','Yep, copy.'];
    phrases.forEach((text,i)=>R.radio.push({id:`${stamp}-${i}`,t:R.race.t+.01+i*.001,carId:car.id,name:car.name,kind:'DRIVER',text}));
    R.update(.016);
    return{messages:R.radio.filter(m=>String(m.id||'').startsWith(stamp)).map(m=>({id:m.id,text:m.text,kind:m.kind})),diag:R.runtimeConversationPolicy};
  });
  const replies=x.messages.filter(m=>m.kind==='DRIVER');expect(replies.length).toBe(7);
  for(const m of replies){expect(m.text,JSON.stringify(m)).not.toMatch(/^(okay|ok|understood|copy|received|roger|yep)\b/i);expect(m.text.length,JSON.stringify(m)).toBeGreaterThan(18);expect(m.text,JSON.stringify(m)).toMatch(/box|pit-entry|pit|target/i);}
  expect(x.diag.diagnostics.radioRewrites).toBeGreaterThanOrEqual(7);
});
