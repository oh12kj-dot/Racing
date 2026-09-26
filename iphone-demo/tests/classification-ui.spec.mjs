import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fmtDelta=(row,metersKey,secondsKey,leader=false)=>{
  if(leader)return 'LEAD';
  const seconds=row?.[secondsKey];
  if(Number.isFinite(seconds))return `+${seconds.toFixed(1)}s`;
  const meters=row?.[metersKey];
  if(Number.isFinite(meters))return `+${Math.round(meters)}m`;
  return '--';
};

test('UI classification: presentation does not recalculate race gaps from totalProgress',()=>{
  const src=fs.readFileSync(path.join(root,'src/presentation/ui.js'),'utf8');
  expect(src).toContain('snapshot.classification');
  expect(src).not.toContain('leaderProgress');
  expect(src).not.toContain('totalProgress');
});

test('UI classification: leaderboard and tracked telemetry render authoritative classification fields',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__&&!!window.__RACING_LIFECYCLE__&&document.querySelectorAll('.lb-row').length===24);
  await page.evaluate(()=>window.__RACING_LIFECYCLE__.pauseForTest());

  const expected=await page.evaluate(()=>{
    const snap=window.__RACING_RACE__.snapshot();
    const car=snap.order[1];
    const row=snap.classification.find(r=>r.carId===car.id);
    return{
      carId:car.id,
      label:car.spec.label,
      overallPosition:row.overallPosition,
      classPosition:row.classPosition,
      pitStops:row.pitStops,
      gapToLeaderMeters:row.gapToLeaderMeters,
      gapToLeaderSeconds:row.gapToLeaderSeconds,
      intervalMeters:row.intervalMeters,
      intervalSeconds:row.intervalSeconds
    };
  });

  const gap=fmtDelta(expected,'gapToLeaderMeters','gapToLeaderSeconds');
  const interval=fmtDelta(expected,'intervalMeters','intervalSeconds');
  const row=page.locator(`.lb-row[data-id="${expected.carId}"]`);
  await expect(row.locator('.lb-pos')).toHaveText(String(expected.overallPosition));
  await expect(row.locator('.gap')).toHaveText(gap);
  await expect(row.locator('.lb-class')).toContainText(`${expected.label} P${expected.classPosition}`);
  await expect(row.locator('.lb-class')).toContainText(`INT ${interval}`);
  await expect(row.locator('.lb-class')).toContainText(`PITS ${expected.pitStops}`);

  await row.click();
  const telemetry=page.locator('#telemetry');
  await expect(telemetry).toContainText(`P${expected.overallPosition} · CLASS P${expected.classPosition}`);
  await expect(telemetry).toContainText(`GAP ${gap} · INT ${interval}`);
  await expect(telemetry).toContainText(`PITS ${expected.pitStops}`);
  await expect(telemetry).toContainText('ENG ');
  await expect(telemetry).toContainText('STRESS ');
  await expect(telemetry).toContainText('DERATE ');
});

test('UI hybrid energy: tracked hybrid cars separate strategy from deploy activity',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__&&!!window.__RACING_LIFECYCLE__&&document.querySelectorAll('.lb-row').length===24);
  await page.evaluate(()=>window.__RACING_LIFECYCLE__.pauseForTest());

  const hybridId=await page.evaluate(()=>{
    const sim=window.__RACING_RACE__;
    const car=sim.cars.find(candidate=>(candidate.systems?.energyCapacityMJ||0)>0);
    car.systems.energyMJ=car.systems.energyCapacityMJ*.625;
    car.systems.energyStrategy='DEFEND';
    car.systems.energyMode='ATTACK';
    car.systems.energyDeploy=.86;
    car.systems.energyHarvest=0;
    car.systems.energyReserveTarget=.24;
    return car.id;
  });

  await page.locator(`.lb-row[data-id="${hybridId}"]`).click();
  const telemetry=page.locator('#telemetry');
  await expect(telemetry).toContainText('ERS 63% · DEFEND · DEPLOY 86% · RSV 24%');
  await expect(telemetry).not.toContainText('DEFEND · ATTACK');

  const nonHybridId=await page.evaluate(()=>window.__RACING_RACE__.cars.find(candidate=>(candidate.systems?.energyCapacityMJ||0)<=0).id);
  await page.locator(`.lb-row[data-id="${nonHybridId}"]`).click();
  await expect(page.locator('#telemetry')).not.toContainText('ERS ');
});

test('UI reliability: an active mechanical failure is visibly labelled without changing classification authority',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__&&!!window.__RACING_LIFECYCLE__&&document.querySelectorAll('.lb-row').length===24);
  await page.evaluate(()=>window.__RACING_LIFECYCLE__.pauseForTest());
  const carId=await page.evaluate(()=>{
    const car=window.__RACING_RACE__.cars[0];
    car.systems.failed=true;car.systems.failureReason='OVERHEAT';car.systems.powerDerate=1;
    return car.id;
  });
  const row=page.locator(`.lb-row[data-id="${carId}"]`);
  await expect(row.locator('.lb-class')).toContainText('FAIL');
  await row.click();
  await expect(page.locator('#telemetry')).toContainText('FAIL OVERHEAT');
});

test('UI race control: red-stop and safety-car restart phases are visibly distinct',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__&&!!window.__RACING_LIFECYCLE__&&document.querySelectorAll('.lb-row').length===24);
  await page.evaluate(()=>window.__RACING_LIFECYCLE__.pauseForTest());
  await page.evaluate(()=>{
    const sim=window.__RACING_RACE__;
    sim.raceControl.flag='RED';sim.raceControl.restartPhase='RED_STOP';
  });
  await page.evaluate(()=>window.__RACING_TEST_TICK__(1/60));
  await expect(page.locator('#flag')).toHaveText('RED');
  await expect(page.locator('#procedure')).toHaveText('STOP UNDER RED');
  await page.evaluate(()=>{
    const sim=window.__RACING_RACE__;
    sim.raceControl.flag='SAFETY_CAR';sim.raceControl.restartPhase='SC_FORMATION';
  });
  await page.evaluate(()=>window.__RACING_TEST_TICK__(1/60));
  await expect(page.locator('#flag')).toHaveText('SAFETY_CAR');
  await expect(page.locator('#procedure')).toHaveText('SC RESTART FORMATION');
});