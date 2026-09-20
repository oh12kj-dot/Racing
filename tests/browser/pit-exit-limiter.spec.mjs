import {test,expect} from '@playwright/test';

test('pit limiter releases at the speed line and exit merge remains physically continuous',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {pitExitStage,advancePitExitAfterLimiter}=await import('/iphone-demo/runtime/race-pit-exit-release.js');
    const {resolvePitRuntimeSpec}=await import('/iphone-demo/runtime/pit-config.js');
    const inside={id:1,pitState:'EXIT',_runtimePitPhase:'FAST_LANE_EXIT',_runtimeReleaseWait:false,s:80,v:19.4,lane:0,laneTarget:0,accel:5.4};
    const accelerating={id:2,pitState:'EXIT',_runtimePitPhase:'FAST_LANE_EXIT',_runtimeReleaseWait:false,s:100,v:19.4,lane:0,laneTarget:0,accel:5.4};
    const merged={id:3,pitState:'EXIT',_runtimePitPhase:'FAST_LANE_EXIT',_runtimeReleaseWait:false,s:121,v:24,lane:0,laneTarget:0,accel:5.4};
    const W={
      total:5800,circuitName:'TEST',pitExitFraction:.1,
      inPitSpeedZone:s=>s<90,
      inPitWindow:s=>s<=120,
      realisticPitLayout:{exitBeginUF:1.08,exitEndUF:1.1},
      pitMergeTrackOffset:3.2,
      pitUnwrappedFraction:s=>s/100
    };
    const stages=[pitExitStage(W,inside),pitExitStage(W,accelerating),pitExitStage(W,merged)];
    const accelResult=advancePitExitAfterLimiter(W,accelerating,.05,19.4,42);
    const mergeResult=advancePitExitAfterLimiter(W,merged,.05,24,43);
    const firstMerge={pitState:merged.pitState,phase:merged._runtimePitPhase,status:merged.pitLaneStatus,lane:merged.lane,distance:merged._runtimePitMergeDistance};
    for(let i=0;i<30&&merged.pitState==='EXIT';i++){
      merged.s+=2;
      advancePitExitAfterLimiter(W,merged,.05,24,43.05+i*.05);
    }
    const spec=resolvePitRuntimeSpec(W);
    return{
      stages,accelResult,mergeResult,
      accel:{pitState:accelerating.pitState,phase:accelerating._runtimePitPhase,status:accelerating.pitLaneStatus,v:accelerating.v,releasedAt:accelerating._runtimePitExitReleasedAt},
      firstMerge,
      merge:{pitState:merged.pitState,phase:merged._runtimePitPhase,status:merged.pitLaneStatus,v:merged.v,lane:merged.lane,target:spec.mergeLaneTarget,releasedAt:merged._runtimePitExitReleasedAt}
    };
  });
  expect(result.stages).toEqual(['LIMITED','ACCELERATE','MERGE']);
  expect(result.accelResult).toBe('ACCELERATE');
  expect(result.accel.pitState).toBe('EXIT');
  expect(result.accel.phase).toBe('FAST_LANE_EXIT');
  expect(result.accel.status).toContain('ACCEL');
  expect(result.accel.v).toBeGreaterThan(19.4);
  expect(result.accel.releasedAt).toBe(42);
  expect(result.mergeResult).toBe('MERGE');
  expect(result.firstMerge.pitState).toBe('EXIT');
  expect(result.firstMerge.phase).toBe('MERGE');
  expect(result.firstMerge.status).toContain('MERGE');
  expect(result.firstMerge.distance).toBe(0);
  expect(result.merge.pitState).toBe('NONE');
  expect(result.merge.phase).toBe('MERGE');
  expect(result.merge.lane).toBeCloseTo(result.merge.target,5);
  expect(result.merge.v).toBeCloseTo(24,5);
  expect(result.merge.releasedAt).toBe(43);
});
