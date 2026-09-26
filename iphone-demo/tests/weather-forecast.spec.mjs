import {test,expect} from '@playwright/test';
import {buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {createEnvironment,stepEnvironment,environmentSnapshot,rainRateAt,TYRE_COMPOUND} from '../src/simulation/environment.js';
import {evaluatePitStrategy,PIT_REASON} from '../src/simulation/strategy.js';
import {createRaceSimulation} from '../src/simulation/race.js';

function strategyCar(compound,wetness=0){
  const track=createTrack();
  const car=createVehicleState(buildEntrants().find(e=>e.type==='gt'),track.total*.45,2);
  car.pit.served=true;
  car.systems.tyreCompound=compound;
  car.systems.fuel=car.systems.fuelCapacity;
  car.systems.tyreWear=0;
  car.systems.engineTemp=90;
  car.systems.mechanicalStress=0;
  car.systems.powerDerate=0;
  car.incident.damage=0;
  return{car,track,wetness};
}

test('WET-18: deterministic rain timeline exposes a short-term authoritative forecast',()=>{
  const config={
    initialWetness:.12,
    rainRate:0,
    dryingRate:.2,
    forecastHorizonSeconds:120,
    rainTimeline:[
      {time:60,rainRate:.8},
      {time:180,rainRate:.8},
      {time:300,rainRate:0}
    ]
  };
  const a=createEnvironment(config),b=createEnvironment(config);

  expect(rainRateAt(a,30)).toBeCloseTo(.4,9);
  const initial=environmentSnapshot(a);
  expect(initial.rainRate).toBe(0);
  expect(initial.forecastRainRate).toBeCloseTo(.8,9);
  expect(initial.forecastRacingLineWetness).toBeGreaterThan(initial.racingLineWetness+.20);
  expect(initial.forecastTrend).toBe('WETTER');

  for(let i=0;i<60;i++){stepEnvironment(a,1);stepEnvironment(b,1);}
  expect(a.rainRate).toBeCloseTo(.8,9);
  expect(a).toEqual(b);
  for(let i=0;i<180;i++){stepEnvironment(a,1);stepEnvironment(b,1);}
  expect(a.rainRate).toBeCloseTo(.4,9);
  expect(a).toEqual(b);
  for(let i=0;i<60;i++){stepEnvironment(a,1);stepEnvironment(b,1);}
  expect(a.rainRate).toBeCloseTo(0,9);
  expect(a).toEqual(b);
});

test('WET-19: imminent rain can hold intermediates instead of forcing INT -> SLICK -> INT churn',()=>{
  const {car,track}=strategyCar(TYRE_COMPOUND.INTERMEDIATE);
  const stableDry=createEnvironment({initialWetness:.08,rainRate:0,dryingRate:0});
  let decision=evaluatePitStrategy(car,track,20,stableDry);
  expect(decision.reason).toBe(PIT_REASON.WEATHER);
  expect(decision.service.tyreCompound).toBe(TYRE_COMPOUND.SLICK);
  expect(decision.forecastHold).toBeFalsy();

  const returningRain=createEnvironment({
    initialWetness:.08,
    rainRate:0,
    dryingRate:0,
    forecastHorizonSeconds:120,
    rainTimeline:[{time:20,rainRate:1},{time:180,rainRate:1}]
  });
  const before={s:car.s,v:car.v,lane:car.lane,compound:car.systems.tyreCompound};
  decision=evaluatePitStrategy(car,track,20,returningRain);
  expect(decision.forecastTrend).toBe('WETTER');
  expect(decision.forecastWetness).toBeGreaterThan(.18);
  expect(decision.forecastHold).toBeTruthy();
  expect(decision.reason).toBe(PIT_REASON.NONE);
  expect(decision.service.tyres).toBeFalsy();
  expect(decision.service.tyreCompound).toBe(TYRE_COMPOUND.INTERMEDIATE);
  expect({s:car.s,v:car.v,lane:car.lane,compound:car.systems.tyreCompound}).toEqual(before);
});

test('WET-20: a wet-tyre car can wait through a temporary damp crossover when heavy rain is forecast back',()=>{
  const {car,track}=strategyCar(TYRE_COMPOUND.WET);
  const noReturn=createEnvironment({initialWetness:.36,rainRate:0,dryingRate:0});
  let decision=evaluatePitStrategy(car,track,20,noReturn);
  expect(decision.reason).toBe(PIT_REASON.WEATHER);
  expect(decision.service.tyreCompound).toBe(TYRE_COMPOUND.INTERMEDIATE);

  const rainReturn=createEnvironment({
    initialWetness:.36,
    rainRate:0,
    dryingRate:0,
    forecastHorizonSeconds:120,
    rainTimeline:[{time:15,rainRate:1},{time:180,rainRate:1}]
  });
  decision=evaluatePitStrategy(car,track,20,rainReturn);
  expect(decision.forecastWetness).toBeGreaterThan(.62);
  expect(decision.forecastHold).toBeTruthy();
  expect(decision.reason).toBe(PIT_REASON.NONE);
  expect(decision.service.tyres).toBeFalsy();
});

test('WET-21: forecast never installs wet-weather tyres early on a currently dry racing line',()=>{
  const {car,track}=strategyCar(TYRE_COMPOUND.SLICK);
  const imminentRain=createEnvironment({
    initialWetness:.08,
    rainRate:0,
    dryingRate:0,
    forecastHorizonSeconds:120,
    rainTimeline:[{time:10,rainRate:1},{time:180,rainRate:1}]
  });
  const decision=evaluatePitStrategy(car,track,20,imminentRain);
  expect(decision.forecastWetness).toBeGreaterThan(.58);
  expect(decision.reason).toBe(PIT_REASON.NONE);
  expect(decision.service.tyres).toBeFalsy();
  expect(decision.service.tyreCompound).toBe(TYRE_COMPOUND.SLICK);
});

test('WET-22: identical evolving-rain race inputs remain deterministic including forecast state',()=>{
  const options={
    raceLaps:20,
    environment:{
      initialWetness:.10,
      rainRate:0,
      dryingRate:.3,
      forecastHorizonSeconds:90,
      rainTimeline:[{time:20,rainRate:.7},{time:90,rainRate:.7},{time:150,rainRate:.1}]
    }
  };
  const a=createRaceSimulation(0x51f0ca,options),b=createRaceSimulation(0x51f0ca,options);
  for(let i=0;i<1800;i++){a.update(1/60);b.update(1/60);}
  expect(a.stateHash()).toBe(b.stateHash());
  expect(a.snapshot().environment).toEqual(b.snapshot().environment);
  expect(a.snapshot().environment.forecastRacingLineWetness).toBeGreaterThan(a.snapshot().environment.racingLineWetness);
});
