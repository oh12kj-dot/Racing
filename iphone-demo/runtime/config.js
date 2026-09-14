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
  entryUF:.942,
  fullUF:.978,
  box0UF:.994,
  boxGapMeters:18,
  // Suzuka's pit exit stays separated on the right for a long run toward Turn 1.
  // Keep the full pit lane past the final garage, then taper gradually to the
  // right-hand edge of the racing surface instead of cutting diagonally across it.
  exitBeginUF:1.062,
  exitEndUF:1.095,
  laneOffset:21.5,
  laneHalfWidth:3.35,
  mergeTrackOffset:5.55,
  mergeHalfWidth:1.50,
  pitWallOffset:9.8,
  trackBarrierOffset:8.8,
  entryGap:[.932,.984],
  // Keep the physical positive-side guardrail open for the entire exit lane and
  // a small safety margin after the painted blend finishes.
  exitGap:[.037,.108]
});

export const BUILDING_LAYOUT=Object.freeze({
  garageCenterOffset:10.4,
  garageDepth:7.4,
  garageNearClearance:3.35,
  garageHeight:4.15,
  hospitalityHeight:3.05,
  canopyHeight:7.75,
  mainGrandstandOffset:-47,
  timingTowerOffset:35
});

export const RUNTIME_VERSION='2026.09.14';

export const AUDIO_DEFAULTS=Object.freeze({
  master:.78,
  engine:.74,
  effects:.72,
  radioVoice:1.00,
  radioPtt:1.00
});

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
