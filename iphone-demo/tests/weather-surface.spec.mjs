import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {createEnvironment,stepEnvironment,surfaceConditionAt,SURFACE_SECTORS,TYRE_COMPOUND,tyreIdealTemperature} from '../src/simulation/environment.js';
import {gripFactor} from '../src/simulation/systems.js';
import {evaluatePitStrategy,PIT_REASON} from '../src/simulation/strategy.js';
import {createRaceSimulation} from '../src/simulation/race.js';

function makeCar(type='formula',s=240,v=52){
  const entry=buildEntrants().find(e=>e.type===type);
  const car=createVehicleState(entry,s,0);
  car.v=v;car.pit.phase='TRACK';
  return car;
}

test('WET-10: traffic dries the racing line while off-line asphalt remains wetter',()=>{
  const track=createTrack(),env=createEnvironment({initialWetness:.65,rainRate:0,dryingRate:0});
  // Measure the same surface cell that the stationary traffic fixture sweeps;
  // an arbitrary point between cells would intentionally interpolate with an
  // untouched neighbour and would measure sector interpolation instead.
  const s=track.total*11/SURFACE_SECTORS;
  const car=makeCar('formula',s,55);
  car.lane=track.idealLane(car.s);
  for(let i=0;i<Math.round(60/FIXED_DT);i++)stepEnvironment(env,FIXED_DT,[car],track);
  const local=surfaceConditionAt(env,track,car.s,car.lane);
  expect(env.racingLineWetness).toBeLessThan(env.offLineWetness);
  expect(local.lineWetness).toBeLessThan(local.offLineWetness-.07);
});

test('WET-11: the same longitudinal point has less water on the established line than off line',()=>{
  const track=createTrack(),env=createEnvironment({initialWetness:.72,rainRate:0,dryingRate:0});
  const s=track.total*23/SURFACE_SECTORS;
  const car=makeCar('gt',s,44);car.lane=track.idealLane(car.s);
  for(let i=0;i<Math.round(50/FIXED_DT);i++)stepEnvironment(env,FIXED_DT,[car],track);
  const ideal=track.idealLane(car.s);
  const line=surfaceConditionAt(env,track,car.s,ideal);
  const outside=surfaceConditionAt(env,track,car.s,ideal+4.2);
  expect(outside.wetness).toBeGreaterThan(line.wetness+.06);
  expect(outside.standingWater).toBeGreaterThan(line.standingWater);
});

test('WET-12: standing-water resistance is ordered slick < intermediate < wet without a speed cap',()=>{
  const car=makeCar('formula',120,70),env=createEnvironment({initialWetness:.92,dryingRate:0});
  const clearSurface={wetness:.92,standingWater:0};
  const deepSurface={wetness:.92,standingWater:.75};

  car.systems.tyreCompound=TYRE_COMPOUND.SLICK;
  car.systems.tyreTemp=tyreIdealTemperature(TYRE_COMPOUND.SLICK,.92);
  const slickClear=gripFactor(car,env,clearSurface),slickDeep=gripFactor(car,env,deepSurface);
  car.systems.tyreCompound=TYRE_COMPOUND.INTERMEDIATE;
  car.systems.tyreTemp=tyreIdealTemperature(TYRE_COMPOUND.INTERMEDIATE,.92);
  const interClear=gripFactor(car,env,clearSurface),interDeep=gripFactor(car,env,deepSurface);
  car.systems.tyreCompound=TYRE_COMPOUND.WET;
  car.systems.tyreTemp=tyreIdealTemperature(TYRE_COMPOUND.WET,.92);
  const wetClear=gripFactor(car,env,clearSurface),wetDeep=gripFactor(car,env,deepSurface);

  const slickLoss=(slickClear-slickDeep)/slickClear;
  const interLoss=(interClear-interDeep)/interClear;
  const wetLoss=(wetClear-wetDeep)/wetClear;
  expect(slickDeep).toBeLessThan(slickClear-.08);
  expect(interDeep).toBeLessThan(interClear);
  expect(wetDeep).toBeLessThan(wetClear);
  expect(slickLoss).toBeGreaterThan(interLoss*1.35);
  expect(interLoss).toBeGreaterThan(wetLoss*1.35);
  expect(car.v).toBe(70);
});

test('WET-13: tyre strategy follows average racing-line condition rather than one global/local puddle',()=>{
  const track=createTrack(),car=makeCar('gt',400,38),env=createEnvironment({initialWetness:.72,dryingRate:0});
  car.lap=2;car.pit.served=true;car.systems.tyreCompound=TYRE_COMPOUND.SLICK;
  env.racingLineWetness=.16;
  expect(evaluatePitStrategy(car,track,20,env).reason).not.toBe(PIT_REASON.WEATHER);
  env.racingLineWetness=.46;
  const dampCall=evaluatePitStrategy(car,track,20,env);
  expect(dampCall.reason).toBe(PIT_REASON.WEATHER);
  expect(dampCall.service.tyreCompound).toBe(TYRE_COMPOUND.INTERMEDIATE);
});

test('WET-14: local surface evolution is deterministic for identical traffic',()=>{
  const track=createTrack();
  const a=createEnvironment({initialWetness:.58,rainRate:.12,dryingRate:.6,ambientTemp:19});
  const b=createEnvironment({initialWetness:.58,rainRate:.12,dryingRate:.6,ambientTemp:19});
  const carA=makeCar('proto',680,48),carB=makeCar('proto',680,48);
  carA.lane=carB.lane=track.idealLane(680);
  for(let i=0;i<1800;i++){
    stepEnvironment(a,FIXED_DT,[carA],track);
    stepEnvironment(b,FIXED_DT,[carB],track);
  }
  expect(a.surfaceLine).toEqual(b.surfaceLine);
  expect(a.surfaceOffLine).toEqual(b.surfaceOffLine);
  expect(a.racingLineWetness).toBe(b.racingLineWetness);
  expect(a.offLineWetness).toBe(b.offLineWetness);
});

test('WET-15: full simulation snapshots expose finite local-surface summaries and hash their future state',()=>{
  const opts={raceLaps:20,environment:{initialWetness:.62,rainRate:0,dryingRate:0,ambientTemp:18}};
  const simA=createRaceSimulation(0x51face,opts),simB=createRaceSimulation(0x51face,opts);
  for(let i=0;i<Math.round(30/FIXED_DT);i++){simA.update(FIXED_DT);simB.update(FIXED_DT);}
  const snap=simA.snapshot();
  expect(snap.diagnostics.finite).toBeTruthy();
  expect([snap.environment.racingLineWetness,snap.environment.offLineWetness,snap.environment.standingWater].every(Number.isFinite)).toBeTruthy();
  expect(snap.environment.offLineWetness).toBeGreaterThanOrEqual(snap.environment.racingLineWetness);
  expect(simA.stateHash()).toBe(simB.stateHash());
});

test('WET-16: environment surface evolution never writes vehicle pose, lane or velocity',()=>{
  const track=createTrack(),env=createEnvironment({initialWetness:.70,rainRate:.3,dryingRate:.2});
  const car=makeCar('hyper',310,47);car.lane=track.idealLane(car.s)+.8;car.laneV=.4;
  const before={s:car.s,v:car.v,lane:car.lane,laneV:car.laneV,yaw:car.yaw};
  for(let i=0;i<120;i++)stepEnvironment(env,FIXED_DT,[car],track);
  expect({s:car.s,v:car.v,lane:car.lane,laneV:car.laneV,yaw:car.yaw}).toEqual(before);
});
