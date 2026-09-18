const DEFAULT_SERVICE_TIME=Object.freeze({formula:2.6,proto:3.1,hyper:3.3,lmh:3.2,gt:4.1,supercar:4.3,touring:4.7});

const finite=(...values)=>{
  for(const value of values){if(value==null||value==='')continue;const n=Number(value);if(Number.isFinite(n))return n;}
  return null;
};
const positive=(fallback,...values)=>{const n=finite(...values);return n!=null&&n>0?n:fallback;};

function unwrapExitFraction(value){
  if(value==null||value==='')return null;
  const n=Number(value);if(!Number.isFinite(n))return null;
  const wrapped=((n%1)+1)%1;return n>=1?n:(wrapped<.5?1+wrapped:wrapped);
}

function inferMergeOffset(W){
  const direct=finite(W?.pitMergeTrackOffset,W?.realisticPitLayout?.mergeTrackOffset);if(direct!=null)return direct;
  const total=positive(1,W?.total),exit=Number(W?.pitExitFraction);
  if(typeof W?.pitOffsetAtS==='function'&&Number.isFinite(exit)){
    const probe=((exit+.011)%1)*total,offset=Number(W.pitOffsetAtS(probe));if(Number.isFinite(offset))return offset;
  }
  return 4.0;
}

export function resolvePitRuntimeSpec(W={}){
  const layout=W.realisticPitLayout||{},mergeTrackOffset=inferMergeOffset(W),exitEndUF=unwrapExitFraction(finite(layout.exitEndUF,W.pitExitEndUF,W.pitExitFraction))??1.05;
  // Finish the dedicated pit-exit path near the outside edge of the racing surface,
  // then let the normal trajectory controller blend toward the racing line. Keeping
  // this target inside its normal ±3.72 m envelope prevents a one-frame lateral snap.
  const mergeLaneTarget=Math.sign(mergeTrackOffset||1)*Math.min(3.55,Math.max(2.5,Math.abs(mergeTrackOffset)*.62));
  return Object.freeze({
    owner:'runtime-pit-config-v2-continuous-merge',
    circuit:String(W.circuitName||'UNKNOWN'),
    layoutOwner:String(layout.owner||'world-pit-kinematics'),
    queueGapMeters:positive(8.5,layout.queueGapMeters,W.pitQueueGapMeters),
    queueTriggerMeters:positive(11,layout.queueTriggerMeters,W.pitQueueTriggerMeters),
    releaseBehindMeters:positive(18,layout.releaseBehindMeters,W.pitReleaseBehindMeters),
    releaseAheadMeters:positive(8,layout.releaseAheadMeters,W.pitReleaseAheadMeters),
    workingExitBlendMeters:positive(18,layout.workingExitBlendMeters,W.pitWorkingExitBlendMeters),
    mergeBlendMeters:positive(42,layout.mergeBlendMeters,W.pitMergeBlendMeters),
    exitEndUF,
    mergeTrackOffset,
    mergeLaneTarget,
    serviceTime:Object.freeze({...DEFAULT_SERVICE_TIME,...(layout.serviceTime||{}),...(W.pitServiceTime||{})})
  });
}
