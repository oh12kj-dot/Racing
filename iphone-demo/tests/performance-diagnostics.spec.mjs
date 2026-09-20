import {test,expect} from '@playwright/test';

test('PERF: presentation records timing, renderer load and memory without changing simulation state',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_PERFORMANCE__&&!!window.__RACING_RACE__);
  await page.waitForTimeout(350);
  await page.evaluate(()=>window.__RACING_TEST_TICK__(1.5));
  const result=await page.evaluate(()=>{
    window.__RACING_LIFECYCLE__.pauseForTest();
    const before=window.__RACING_RACE__.stateHash();
    const d=window.__RACING_PERFORMANCE__.diagnostics();
    const after=window.__RACING_RACE__.stateHash();
    return{d,before,after};
  });
  const d=result.d;
  expect(result.after).toBe(result.before);
  expect(d.owner).toBe('presentation-performance-v1');
  expect(d.sampleCount).toBeGreaterThan(5);
  for(const k of ['frameIntervalMs','frameP95Ms','mainThreadMs','simFrameMs','simTickMs','renderFrameMs','drawCalls','triangles','longFrameRate','devicePixelRatio'])expect(Number.isFinite(d[k]),k).toBeTruthy();
  expect(d.frameIntervalMs).toBeGreaterThanOrEqual(0);
  expect(d.simTickMs).toBeGreaterThanOrEqual(0);
  expect(d.renderFrameMs).toBeGreaterThanOrEqual(0);
  expect(d.drawCalls).toBeGreaterThan(0);
  expect(d.triangles).toBeGreaterThan(0);
  expect(d.longFrameRate).toBeGreaterThanOrEqual(0);expect(d.longFrameRate).toBeLessThanOrEqual(1);
  expect(d.qualityTier).toBe('FULL');
  expect(d.gpuTimerAvailable).toBeFalsy();expect(d.gpuFrameMs).toBeNull();
  if(d.memoryMB!=null)expect(d.memoryMB).toBeGreaterThan(0);
});
