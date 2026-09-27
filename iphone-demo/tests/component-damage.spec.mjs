import {test,expect} from '@playwright/test';
import {buildEntrants,FIXED_DT} from '../src/config.js';
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

test('DMG-06: aero detail is the first component-specific performance channel',()=>{
  const detailed=freshCar();
  detailed.incident.componentDamage.aero=.5;
  expect(performanceFactors(detailed)).toMatchObject({aero:.8,drive:1,steering:1,brake:1,top:1,drag:1.1375,damage:0});

  const legacy=freshCar();
  legacy.incident.damage=.5;
  const factors=performanceFactors(legacy);
  expect(factors.aero).toBeCloseTo(.84,12);
  expect(factors.drive).toBeCloseTo(.89,12);
  expect(factors.steering).toBeCloseTo(.86,12);
  expect(factors.top).toBeCloseTo(.95,12);
  expect(factors.drag).toBeCloseTo(1.11,12);
  expect(factors.brake).toBe(1);
});

test('DMG-07: longitudinal aero calibration matches legacy aggregate aero and drag',()=>{
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

test('DMG-08: equal-severity lateral impact produces less aero loss than longitudinal impact',()=>{
  const longitudinal=incident(),longHit=collision({longitudinal:1});
  const lateral=incident(),latHit=collision({lateral:1});
  applyImpactComponentDamage(longitudinal,7,longHit.contact,longHit.response);
  applyImpactComponentDamage(lateral,7,latHit.contact,latHit.response);

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

test('DMG-DIAG: compare 420s race with aero component channel neutralized',()=>{
  test.setTimeout(120000);
  const actual=createRaceSimulation(0x4444),legacy=createRaceSimulation(0x4444);
  const steps=Math.round(420/FIXED_DT);
  for(let i=0;i<steps;i++){
    actual.update(FIXED_DT);legacy.update(FIXED_DT);
    for(const car of legacy.cars)if(car.incident?.componentDamage)car.incident.componentDamage.aero=0;
  }
  const summarize=sim=>{const snap=sim.snapshot();return{
    finished:snap.finished,time:snap.time,flag:snap.flag,recoveries:snap.diagnostics?.recoveries,
    live:snap.cars.filter(c=>!c.finished&&!c.retired).map(c=>({id:c.id,lap:c.lap,v:+c.v.toFixed(2),pit:c.pit.phase,served:c.pit.served,damage:+c.incident.damage.toFixed(3),aero:+(c.incident.componentDamage?.aero||0).toFixed(3)})),
    events:(snap.events||[]).slice(-8).map(e=>({type:e.type,carId:e.carId,time:+e.time.toFixed(1)}))
  };};
  const actualSummary=summarize(actual),legacySummary=summarize(legacy);
  console.log('DMG-AERO-DIAG '+JSON.stringify({actual:actualSummary,legacy:legacySummary}));
  expect(legacySummary.finished).toBeTruthy();
});
