import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:4173';

async function attachFrame(page,testInfo,name){
  const body=await page.screenshot({fullPage:true});
  await testInfo.attach(name,{body,contentType:'image/png'});
}

async function motionSnapshot(page){
  return page.evaluate(()=>{
    const snap=window.__RACING_RACE__.snapshot();
    return{
      time:snap.time,
      flag:snap.raceControl?.flag,
      cars:snap.cars.map(c=>({
        id:c.id,
        cls:c.type,
        s:c.s,
        lap:c.lap,
        v:c.v,
        lane:c.lane,
        laneV:c.laneV,
        yaw:c.yaw,
        steer:c.steer,
        racecraft:c.racecraft?.state,
        pit:c.pit?.phase,
        incidentSpin:c.incident?.spinTimer||0,
        barrierContacts:c.diagnostics?.barrierContacts||0
      }))
    };
  });
}

test('VISUAL-01: successful race motion is retained for human realism audit',async({browser},testInfo)=>{
  test.setTimeout(60000);
  const videoDir=testInfo.outputPath('visual-video');
  const context=await browser.newContext({
    baseURL:BASE,
    viewport:{width:1280,height:720},
    recordVideo:{dir:videoDir,size:{width:1280,height:720}}
  });
  const page=await context.newPage();
  const consoleErrors=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});

  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING__?.director),null,{timeout:30000});
  await page.evaluate(()=>window.__RACING__.director.setMode('TV'));

  const telemetry=[];
  await page.waitForTimeout(1500);
  telemetry.push(await motionSnapshot(page));
  await attachFrame(page,testInfo,'visual-tv-01');

  for(let i=2;i<=4;i++){
    await page.waitForTimeout(1800);
    telemetry.push(await motionSnapshot(page));
    await attachFrame(page,testInfo,`visual-tv-0${i}`);
  }

  await page.evaluate(()=>window.__RACING__.director.setMode('HELI'));
  for(let i=1;i<=3;i++){
    await page.waitForTimeout(1800);
    telemetry.push(await motionSnapshot(page));
    await attachFrame(page,testInfo,`visual-heli-0${i}`);
  }

  await page.evaluate(()=>{
    const race=window.__RACING_RACE__.snapshot();
    const running=race.cars.filter(c=>!c.retired&&!c.finished&&c.pit?.phase==='TRACK').sort((a,b)=>(b.totalProgress||0)-(a.totalProgress||0));
    if(running[0])window.__RACING__.director.trackedId=running[0].id;
    window.__RACING__.director.setMode('FOLLOW');
  });
  for(let i=1;i<=2;i++){
    await page.waitForTimeout(1800);
    telemetry.push(await motionSnapshot(page));
    await attachFrame(page,testInfo,`visual-follow-0${i}`);
  }

  const edgeCarId=await page.evaluate(()=>{
    const race=window.__RACING_RACE__.snapshot();
    const running=race.cars.filter(c=>!c.retired&&!c.finished&&c.pit?.phase==='TRACK');
    running.sort((a,b)=>Math.abs(b.lane)-Math.abs(a.lane));
    if(running[0])window.__RACING__.director.trackedId=running[0].id;
    window.__RACING__.director.setMode('FOLLOW');
    return running[0]?.id??null;
  });
  for(let i=1;i<=2;i++){
    await page.waitForTimeout(1200);
    telemetry.push(await motionSnapshot(page));
    await attachFrame(page,testInfo,`visual-edge-car-${edgeCarId??'none'}-0${i}`);
  }

  await testInfo.attach('visual-motion-telemetry',{body:Buffer.from(JSON.stringify(telemetry,null,2)),contentType:'application/json'});
  const final=await page.evaluate(()=>window.__RACING_RACE__.snapshot());
  expect(final.diagnostics.finite).toBeTruthy();
  expect(final.cars).toHaveLength(24);
  expect(consoleErrors).toEqual([]);

  const video=page.video();
  await page.close();
  await context.close();
  if(video){
    const path=await video.path();
    await testInfo.attach('visual-motion-video',{path,contentType:'video/webm'});
  }
});
