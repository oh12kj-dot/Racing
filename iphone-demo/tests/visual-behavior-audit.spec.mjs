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
    const track=window.__RACING_RACE__.track;
    const wrap=a=>((a+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
    const cars=snap.cars.slice(0,12).map(car=>{
      const group=world.carGroups.get(car.id);
      const q=track.sample(car.s,car.lane);
      return{
        id:car.id,
        class:car.classKey,
        s:car.s,
        lane:car.lane,
        laneV:car.laneV,
        v:car.v,
        steer:car.steer,
        yawRate:car.yawRate,
        racecraft:car.racecraft?.state||null,
        pit:car.pit?.state||null,
        retired:!!car.retired,
        x:group?.position?.x??null,
        z:group?.position?.z??null,
        yaw:group?.rotation?.y??null,
        trackHeading:q.heading,
        bodyToTrackYaw:wrap((group?.rotation?.y??q.heading)-q.heading)
      };
    });
    return{label,time:snap.time,flag:snap.raceControl?.flag||null,finite:snap.diagnostics?.finite,cars};
  },label);
}

async function bootRace(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING__?.director),null,{timeout:30000});
  await page.evaluate(()=>window.__RACING_RACE__.setRunning(true));
}

test('VISUAL-AUDIT: record real race motion from multiple broadcast cameras',async({page},testInfo)=>{
  await bootRace(page);

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

  const finalState=await page.evaluate(()=>{
    const snap=window.__RACING_RACE__.snapshot();
    const director=window.__RACING__.director;
    const car=snap.cars.find(c=>c.id===director.trackedId)??snap.leader;
    const q=window.__RACING_RACE__.track.sample(car.s,car.lane);
    const heading=Number.isFinite(car.yaw)?car.yaw:q.heading;
    const expected={x:q.x+Math.sin(heading)*.7,y:2.35,z:q.z+Math.cos(heading)*.7};
    const p=director.camera.position;
    return{
      diagnostics:snap.diagnostics,
      groups:window.__RACING_WORLD__.carGroups.size,
      mode:director.mode,
      onboardCameraError:Math.hypot(p.x-expected.x,p.y-expected.y,p.z-expected.z)
    };
  });
  await testInfo.attach('visual-telemetry.json',{body:Buffer.from(JSON.stringify(telemetry,null,2)),contentType:'application/json'});
  expect(finalState.diagnostics.finite).toBeTruthy();
  expect(finalState.groups).toBe(24);
  expect(finalState.mode).toBe('ONBOARD');
  expect(finalState.onboardCameraError).toBeLessThan(.05);
});

test('VISUAL-AUDIT: rear grid launches together instead of entering stopped-hazard mode',async({page},testInfo)=>{
  await bootRace(page);
  await page.evaluate(()=>{
    window.__RACING__.director.trackedId=9;
    window.__RACING__.director.setMode('HELI');
  });

  const launchTelemetry=[];
  for(const [i,time] of [3.2,3.8,4.4,5.0,5.6,6.2].entries()){
    await page.waitForFunction(t=>window.__RACING_RACE__.snapshot().time>=t,time,{timeout:15000});
    launchTelemetry.push(await sample(page,`START-${i}`));
    await attachFrame(page,testInfo,`start-rear-grid-${i}.png`);
  }

  const final=launchTelemetry.at(-1);
  const rear=final.cars.filter(car=>car.id>=6&&car.id<=11&&!car.retired);
  const falseHazards=rear.filter(car=>car.racecraft==='SPECIAL');
  const stopped=rear.filter(car=>car.v<1);
  await testInfo.attach('start-telemetry.json',{body:Buffer.from(JSON.stringify(launchTelemetry,null,2)),contentType:'application/json'});

  expect(falseHazards.map(car=>car.id)).toEqual([]);
  expect(stopped.map(car=>car.id)).toEqual([]);
  expect(final.finite).toBeTruthy();
});
