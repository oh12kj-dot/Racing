import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_TEST_TICK__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('racecraft owns lane intent while strategy remains telemetry-only',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    for(let i=0;i<160;i++)window.__RACING_TEST_TICK__(.05,false);
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__;
    return{authority:W.runtimeRacecraftAuthority,racecraft:R.racecraftDynamics,strategy:R.strategyDynamics,trajectory:R.trajectoryDiagnostics};
  });
  expect(r.authority).toBe('runtime-racecraft-v2');
  expect(r.racecraft?.owner).toBe('runtime-racecraft-v2');
  expect(r.strategy?.racecraftAuthority).toBe('runtime-racecraft-v2');
  expect(r.strategy?.laneIntentMode).toBe('telemetry-only');
  expect(r.strategy?.passesPrepared,JSON.stringify(r.strategy)).toBe(0);
  expect(r.strategy?.defencesPrepared,JSON.stringify(r.strategy)).toBe(0);
  expect(r.trajectory?.owner).toBe('runtime-trajectory-controller-v3-pooled');
});

test('driver traits influence racecraft without adding a second attack/defend lane controller',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-driver-dynamics.js',import.meta.url),'utf8');
  const start=source.indexOf('function postTraits('),end=source.indexOf('\n  function beginLockup',start);
  expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
  const body=source.slice(start,end);
  expect(body).not.toContain('laneTarget');
  expect(body).not.toContain("battleState==='ATTACK'");
  expect(body).not.toContain("battleState==='DEFEND'");
  expect(source).toContain("c.driverProfile=p");
});

test('blue flag cooling and hydro states pre-empt tactical racecraft',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-spectator-intelligence.js',import.meta.url),'utf8');
  const start=source.indexOf('function prepareRacecraft('),end=source.indexOf('\n  function estimateProjectedPosition',start);
  expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
  const body=source.slice(start,end);
  expect(body).toContain('c.blueFlag||c.coolingMode||c.hydroplaning');
  expect(body).toContain("transition(c,s,'RESET',specialState?'SPECIAL STATE PRIORITY':'RACECRAFT INACTIVE',.8)");
  expect(body).toContain("c.racecraftIntent=specialState?'SPECIAL':'RESET'");
});
