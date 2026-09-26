import {test,expect} from '@playwright/test';
import {buildEntrants} from '../src/config.js';
import {createVehicleState,performanceFactors} from '../src/simulation/vehicle.js';
import {createRaceSimulation} from '../src/simulation/race.js';
import {
  createComponentDamage,
  applyImpactComponentDamage,
  componentDamageHashValues
} from '../src/simulation/component-damage.js';

function incident(){return{damage:0,componentDamage:createComponentDamage()};}
function collision({longitudinal=0,lateral=0,impactSpeed=8,impactImpulse=5000}={}){
  return{
    contact:{normalLong:longitudinal,normalLat:lateral},
    response:{normalLong:longitudinal,normalLat:lateral,impactSpeed,impactImpulse}
  };
}
function freshCar(){return createVehicleState(buildEntrants()[0],300,0);}

test('DMG-01: fresh vehicle state starts with zero component damage',()=>{
  const car=freshCar();
  expect(car.incident.componentDamage).toEqual({aero:0,powertrain:0,steering:0,brakes:0});
  expect(componentDamageHashValues(car.incident)).toEqual([0,0,0,0]);
});

test('DMG-02: longitudinal collision primarily damages aero and powertrain',()=>{
  const state=incident(),{contact,response}=collision({longitudinal:1});
  const severity=applyImpactComponentDamage(state,7,contact,response);
  expect(severity).toBeGreaterThan(0);
  expect(state.damage).toBeCloseTo(severity,12);
  expect(state.componentDamage.aero).toBeGreaterThan(state.componentDamage.steering);
  expect(state.componentDamage.powertrain).toBeGreaterThan(state.componentDamage.steering);
});

test('DMG-03: lateral collision primarily damages steering',()=>{
  const state=incident(),{contact,response}=collision({lateral:1});
  applyImpactComponentDamage(state,7,contact,response);
  expect(state.componentDamage.steering).toBeGreaterThan(state.componentDamage.aero);
  expect(state.componentDamage.steering).toBeGreaterThan(state.componentDamage.powertrain);
  expect(state.componentDamage.steering).toBeGreaterThan(state.componentDamage.brakes);
});

test('DMG-04: overlap separation without genuine impact cannot create component damage',()=>{
  const state=incident(),{contact,response}=collision({lateral:1,impactSpeed:0,impactImpulse:0});
  applyImpactComponentDamage(state,7,contact,response);
  expect(state.damage).toBe(0);
  expect(state.componentDamage).toEqual(createComponentDamage());
});

test('DMG-05: authoritative race hash includes deterministic component damage state',()=>{
  const a=createRaceSimulation(0xd0a005,{raceLaps:40});
  const b=createRaceSimulation(0xd0a005,{raceLaps:40});
  expect(a.stateHash()).toBe(b.stateHash());

  a.cars[0].incident.componentDamage.brakes=.001;
  expect(a.stateHash()).not.toBe(b.stateHash());

  b.cars[0].incident.componentDamage.brakes=.001;
  expect(a.stateHash()).toBe(b.stateHash());
});

test('DMG-06: component detail remains performance-neutral while legacy aggregate damage stays authoritative',()=>{
  const detailed=freshCar();
  detailed.incident.componentDamage={aero:.5,powertrain:.5,steering:.5,brakes:.5};
  expect(performanceFactors(detailed)).toMatchObject({aero:1,drive:1,steering:1,brake:1,top:1,drag:1,damage:0});

  const legacy=freshCar();
  legacy.incident.damage=.5;
  const factors=performanceFactors(legacy);
  expect(factors.aero).toBeLessThan(1);
  expect(factors.drive).toBeLessThan(1);
  expect(factors.steering).toBeLessThan(1);
  expect(factors.top).toBeLessThan(1);
  expect(factors.drag).toBeGreaterThan(1);
  expect(factors.brake).toBe(1);
});
