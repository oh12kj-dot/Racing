export const LOG_POLICY=Object.freeze({
  profilerSamples:90,
  diagnosticSamples:60,
  dynamicsSamples:600,
  dynamicsPersistSamples:120,
  events:180,
  radio:60,
  crashHistory:60,
  audioTrace:120,
  cameraCutSeconds:120,
  cameraCutEntries:80,
  persistedGenerations:3,
  persistedDays:7,
  persistIntervalSec:30,
  maxStoredChars:900000
});

export const SUZUKA_PIT=Object.freeze({
  entryUF:.962,fullUF:.970,box0UF:.994,boxGapMeters:18,exitBeginUF:1.034,exitEndUF:1.044,
  laneOffset:21.5,laneHalfWidth:3.35,mergeTrackOffset:5.55,mergeHalfWidth:1.50,pitWallOffset:9.8,trackBarrierOffset:8.8,
  entryGap:[.955,.976],exitGap:[.024,.050]
});

export const CIRCUIT_PIT_PROFILES=Object.freeze({
  SUZUKA:SUZUKA_PIT,
  FUJI_STYLE:Object.freeze({entryUF:.934,fullUF:.946,box0UF:.976,boxGapMeters:19,exitBeginUF:1.038,exitEndUF:1.060,laneOffset:20.0,laneHalfWidth:3.45,mergeTrackOffset:5.4,mergeHalfWidth:1.55,pitWallOffset:9.4,trackBarrierOffset:8.6,entryGap:[.928,.951],exitGap:[.032,.066]}),
  MONZA_STYLE:Object.freeze({entryUF:.948,fullUF:.958,box0UF:.986,boxGapMeters:19,exitBeginUF:1.041,exitEndUF:1.066,laneOffset:19.2,laneHalfWidth:3.40,mergeTrackOffset:5.5,mergeHalfWidth:1.55,pitWallOffset:9.2,trackBarrierOffset:8.5,entryGap:[.941,.963],exitGap:[.034,.072]}),
  SPA_STYLE:Object.freeze({entryUF:.922,fullUF:.938,box0UF:.970,boxGapMeters:19,exitBeginUF:1.043,exitEndUF:1.071,laneOffset:20.5,laneHalfWidth:3.50,mergeTrackOffset:5.5,mergeHalfWidth:1.55,pitWallOffset:9.5,trackBarrierOffset:8.6,entryGap:[.914,.944],exitGap:[.035,.078]})
});

export const RACING_LANE_PROFILES=Object.freeze({
  SUZUKA:Object.freeze({base:3.25,min:2.65,cornerNarrowing:.34}),
  FUJI_STYLE:Object.freeze({base:3.45,min:2.80,cornerNarrowing:.28}),
  MONZA_STYLE:Object.freeze({base:3.50,min:2.82,cornerNarrowing:.26}),
  SPA_STYLE:Object.freeze({base:3.35,min:2.70,cornerNarrowing:.30})
});

export function resolveCircuitPitProfile(circuitName='SUZUKA'){
  const id=String(circuitName||'SUZUKA').toUpperCase();
  return CIRCUIT_PIT_PROFILES[id]||SUZUKA_PIT;
}
export function resolveRacingLaneProfile(circuitName='SUZUKA'){
  const id=String(circuitName||'SUZUKA').toUpperCase();
  return RACING_LANE_PROFILES[id]||RACING_LANE_PROFILES.SUZUKA;
}

export const BUILDING_LAYOUT=Object.freeze({
  garageCenterOffset:13.9,
  garageDepth:7.4,
  garageNearClearance:3.35,
  garageHeight:4.15,
  hospitalityHeight:3.05,
  canopyHeight:7.75,
  mainGrandstandOffset:-47,
  timingTowerOffset:35
});

export const RUNTIME_VERSION='2026.09.15';

export const AUDIO_DEFAULTS=Object.freeze({master:.78,engine:.74,effects:.72,radioVoice:1.00,radioPtt:1.00});

export function readAudioSettings(settings={}){
  const clamp=v=>Math.max(0,Math.min(1,Number(v)));
  return{
    master:Number.isFinite(Number(settings.audioMaster))?clamp(settings.audioMaster):AUDIO_DEFAULTS.master,
    engine:Number.isFinite(Number(settings.audioEngine))?clamp(settings.audioEngine):AUDIO_DEFAULTS.engine,
    effects:Number.isFinite(Number(settings.audioEffects))?clamp(settings.audioEffects):AUDIO_DEFAULTS.effects,
    radioVoice:Number.isFinite(Number(settings.audioRadioVoice))?clamp(settings.audioRadioVoice):AUDIO_DEFAULTS.radioVoice,
    radioPtt:Number.isFinite(Number(settings.audioRadioPtt))?clamp(settings.audioRadioPtt):AUDIO_DEFAULTS.radioPtt
  };
}