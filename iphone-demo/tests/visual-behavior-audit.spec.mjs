import {test,expect} from '@playwright/test';

test.use({video:'on'});

async function attachFrame(page,testInfo,name){
  const body=await page.screenshot({type:'png'});
  await testInfo.attach(name,{body,contentType:'image/png'});
}

async function sample(page,label){
  return page.evaluate((label)=>{
    const snap=window.__RACING_RACE__.snapshot();
    const world=window.__RACING_WORLD__;
    const cars=snap.cars.slice(0,12).map(car=>{
      const group=world.carGroups.get(car.id);
      return{
        id:car.id,
        class:car.classKey,
        s:car.s,
        lane:car.lane,
        v:car.v,
        racecraft:car.racecraft?.state||null,
        pit:car.pit?.state||null,
        retired:!!car.retired,
        x:group?.position?.x??null,
        z:group?.position?.z??null,
        yaw:group?.rotation?.y??null
      };
    });
    return{label,time:snap.time,flag:snap.raceControl?.flag||null,finite:snap.diagnostics?.finite,cars};
  },label);
}

test('VISUAL-AUDIT: record real race motion from multiple broadcast cameras',async({page},testInfo)=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING__?.director),null,{timeout:30000});
  await page.evaluate(()=>window.__RACING_RACE__.setRunning(true));

  const telemetry=[];
  const modes=['TV','FOLLOW','HELI','ONBOARD'];
  for(const mode of modes){
    await page.evaluate(mode=>window.__RACING__.director.setMode(mode),mode);
    for(let i=0;i<3;i++){
      await page.waitForTimeout(1500);
      telemetry.push(await sample(page,`${mode}-${i}`));
      await attachFrame(page,testInfo,`visual-${mode.toLowerCase()}-${i}.png`);
    }
  }

  const finalState=await page.evaluate(()=>({
    diagnostics:window.__RACING_RACE__.snapshot().diagnostics,
    groups:window.__RACING_WORLD__.carGroups.size,
    mode:window.__RACING__.director.mode
  }));
  await testInfo.attach('visual-telemetry.json',{body:Buffer.from(JSON.stringify(telemetry,null,2)),contentType:'application/json'});
  expect(finalState.diagnostics.finite).toBeTruthy();
  expect(finalState.groups).toBe(24);
});
