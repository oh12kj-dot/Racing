import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_DIRECTOR__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('spectator intelligence layers are active while existing runtime owners stay intact',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{for(let i=0;i<8;i++)window.__RACING_TEST_TICK__?.(.016,false);});
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,D=window.__RACING_DIRECTOR__,A=window.__RACING_AUDIO__,VM=window.__RACING_VEHICLE_MOTION__;
    return{
      racecraft:R.racecraftDynamics,
      strategy:R.strategyIntelligence,
      interest:D.viewerInterest,
      atmosphere:W.spectatorAtmosphere,
      vehicleMotion:VM?.diagnostics,
      audio:A?.racePresenceDiagnostics,
      raceTab:!!document.getElementById('spectatorInsightsTab'),
      story:!!document.getElementById('spectatorStory')
    };
  });
  expect(result.racecraft?.owner).toBe('runtime-racecraft-v2');
  expect(result.racecraft?.updates).toBeGreaterThan(1);
  expect(result.strategy?.owner).toBe('runtime-strategy-intelligence-v2');
  expect(Array.isArray(result.interest?.battles)).toBeTruthy();
  expect(Array.isArray(result.interest?.strategy)).toBeTruthy();
  expect(result.atmosphere?.owner).toBe('runtime-spectator-atmosphere-v2');
  expect(result.atmosphere?.crowdCount).toBeGreaterThan(40);
  expect(result.vehicleMotion?.owner).toBe('runtime-vehicle-motion-v2');
  expect(result.audio?.owner).toBe('runtime-audio-race-presence-v2');
  expect(result.raceTab).toBeTruthy();expect(result.story).toBeTruthy();
});

test('race broadcast tab renders racecraft, strategy, tyre and body context',async({page})=>{
  await boot(page);
  const tab=page.locator('#spectatorInsightsTab');await expect(tab).toBeVisible();await tab.click();
  const panel=page.locator('#spectatorInsights');await expect(panel).toHaveClass(/open/);await expect(panel).toContainText('RACE STORY');await expect(panel).toContainText('STRATEGY');await expect(panel).toContainText('TYRE / FUEL');await expect(panel).toContainText('BODY DYNAMICS');
});
