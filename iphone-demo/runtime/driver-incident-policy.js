export const DRIVER_INCIDENT_POLICY=Object.freeze({
  referenceRaceSeconds:5400,
  dry:Object.freeze({lockupMeanSeconds:720,spinMeanSeconds:2700,fullSpinShare:.50,lockupMinSpacingSeconds:35,spinMinSpacingSeconds:180}),
  wet:Object.freeze({lockupMeanSeconds:300,spinMeanSeconds:900,fullSpinShare:.65,lockupMinSpacingSeconds:18,spinMinSpacingSeconds:70}),
  fullSpinSeverity:0.74,
  halfSpinSeverityCap:0.69
});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wetMix=wetness=>clamp((Number(wetness)||0)/.70,0,1);
const lerp=(a,b,t)=>a+(b-a)*t;

export function incidentMeanSeconds(kind,wetness=0){
  const t=wetMix(wetness),key=String(kind||'').toUpperCase()==='LOCKUP'?'lockupMeanSeconds':'spinMeanSeconds';
  return lerp(DRIVER_INCIDENT_POLICY.dry[key],DRIVER_INCIDENT_POLICY.wet[key],t);
}

export function incidentMinSpacingSeconds(kind,wetness=0){
  const t=wetMix(wetness),key=String(kind||'').toUpperCase()==='LOCKUP'?'lockupMinSpacingSeconds':'spinMinSpacingSeconds';
  return lerp(DRIVER_INCIDENT_POLICY.dry[key],DRIVER_INCIDENT_POLICY.wet[key],t);
}

export function fullSpinShare(wetness=0){
  return lerp(DRIVER_INCIDENT_POLICY.dry.fullSpinShare,DRIVER_INCIDENT_POLICY.wet.fullSpinShare,wetMix(wetness));
}

export function expectedIncidentCount(kind,wetness=0,durationSeconds=DRIVER_INCIDENT_POLICY.referenceRaceSeconds){
  return Math.max(0,Number(durationSeconds)||0)/incidentMeanSeconds(kind,wetness);
}

export function expectedFullSpinCount(wetness=0,durationSeconds=DRIVER_INCIDENT_POLICY.referenceRaceSeconds){
  return expectedIncidentCount('SPIN',wetness,durationSeconds)*fullSpinShare(wetness);
}
