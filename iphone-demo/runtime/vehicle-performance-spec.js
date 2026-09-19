// Central 2026 vehicle-class calibration.
// `top` is a maximum performance envelope used by the simulation, not a promise
// that the car reaches that speed on every circuit. Acceleration, braking,
// lateral grip, aero, tyres and traffic effects create the larger lap-time gaps.
// `fuelCapacity` is always kg because the runtime stores fuel as fuelKg; when a
// public technical rule specifies litres, `fuelTankLitres` records that separately.
// Sources used for calibration: FIA 2026 F1 regulations/results, FIA/ACO 2026 WEC
// LMH/LMDh/LMP2/LMGT3 regulations/results, 2026 Supercars Gen3 specifications,
// and 2026 FIA TCR World Tour regulations.

const freeze=Object.freeze;
const band=(low,mid,high)=>freeze({low,mid,high});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const VEHICLE_PERFORMANCE=freeze({
  formula:freeze({
    category:'FIA Formula 1 2026',top:98.3,accel:10.3,accelBand:band(11.6,9.5,5.4),brake:31.5,brakeBand:band(21.0,30.0,38.0),tyre:1.08,wet:.86,mass:768,paceIndex:1.000,
    lateralG:4.35,laneChangeG:3.30,aero:1.00,traction:1.00,tyreWear:1.15,fuelCapacity:70,fuelBurnPerMeter:.000200,refuelKgPerSec:0,
    wheelbase:3.40,steer:.34,steerRate:2.35,draftGain:.016,dirtyAirLoss:.12,multiclassPassRangeM:118,minPassClosingMps:4.0
  }),
  hyper:freeze({
    category:'FIA WEC Hypercar / LMDh 2026',top:97.7,accel:8.4,accelBand:band(9.6,7.5,4.1),brake:24.5,brakeBand:band(17.0,23.0,28.0),tyre:1.03,wet:.88,mass:1030,paceIndex:.840,
    lateralG:2.78,laneChangeG:2.55,aero:.94,traction:.99,tyreWear:.78,fuelCapacity:90,fuelBurnPerMeter:.000320,refuelKgPerSec:3.0,
    wheelbase:3.10,steer:.38,steerRate:2.00,draftGain:.022,dirtyAirLoss:.070,multiclassPassRangeM:112,minPassClosingMps:3.7
  }),
  lmh:freeze({
    category:'FIA WEC Le Mans Hypercar 2026',top:97.2,accel:8.25,accelBand:band(9.4,7.3,3.9),brake:24.2,brakeBand:band(17.0,22.7,27.5),tyre:1.03,wet:.88,mass:1030,paceIndex:.835,
    lateralG:2.78,laneChangeG:2.55,aero:.94,traction:.98,tyreWear:.78,fuelCapacity:90,fuelBurnPerMeter:.000320,refuelKgPerSec:3.0,
    wheelbase:3.10,steer:.38,steerRate:2.00,draftGain:.022,dirtyAirLoss:.070,multiclassPassRangeM:112,minPassClosingMps:3.7
  }),
  proto:freeze({
    category:'FIA/ACO LMP2 2026',top:90.7,accel:8.0,accelBand:band(9.1,7.0,3.6),brake:22.8,brakeBand:band(16.0,21.5,25.5),tyre:1.04,wet:.89,mass:950,paceIndex:.820,
    lateralG:2.95,laneChangeG:2.62,aero:.96,traction:.96,tyreWear:.82,fuelCapacity:56,fuelTankLitres:75,fuelDensityKgPerL:.75,fuelBurnPerMeter:.000420,refuelKgPerSec:2.8,
    wheelbase:3.00,steer:.39,steerRate:2.05,draftGain:.025,dirtyAirLoss:.075,multiclassPassRangeM:110,minPassClosingMps:3.6
  }),
  gt:freeze({
    category:'FIA WEC LMGT3 / FIA GT3 2026',top:84.6,accel:6.7,accelBand:band(7.4,5.6,2.7),brake:18.5,brakeBand:band(13.5,17.0,20.0),tyre:.98,wet:.91,mass:1300,paceIndex:.740,
    lateralG:2.05,laneChangeG:1.95,aero:.84,traction:.97,tyreWear:.72,fuelCapacity:90,fuelBurnPerMeter:.000330,refuelKgPerSec:2.5,
    wheelbase:2.85,steer:.43,steerRate:1.75,draftGain:.030,dirtyAirLoss:.035,multiclassPassRangeM:104,minPassClosingMps:3.4
  }),
  supercar:freeze({
    category:'Repco Supercars Gen3 2026',top:83.33,accel:8.15,accelBand:band(8.2,5.9,2.8),brake:17.2,brakeBand:band(12.0,15.5,18.2),tyre:.94,wet:.88,mass:1350,paceIndex:.720,
    lateralG:1.75,laneChangeG:1.78,aero:.72,traction:.92,tyreWear:1.00,fuelCapacity:101,fuelTankLitres:135,fuelDensityKgPerL:.75,fuelBurnPerMeter:.000310,refuelKgPerSec:2.2,
    wheelbase:2.82,steer:.45,steerRate:1.70,draftGain:.027,dirtyAirLoss:.025,multiclassPassRangeM:102,minPassClosingMps:3.2
  }),
  touring:freeze({
    category:'FIA TCR 2026',top:70.3,accel:6.1,accelBand:band(6.2,4.5,2.0),brake:16.5,brakeBand:band(11.5,14.5,17.2),tyre:.92,wet:.91,mass:1265,paceIndex:.670,
    lateralG:1.70,laneChangeG:1.70,aero:.68,traction:.90,tyreWear:.90,fuelCapacity:75,fuelBurnPerMeter:.000240,refuelKgPerSec:2.0,
    wheelbase:2.68,steer:.46,steerRate:1.65,draftGain:.026,dirtyAirLoss:.020,multiclassPassRangeM:98,minPassClosingMps:3.0
  })
});

export const VEHICLE_CLASSES=freeze(Object.keys(VEHICLE_PERFORMANCE));

export function performanceFor(type='gt'){
  return VEHICLE_PERFORMANCE[type]||VEHICLE_PERFORMANCE.gt;
}

export function legacyPerformanceTuple(type='gt'){
  const p=performanceFor(type);return[p.top,p.accel,p.brake,p.tyre,p.wet,p.mass,p.paceIndex];
}

function interpBand(bandDef,ratio){
  const r=clamp(Number(ratio)||0,0,1);
  if(r<=.45){const t=r/.45;return bandDef.low+(bandDef.mid-bandDef.low)*t;}
  const t=(r-.45)/.55;return bandDef.mid+(bandDef.high-bandDef.mid)*t;
}

export function longitudinalPerformance(type='gt',speedMps=0){
  const p=performanceFor(type),ratio=clamp((Number(speedMps)||0)/Math.max(1,p.top),0,1);
  return{speedRatio:ratio,accel:interpBand(p.accelBand,ratio)*p.traction,brake:interpBand(p.brakeBand,ratio),top:p.top};
}

// Crash damage changes what the car can physically do; it must not teleport the
// speed to a canned value. These continuous factors are consumed by the normal
// longitudinal/cornering envelope, so the car slows through braking/drag and its
// class performance still matters. Suspension damage has the strongest effect.
export function damagePerformanceFactors(car={}){
  const damage=clamp(Number(car.damage)||0,0,1),suspension=clamp(Number(car.damageZones?.suspension)||0,0,1),body=Math.max(0,damage-.18),susp=Math.max(0,suspension-.10);
  return{
    damage,suspension,
    top:clamp(1-body*.18-susp*.55,.42,1),
    accel:clamp(1-body*.22-susp*.58,.38,1),
    brake:clamp(1-susp*.30,.70,1),
    lateral:clamp(1-susp*.72,.40,1)
  };
}

export function damageFaultState({damage=0,suspension=0,forced=false}={}){
  const d=clamp(Number(damage)||0,0,1),s=clamp(Number(suspension)||0,0,1);
  if(forced||d>=.90)return{retire:true,pit:false,fault:'CRASH',state:'DESTROYED'};
  if(s>=.72)return{retire:false,pit:true,fault:'SUSPENSION DAMAGE',state:'HEAVY'};
  if(d>=.68)return{retire:false,pit:true,fault:'HEAVY BODY DAMAGE',state:'HEAVY'};
  if(d>=.38)return{retire:false,pit:false,fault:'CRASH DAMAGE',state:'MODERATE'};
  return{retire:false,pit:false,fault:null,state:'NONE'};
}

export function performanceAdvantage(followerType,leaderType){
  const a=performanceFor(followerType),b=performanceFor(leaderType);
  return{paceDelta:a.paceIndex-b.paceIndex,topDelta:a.top-b.top,faster:a.paceIndex-b.paceIndex>=.045||a.top-b.top>=5.0};
}

export function resolveMulticlassPassPlan({followerType='gt',leaderType='gt',gapM=999,closingMps=0,brakingLoad=0,leaderLane=0,halfWidth=3.55}={}){
  const p=performanceFor(followerType),adv=performanceAdvantage(followerType,leaderType),gap=Math.max(0,Number(gapM)||0),closing=Math.max(0,Number(closingMps)||0),load=clamp(Number(brakingLoad)||0,0,1),limit=clamp(Number(halfWidth)||3.55,2.2,2.75);
  const eligible=adv.faster&&gap>5.5&&gap<=p.multiclassPassRangeM&&closing>=p.minPassClosingMps&&load<.52;
  const targetLane=(Number(leaderLane)||0)>=0?-limit:limit;
  return{eligible,targetLane,paceDelta:adv.paceDelta,topDelta:adv.topDelta,rangeM:p.multiclassPassRangeM,minClosingMps:p.minPassClosingMps};
}

export function trafficFollowPolicy({followerType='gt',leaderType='gt',gapM=999,speedMps=0,leaderSpeedMps=0,bodyGapM=5,currentLateralM=0,plannedLateralM=0,safeLateralM=2.4,physicalLateralM=0,passIntent=false}={}){
  const adv=performanceAdvantage(followerType,leaderType),gap=Math.max(0,Number(gapM)||0),speed=Math.max(0,Number(speedMps)||0),leader=Math.max(0,Number(leaderSpeedMps)||0),body=Math.max(.5,Number(bodyGapM)||5),closing=Math.max(0,speed-leader),safeLat=Math.max(.5,Number(safeLateralM)||2.4),physicalLat=Math.max(.5,Number(physicalLateralM)||safeLat*.88),planned=Math.abs(Number(plannedLateralM)||0),current=Math.abs(Number(currentLateralM)||0);
  const passEscape=!!passIntent&&adv.faster&&planned>=safeLat*.88;
  // Parallel running may relax longitudinal follow-braking only after the actual
  // vehicle bodies are clear. Requested lane separation alone is not enough: at
  // race starts it previously allowed overlapping body widths to count as safe.
  const parallelEscape=current>=Math.max(physicalLat+.02,safeLat*.88)&&planned>=Math.max(current-.03,physicalLat+.02,safeLat*.92);
  const lateralEscape=passEscape||parallelEscape;
  const safeDistance=body+(lateralEscape?1.8:4.5)+speed*(lateralEscape?.065:.18);
  const usable=Math.max(.05,gap-safeDistance),ttc=closing>.3?usable/closing:99;
  const ttcLimit=lateralEscape?1.05:adv.faster?2.15:3.20,nearBuffer=lateralEscape?8:adv.faster?18:26;
  const shouldCap=!parallelEscape&&current<safeLat&&(gap<safeDistance+nearBuffer||ttc<ttcLimit);
  const margin=clamp((gap-safeDistance)/(lateralEscape?9:adv.faster?17:24),0,1),allowance=lateralEscape?11:adv.faster?7:5.5;
  return{...adv,passEscape,parallelEscape,lateralEscape,physicalLateral:physicalLat,safeDistance,ttc,ttcLimit,nearBuffer,shouldCap,allowedSpeed:leader+margin*allowance};
}