export const DRIVER_INCIDENT_POLICY=Object.freeze({
  referenceRaceSeconds:5400,
  // These are field-wide race incident rates, not per-car rates. Runtime hazard
  // allocation distributes the field rate across cars that are actually at risk.
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

export function fieldIncidentRatePerSecond(kind,wetness=0){
  return 1/Math.max(1,incidentMeanSeconds(kind,wetness));
}

// Allocate one field-wide Poisson hazard across cars according to physical risk.
// Increasing the grid size alone therefore does not multiply the total incident
// rate. With no eligible/risky car the probability is zero: randomness chooses
// which physically plausible mistake happens, not whether physics can be ignored.
export function allocatedIncidentProbability(kind,{wetness=0,dt=0,weight=0,totalWeight=0,now=0,lastAt=-Infinity}={}){
  const w=Math.max(0,Number(weight)||0),sum=Math.max(0,Number(totalWeight)||0),step=Math.max(0,Number(dt)||0);
  if(w<=0||sum<=0||step<=0)return 0;
  if(Number(now)-Number(lastAt)<incidentMinSpacingSeconds(kind,wetness))return 0;
  const share=clamp(w/sum,0,1),lambda=fieldIncidentRatePerSecond(kind,wetness)*share;
  return 1-Math.exp(-lambda*step);
}

export function expectedIncidentCount(kind,wetness=0,durationSeconds=DRIVER_INCIDENT_POLICY.referenceRaceSeconds){
  return Math.max(0,Number(durationSeconds)||0)/incidentMeanSeconds(kind,wetness);
}

export function expectedFullSpinCount(wetness=0,durationSeconds=DRIVER_INCIDENT_POLICY.referenceRaceSeconds){
  return expectedIncidentCount('SPIN',wetness,durationSeconds)*fullSpinShare(wetness);
}
