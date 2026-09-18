// Central 2026 vehicle-class calibration.
// Values are representative race-performance envelopes rather than raw homologation
// maxima. Regulatory/official figures anchor mass, speed and power where published;
// dynamic coefficients are calibrated so the simulation preserves the real class hierarchy.

const freeze=Object.freeze;

export const VEHICLE_PERFORMANCE=freeze({
  formula:freeze({
    category:'FIA Formula 1 2026',top:98.3,accel:10.3,brake:31.5,tyre:1.08,wet:.86,mass:768,paceIndex:1.000,
    lateralG:4.35,laneChangeG:3.30,aero:1.00,traction:1.00,tyreWear:1.15,fuelCapacity:70,fuelBurnPerMeter:.000165,refuelKgPerSec:0,
    powerKw:750,electricKw:350,regenKw:350,pushAccelGain:.11,activeAero:true,driveLayout:'RWD',
    wheelbase:3.40,steer:.34,steerRate:2.35,draftGain:.016,dirtyAirLoss:.12,multiclassPassRangeM:118,minPassClosingMps:4.0
  }),
  hyper:freeze({
    category:'FIA WEC Hypercar / LMDh 2026',top:97.7,accel:8.4,brake:24.5,tyre:1.03,wet:.88,mass:1030,paceIndex:.840,
    lateralG:2.78,laneChangeG:2.55,aero:.94,traction:.99,tyreWear:.78,fuelCapacity:90,fuelBurnPerMeter:.000320,refuelKgPerSec:3.0,
    powerKw:520,electricKw:200,regenKw:200,pushAccelGain:.065,activeAero:false,driveLayout:'HYBRID',
    wheelbase:3.10,steer:.38,steerRate:2.00,draftGain:.022,dirtyAirLoss:.070,multiclassPassRangeM:112,minPassClosingMps:3.7
  }),
  lmh:freeze({
    category:'FIA WEC Le Mans Hypercar 2026',top:97.2,accel:8.25,brake:24.2,tyre:1.03,wet:.88,mass:1030,paceIndex:.835,
    lateralG:2.78,laneChangeG:2.55,aero:.94,traction:.98,tyreWear:.78,fuelCapacity:90,fuelBurnPerMeter:.000320,refuelKgPerSec:3.0,
    powerKw:520,electricKw:200,regenKw:200,pushAccelGain:.065,activeAero:false,driveLayout:'HYBRID',
    wheelbase:3.10,steer:.38,steerRate:2.00,draftGain:.022,dirtyAirLoss:.070,multiclassPassRangeM:112,minPassClosingMps:3.7
  }),
  proto:freeze({
    category:'FIA/ACO LMP2 2026',top:91.5,accel:8.0,brake:22.8,tyre:1.04,wet:.89,mass:950,paceIndex:.820,
    lateralG:2.95,laneChangeG:2.62,aero:.96,traction:.96,tyreWear:.82,fuelCapacity:58,fuelBurnPerMeter:.000420,refuelKgPerSec:2.8,
    powerKw:470,electricKw:0,regenKw:0,pushAccelGain:.035,activeAero:false,driveLayout:'RWD',
    wheelbase:3.00,steer:.39,steerRate:2.05,draftGain:.025,dirtyAirLoss:.075,multiclassPassRangeM:110,minPassClosingMps:3.6
  }),
  gt:freeze({
    category:'FIA WEC LMGT3 / FIA GT3 2026',top:84.6,accel:6.7,brake:18.5,tyre:.98,wet:.91,mass:1300,paceIndex:.740,
    lateralG:2.05,laneChangeG:1.95,aero:.84,traction:.97,tyreWear:.72,fuelCapacity:90,fuelBurnPerMeter:.000330,refuelKgPerSec:2.5,
    powerKw:430,electricKw:0,regenKw:0,pushAccelGain:.030,activeAero:false,driveLayout:'RWD/AWD-BoP',
    wheelbase:2.85,steer:.43,steerRate:1.75,draftGain:.030,dirtyAirLoss:.035,multiclassPassRangeM:104,minPassClosingMps:3.4
  }),
  supercar:freeze({
    category:'Repco Supercars Gen3 2026',top:83.33,accel:8.15,brake:17.2,tyre:.94,wet:.88,mass:1350,paceIndex:.720,
    lateralG:1.75,laneChangeG:1.78,aero:.72,traction:.92,tyreWear:1.00,fuelCapacity:100,fuelBurnPerMeter:.000310,refuelKgPerSec:2.2,
    powerKw:447,electricKw:0,regenKw:0,pushAccelGain:.025,activeAero:false,driveLayout:'RWD',
    wheelbase:2.82,steer:.45,steerRate:1.70,draftGain:.027,dirtyAirLoss:.025,multiclassPassRangeM:102,minPassClosingMps:3.2
  }),
  touring:freeze({
    category:'FIA TCR 2026',top:72.5,accel:6.1,brake:16.5,tyre:.92,wet:.91,mass:1265,paceIndex:.670,
    lateralG:1.70,laneChangeG:1.70,aero:.68,traction:.90,tyreWear:.90,fuelCapacity:75,fuelBurnPerMeter:.000240,refuelKgPerSec:2.0,
    powerKw:250,electricKw:0,regenKw:0,pushAccelGain:.020,activeAero:false,driveLayout:'FWD',
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

export function performanceAdvantage(followerType,leaderType){
  const a=performanceFor(followerType),b=performanceFor(leaderType);
  return{paceDelta:a.paceIndex-b.paceIndex,topDelta:a.top-b.top,faster:a.paceIndex-b.paceIndex>=.045||a.top-b.top>=5.0};
}

export function resolveMulticlassPassPlan({followerType='gt',leaderType='gt',gapM=999,closingMps=0,brakingLoad=0,leaderLane=0,halfWidth=3.55}={}){
  const p=performanceFor(followerType),adv=performanceAdvantage(followerType,leaderType),gap=Math.max(0,Number(gapM)||0),closing=Math.max(0,Number(closingMps)||0),load=Math.max(0,Math.min(1,Number(brakingLoad)||0)),limit=Math.max(2.2,Math.min(2.75,Number(halfWidth)||3.55));
  const eligible=adv.faster&&gap>9&&gap<=p.multiclassPassRangeM&&closing>=p.minPassClosingMps&&load<.52;
  const targetLane=(Number(leaderLane)||0)>=0?-limit:limit;
  return{eligible,targetLane,paceDelta:adv.paceDelta,topDelta:adv.topDelta,rangeM:p.multiclassPassRangeM,minClosingMps:p.minPassClosingMps};
}

export function trafficFollowPolicy({followerType='gt',leaderType='gt',gapM=999,speedMps=0,leaderSpeedMps=0,bodyGapM=5,currentLateralM=0,plannedLateralM=0,safeLateralM=2.4,passIntent=false}={}){
  const adv=performanceAdvantage(followerType,leaderType),gap=Math.max(0,Number(gapM)||0),speed=Math.max(0,Number(speedMps)||0),leader=Math.max(0,Number(leaderSpeedMps)||0),body=Math.max(.5,Number(bodyGapM)||5),closing=Math.max(0,speed-leader),safeLat=Math.max(.5,Number(safeLateralM)||2.4),planned=Math.abs(Number(plannedLateralM)||0),current=Math.abs(Number(currentLateralM)||0);
  const passEscape=!!passIntent&&adv.faster&&planned>=safeLat*.88;
  const safeDistance=body+(passEscape?1.8:4.5)+speed*(passEscape?.065:.18);
  const usable=Math.max(.05,gap-safeDistance),ttc=closing>.3?usable/closing:99;
  const ttcLimit=passEscape?1.05:adv.faster?2.15:3.20,nearBuffer=passEscape?8:adv.faster?18:26;
  const shouldCap=current<safeLat&&(gap<safeDistance+nearBuffer||ttc<ttcLimit);
  const margin=Math.max(0,Math.min(1,(gap-safeDistance)/(passEscape?9:adv.faster?17:24))),allowance=passEscape?11:adv.faster?7:5.5;
  return{...adv,passEscape,safeDistance,ttc,ttcLimit,nearBuffer,shouldCap,allowedSpeed:leader+margin*allowance};
}
