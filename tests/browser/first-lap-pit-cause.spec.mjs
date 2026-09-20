import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('first-lap pit causes match real-race events instead of elapsed-time rules',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired);
    if(!c||typeof R.firstLapPitCause!=='function')return{supported:false};
    const saved={fault:c.fault,damage:c.damage,damageZones:c.damageZones,wheelState:c.wheelState,drive:!!c._driveThroughServing,compound:c.compound,tyreCompound:c.tyreCompound,wetness:W.env?.wetness};
    const reset=()=>{c.fault=null;c.damage=0;c.damageZones={front:0,rear:0,left:0,right:0,suspension:0};c.wheelState=[];c._driveThroughServing=false;c.compound='MEDIUM';c.tyreCompound='MEDIUM';if(W.env)W.env.wetness=.12;};
    reset();const normal=R.firstLapPitCause(c);
    c.fault='PUNCTURE';const puncture=R.firstLapPitCause(c);
    reset();c.damage=.35;const damage=R.firstLapPitCause(c);
    reset();c.fault='ENGINE';const mechanical=R.firstLapPitCause(c);
    reset();c._driveThroughServing=true;const driveThrough=R.firstLapPitCause(c);
    reset();if(W.env)W.env.wetness=.80;c.compound='SOFT';c.tyreCompound='SOFT';const weather=R.firstLapPitCause(c);
    c.fault=saved.fault;c.damage=saved.damage;c.damageZones=saved.damageZones;c.wheelState=saved.wheelState;c._driveThroughServing=saved.drive;c.compound=saved.compound;c.tyreCompound=saved.tyreCompound;if(W.env&&saved.wetness!=null)W.env.wetness=saved.wetness;
    return{supported:true,normal,puncture,damage,mechanical,driveThrough,weather};
  });
  expect(r.supported,JSON.stringify(r)).toBeTruthy();
  expect(r.normal).toBe('');
  expect(r.puncture).toBe('PUNCTURE');
  expect(r.damage).toBe('DAMAGE');
  expect(r.mechanical).toBe('MECHANICAL');
  expect(r.driveThrough).toBe('DRIVE THROUGH');
  expect(r.weather).toBe('WEATHER');
});

test('launch safety no longer applies an arbitrary ten-second pit ban',async({page})=>{
  await boot(page);
  const src=await page.evaluate(async()=>({
    launch:await (await fetch('/iphone-demo/runtime/race-launch-safety.js')).text(),
    strategy:await (await fetch('/iphone-demo/runtime/race-pit-strategy.js')).text()
  }));
  expect(src.launch).not.toContain('R.race.t-raceStartAt<10');
  expect(src.strategy).toContain("NO FIRST-LAP PIT CAUSE");
  expect(src.strategy).toContain("return{ok:true,why:`FIRST-LAP ${first}`}");
});
