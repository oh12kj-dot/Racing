import {test,expect} from '@playwright/test';

test('pit speed limiter is released after the physical speed-limit line',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {shouldReleasePitExitLimiter,releasePitExitLimiter}=await import('/iphone-demo/runtime/race-pit-exit-release.js');
    const outside={pitState:'EXIT',_runtimePitPhase:'FAST_LANE_EXIT',_runtimeReleaseWait:false,s:100,v:19.4,lane:0,laneTarget:0};
    const inside={pitState:'EXIT',_runtimePitPhase:'FAST_LANE_EXIT',_runtimeReleaseWait:false,s:80,v:19.4,lane:0,laneTarget:0};
    const W={
      total:5800,circuitName:'TEST',pitExitFraction:.1,
      inPitSpeedZone:s=>s<90,
      realisticPitLayout:{exitEndUF:1.1},
      pitMergeTrackOffset:3.2
    };
    const outsideEligible=shouldReleasePitExitLimiter(W,outside);
    const insideEligible=shouldReleasePitExitLimiter(W,inside);
    const released=releasePitExitLimiter(W,outside,42);
    return{outsideEligible,insideEligible,released,pitState:outside.pitState,phase:outside._runtimePitPhase,status:outside.pitLaneStatus,v:outside.v,releasedAt:outside._runtimePitExitReleasedAt};
  });
  expect(result.outsideEligible).toBeTruthy();
  expect(result.insideEligible).toBeFalsy();
  expect(result.released).toBeTruthy();
  expect(result.pitState).toBe('NONE');
  expect(result.phase).toBe('MERGE');
  expect(result.status).toBe('MERGE');
  expect(result.v).toBeCloseTo(19.4,5);
  expect(result.releasedAt).toBe(42);
});
