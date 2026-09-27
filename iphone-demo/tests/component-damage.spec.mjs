import {test,expect} from '@playwright/test';
import {buildEntrants,FIXED_DT} from '../src/config.js';
import {createVehicleState,performanceFactors} from '../src/simulation/vehicle.js';
import {createRaceSimulation} from '../src/simulation/race.js';
import {stepSystems} from '../src/simulation/systems.js';
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
function factorsFor(state){const car=freshCar();car.incident=state;return performanceFactors(car);}

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

test('DMG-04: overlap separation preserves legacy aggregate damage without component damage',()=>{
  const state=incident(),{contact,response}=collision({lateral:1,impactSpeed:0,impactImpulse:0});
  const severity=applyImpactComponentDamage(state,7,contact,response);
  expect(severity).toBe(0);
  expect(state.damage).toBeCloseTo((7-1.5)*.010,12);
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

test('DMG-06: material aero damage adds a component-specific aero and drag penalty',()=>{
  const detailed=freshCar();
  detailed.incident.componentDamage.aero=.5;
  const factors=performanceFactors(detailed);
  expect(factors.aero).toBeCloseTo(.895,12);
  expect(factors.drag).toBeCloseTo(1.063,12);
  expect(factors.drive).toBe(1);
  expect(factors.steering).toBe(1);
  expect(factors.brake).toBe(1);
  expect(factors.top).toBe(1);
});

test('DMG-07: routine longitudinal damage preserves the legacy aggregate aero envelope',()=>{
  const directional=incident(),{contact,response}=collision({longitudinal:1});
  applyImpactComponentDamage(directional,7,contact,response);
  const legacy=incident();legacy.damage=directional.damage;

  const detailedFactors=factorsFor(directional);
  const legacyFactors=factorsFor(legacy);
  expect(detailedFactors.aero).toBeCloseTo(legacyFactors.aero,12);
  expect(detailedFactors.drag).toBeCloseTo(legacyFactors.drag,12);
  expect(detailedFactors.drive).toBeCloseTo(legacyFactors.drive,12);
  expect(detailedFactors.steering).toBeCloseTo(legacyFactors.steering,12);
  expect(detailedFactors.top).toBeCloseTo(legacyFactors.top,12);
});

test('DMG-08: severe longitudinal impact adds more aero penalty than equal-severity lateral impact',()=>{
  const longitudinal=incident(),longHit=collision({longitudinal:1,impactSpeed:80});
  const lateral=incident(),latHit=collision({lateral:1,impactSpeed:80});
  applyImpactComponentDamage(longitudinal,80,longHit.contact,longHit.response);
  applyImpactComponentDamage(lateral,80,latHit.contact,latHit.response);

  expect(longitudinal.damage).toBeCloseTo(lateral.damage,12);
  expect(factorsFor(lateral).aero).toBeGreaterThan(factorsFor(longitudinal).aero);
  expect(factorsFor(lateral).drag).toBeLessThan(factorsFor(longitudinal).drag);
});

test('DMG-09: staged aero damage keeps the fixed-seed 100s race stable',()=>{
  const sim=createRaceSimulation(0x1111,{raceLaps:40});
  const steps=Math.round(100/FIXED_DT);
  for(let i=0;i<steps;i++)sim.update(FIXED_DT);

  expect(sim.cars.reduce((sum,car)=>sum+(car.diagnostics?.recoveries||0),0)).toBe(0);
  expect(sim.cars.every(car=>[
    car.s,car.v,car.lane,car.yaw,car.incident.damage,
    ...Object.values(car.incident.componentDamage||{})
  ].every(Number.isFinite))).toBe(true);
});

test('DMG-10: routine powertrain damage preserves the legacy aggregate drive envelope',()=>{
  const detailed=incident();detailed.damage=.25;detailed.componentDamage.powertrain=.14;
  const legacy=incident();legacy.damage=.25;
  expect(factorsFor(detailed).drive).toBeCloseTo(factorsFor(legacy).drive,12);
});

test('DMG-11: material powertrain damage adds drive loss without changing unrelated channels',()=>{
  const detailed=incident();detailed.damage=.30;detailed.componentDamage.powertrain=.50;
  const legacy=incident();legacy.damage=.30;
  const detailedFactors=factorsFor(detailed),legacyFactors=factorsFor(legacy);
  expect(detailedFactors.drive).toBeLessThan(legacyFactors.drive);
  expect(detailedFactors.aero).toBeCloseTo(legacyFactors.aero,12);
  expect(detailedFactors.drag).toBeCloseTo(legacyFactors.drag,12);
  expect(detailedFactors.steering).toBeCloseTo(legacyFactors.steering,12);
  expect(detailedFactors.brake).toBeCloseTo(legacyFactors.brake,12);
  expect(detailedFactors.top).toBeCloseTo(legacyFactors.top,12);
});

test('DMG-12: material powertrain damage feeds the existing mechanical-stress authority',()=>{
  const damaged=freshCar(),control=freshCar();
  damaged.incident.componentDamage.powertrain=.50;
  for(const car of [damaged,control]){car.throttle=.50;car.brake=0;car.v=0;}
  for(let i=0;i<120;i++){stepSystems(damaged,1);stepSystems(control,1);}
  expect(damaged.systems.mechanicalStress).toBeGreaterThan(control.systems.mechanicalStress+.01);
  expect(damaged.systems.failed).toBeFalsy();
  expect(control.systems.failed).toBeFalsy();
});

test('DMG-13: powertrain damage cannot bypass the existing mechanical failure gate',()=>{
  const car=freshCar();
  car.incident.componentDamage.powertrain=1;
  car.throttle=1;car.brake=0;car.v=0;
  expect(performanceFactors(car).drive).toBeLessThan(1);
  expect(car.systems.failed).toBeFalsy();

  car.systems.mechanicalStress=.9795;
  stepSystems(car,1);
  expect(car.systems.failed).toBeTruthy();
  expect(car.systems.failureReason).toBe('MECHANICAL_STRESS');
  expect(car.systems.powerDerate).toBe(1);
});

test('DMG-14: routine steering damage preserves the legacy aggregate steering envelope',()=>{
  const detailed=incident();detailed.damage=.25;detailed.componentDamage.steering=.14;
  const legacy=incident();legacy.damage=.25;
  expect(factorsFor(detailed).steering).toBeCloseTo(factorsFor(legacy).steering,12);
});

test('DMG-15: material steering damage adds steering-response loss without changing unrelated channels',()=>{
  const detailed=incident();detailed.damage=.30;detailed.componentDamage.steering=.50;
  const legacy=incident();legacy.damage=.30;
  const detailedFactors=factorsFor(detailed),legacyFactors=factorsFor(legacy);
  expect(detailedFactors.steering).toBeLessThan(legacyFactors.steering);
  expect(detailedFactors.aero).toBeCloseTo(legacyFactors.aero,12);
  expect(detailedFactors.drag).toBeCloseTo(legacyFactors.drag,12);
  expect(detailedFactors.drive).toBeCloseTo(legacyFactors.drive,12);
  expect(detailedFactors.brake).toBeCloseTo(legacyFactors.brake,12);
  expect(detailedFactors.top).toBeCloseTo(legacyFactors.top,12);
});

test('DMG-16: severe lateral impact adds more steering penalty than equal-severity longitudinal impact',()=>{
  const longitudinal=incident(),longHit=collision({longitudinal:1,impactSpeed:80});
  const lateral=incident(),latHit=collision({lateral:1,impactSpeed:80});
  applyImpactComponentDamage(longitudinal,80,longHit.contact,longHit.response);
  applyImpactComponentDamage(lateral,80,latHit.contact,latHit.response);

  expect(longitudinal.damage).toBeCloseTo(lateral.damage,12);
  expect(factorsFor(lateral).steering).toBeLessThan(factorsFor(longitudinal).steering);
});

test('DMG-17: steering component penalty is monotonic above the material-damage threshold',()=>{
  const moderate=incident();moderate.damage=.30;moderate.componentDamage.steering=.35;
  const severe=incident();severe.damage=.30;severe.componentDamage.steering=.75;
  expect(factorsFor(severe).steering).toBeLessThan(factorsFor(moderate).steering);
});
