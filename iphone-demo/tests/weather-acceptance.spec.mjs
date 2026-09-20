import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState,cornerSpeedLimit,tyreLongitudinalAccel} from '../src/simulation/vehicle.js';
import {gripFactor} from '../src/simulation/systems.js';
import {evaluatePitStrategy,PIT_REASON} from '../src/simulation/strategy.js';
import {planPit} from '../src/simulation/pit.js';
import {createEnvironment,stepEnvironment,TYRE_COMPOUND,tyreIdealTemperature,tyreWeatherGrip} from '../src/simulation/environment.js';
import {createRaceSimulation} from '../src/simulation/race.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function carOf(type='formula'){
  const entry=buildEntrants().find(e=>e.type===type);
  return createVehicleState(entry,120,0);
}
function setIdealTemp(car,environment){
  car.systems.tyreTemp=tyreIdealTemperature(car.systems.tyreCompound,environment.wetness);
}

test('WET-01: wetness reduces slick grip, braking capability and corner-speed capability through tyre physics',()=>{
  const car=carOf('formula');
  const dry=createEnvironment({initialWetness:0,dryingRate:0});
  const wet=createEnvironment({initialWetness:.75,dryingRate:0});
  car.systems.tyreCompound=TYRE_COMPOUND.SLICK;
  setIdealTemp(car,dry);const dryGrip=gripFactor(car,dry);
  setIdealTemp(car,wet);const wetGrip=gripFactor(car,wet);
  expect(wetGrip).toBeLessThan(dryGrip*.82);
  const dryBrake=tyreLongitudinalAccel(car.spec,55,dryGrip,1,0);
  const wetBrake=tyreLongitudinalAccel(car.spec,55,wetGrip,1,0);
  expect(wetBrake).toBeLessThan(dryBrake*.84);
  const dryCorner=cornerSpeedLimit(car.spec,.012,dryGrip,1);
  const wetCorner=cornerSpeedLimit(car.spec,.012,wetGrip,1);
  expect(wetCorner).toBeLessThan(dryCorner*.93);
});

test('WET-02: wet tyres beat slicks on a wet track but remain inferior on a dry track',()=>{
  expect(tyreWeatherGrip(TYRE_COMPOUND.WET,.75)).toBeGreaterThan(tyreWeatherGrip(TYRE_COMPOUND.SLICK,.75)+.15);
  expect(tyreWeatherGrip(TYRE_COMPOUND.WET,0)).toBeLessThan(tyreWeatherGrip(TYRE_COMPOUND.SLICK,0));
});

test('WET-03: strategy requests wet tyres without writing lane, speed, pose or compound',()=>{
  const car=carOf('gt'),track=createTrack(),wet=createEnvironment({initialWetness:.70,dryingRate:0});
  car.lap=2;car.v=42;car.lane=-.5;car.systems.tyreCompound=TYRE_COMPOUND.SLICK;
  const before={s:car.s,v:car.v,lane:car.lane,compound:car.systems.tyreCompound};
  const decision=evaluatePitStrategy(car,track,20,wet);
  expect(decision.request).toBeTruthy();
  expect(decision.reason).toBe(PIT_REASON.WEATHER);
  expect(decision.service.tyreCompound).toBe(TYRE_COMPOUND.WET);
  expect({s:car.s,v:car.v,lane:car.lane,compound:car.systems.tyreCompound}).toEqual(before);
});

test('WET-04: tyre compound changes only when physical pit service is applied',()=>{
  const car=carOf('proto'),track=createTrack();
  car.systems.tyreCompound=TYRE_COMPOUND.SLICK;
  car.pit.phase='SERVICE';car.pit.requested=true;car.pit.serviceTimer=0;car.pit.serviceApplied=false;car.pit.servicePlan={tyres:true,tyreCompound:TYRE_COMPOUND.WET};car.v=0;
  expect(car.systems.tyreCompound).toBe(TYRE_COMPOUND.SLICK);
  planPit(car,[car],track,FIXED_DT);
  expect(car.systems.tyreCompound).toBe(TYRE_COMPOUND.WET);
  expect(car.pit.serviceApplied).toBeTruthy();
});

test('WET-05: compound-choice hysteresis prevents repeated slick/wet oscillation around one threshold',()=>{
  const car=carOf('gt'),track=createTrack();car.lap=2;
  car.systems.tyreCompound=TYRE_COMPOUND.SLICK;
  expect(evaluatePitStrategy(car,track,20,createEnvironment({initialWetness:.30,dryingRate:0})).reason).not.toBe(PIT_REASON.WEATHER);
  expect(evaluatePitStrategy(car,track,20,createEnvironment({initialWetness:.48,dryingRate:0})).reason).toBe(PIT_REASON.WEATHER);
  car.systems.tyreCompound=TYRE_COMPOUND.WET;
  expect(evaluatePitStrategy(car,track,20,createEnvironment({initialWetness:.30,dryingRate:0})).reason).not.toBe(PIT_REASON.WEATHER);
  expect(evaluatePitStrategy(car,track,20,createEnvironment({initialWetness:.12,dryingRate:0})).reason).toBe(PIT_REASON.WEATHER);
});

test('WET-06: environment evolution and race outcome state are deterministic for identical inputs',()=>{
  const a=createEnvironment({initialWetness:.20,rainRate:.65,dryingRate:.4,ambientTemp:18});
  const b=createEnvironment({initialWetness:.20,rainRate:.65,dryingRate:.4,ambientTemp:18});
  for(let i=0;i<3600;i++){stepEnvironment(a,FIXED_DT);stepEnvironment(b,FIXED_DT);}
  expect(a).toEqual(b);
  expect(a.wetness).toBeGreaterThan(.20);

  const opts={raceLaps:20,environment:{initialWetness:.55,rainRate:.25,dryingRate:.2,ambientTemp:17}};
  const simA=createRaceSimulation(0x0ea7,opts),simB=createRaceSimulation(0x0ea7,opts);
  for(let i=0;i<1800;i++){simA.update(FIXED_DT);simB.update(FIXED_DT);}
  expect(simA.stateHash()).toBe(simB.stateHash());
  expect(simA.snapshot().environment).toEqual(simB.snapshot().environment);
});

test('WET-07: presentation reads authoritative environment instead of owning a second weather simulation',()=>{
  const world=fs.readFileSync(path.join(root,'src/presentation/world.js'),'utf8');
  expect(world).toContain('snapshot.environment');
  expect(world).not.toContain('createEnvironment');
  expect(world).not.toContain('stepEnvironment');
  expect(world).not.toContain('Math.random');
});

test('WET-08: full wet race reaches physical pit service and installs wet tyres without losing finite state',()=>{
  const sim=createRaceSimulation(0x0ee7,{raceLaps:30,environment:{initialWetness:.72,rainRate:0,dryingRate:0,ambientTemp:18}});
  for(let i=0;i<Math.round(150/FIXED_DT);i++)sim.update(FIXED_DT);
  const snap=sim.snapshot();
  expect(snap.diagnostics.finite).toBeTruthy();
  expect(snap.environment.condition).toBe('WET');
  expect(snap.cars.some(c=>c.systems.tyreCompound===TYRE_COMPOUND.WET)).toBeTruthy();
  expect(snap.cars.filter(c=>c.systems.tyreCompound===TYRE_COMPOUND.WET).every(c=>(c.pit.completedStops||0)>0||c.pit.phase!=='TRACK')).toBeTruthy();
});

test('WET-09: wet launch profile renders the same authoritative weather state in UI and road material',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1&weather=wet',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__&&!!window.__RACING_WORLD__&&document.querySelector('#weather')?.textContent);
  await page.evaluate(()=>window.__RACING_LIFECYCLE__.pauseForTest());
  const state=await page.evaluate(()=>({
    environment:window.__RACING_RACE__.snapshot().environment,
    roughness:window.__RACING_WORLD__.weatherMaterials.road.roughness,
    metalness:window.__RACING_WORLD__.weatherMaterials.road.metalness
  }));
  expect(state.environment.condition).toBe('WET');
  expect(state.environment.wetness).toBeGreaterThan(.70);
  expect(state.roughness).toBeLessThan(.60);
  expect(state.metalness).toBeGreaterThan(.10);
  await expect(page.locator('#weather')).toContainText('WET');
  await expect(page.locator('#telemetry')).toContainText('WET 72%');
});
