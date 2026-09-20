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
  await expect(page.locator('#telemetry')).toContainText(`P${expected.overallPosition} · CLASS P${expected.classPosition}`);
  await expect(page.locator('#telemetry')).toContainText(`GAP ${gap} · INT ${interval}`);
  await expect(page.locator('#telemetry')).toContainText(`PITS ${expected.pitStops}`);
});
