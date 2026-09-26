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
  exitBeginUF:1.062,
  exitEndUF:1.095,
  laneOffset:21.5,
  laneHalfWidth:3.35,
  mergeTrackOffset:5.55,
  mergeHalfWidth:1.50,
  pitWallOffset:9.8,
  trackBarrierOffset:8.8,
  entryGap:[.932,.984],
  exitGap:[.054,.108]
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
