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

test('engine acceleration envelope stays at idle until the car physically launches',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {resolveEngineEnvelope}=await import('/iphone-demo/runtime/audio.js');
    return{
      grid:resolveEngineEnvelope({v:0,racingThrottle:1,brakeVisual:0,liftCoast:0},'FORMATION'),
      creep:resolveEngineEnvelope({v:.70,racingThrottle:1,brakeVisual:0,liftCoast:0},'RACE'),
      launched:resolveEngineEnvelope({v:1.10,racingThrottle:.75,brakeVisual:0,liftCoast:0},'RACE')
    };
  });
  expect(result.grid.driveActive,JSON.stringify(result)).toBeFalsy();
  expect(result.grid.rpm).toBe(950);
  expect(result.grid.load).toBeLessThan(.03);
  expect(result.creep.driveActive,JSON.stringify(result)).toBeFalsy();
  expect(result.creep.rpm).toBe(950);
  expect(result.launched.driveActive,JSON.stringify(result)).toBeTruthy();
  expect(result.launched.rpm).toBeGreaterThan(1200);
  expect(result.launched.load).toBeGreaterThan(.10);
});

test('Suzuka publishes the main paddock and main-straight facility layer',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const F=window.__RACING_WORLD__?.suzukaFacilities,audit=window.__RACING_WORLD__?.circuitAudit?.suzukaFacilities;
    return{owner:F?.owner,count:F?.count||0,names:(F?.facilities||[]).map(x=>x.name),byType:F?.byType||{},audit};
  });
  expect(result.owner).toBe('runtime-suzuka-facilities-v1');
  expect(result.count,JSON.stringify(result)).toBeGreaterThanOrEqual(25);
  for(const name of['CONTROL_TOWER','MEDIA_CENTER','MEDICAL_HELIPORT','PADDOCK_A','PADDOCK_B','PADDOCK_E','TEAM_OFFICES','CENTER_HOUSE','SMSC_OFFICE','MOTORSPORTS_GATE','PADDOCK_TUNNEL_PADDOCK','PADDOCK_TUNNEL_GRANDSTAND','PODIUM','VIP_SUITE','COMMENTARY_BOOTH','GP_SQUARE','START_SIGNAL','LEADER_TOWER','TEAM_RADIO_MASTS'])expect(result.names,`missing ${name}: ${JSON.stringify(result)}`).toContain(name);
  expect(result.byType['race-equipment']||0).toBeGreaterThanOrEqual(5);
  expect(result.audit?.owner).toBe('runtime-suzuka-facilities-v1');
  expect(result.audit?.count).toBe(result.count);
});
