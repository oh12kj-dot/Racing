import {test,expect} from '@playwright/test';
import {
  createComponentDamage,
  applyImpactComponentDamage,
  componentPerformanceFactors,
  componentDamageHashValues
} from '../src/simulation/component-damage.js';

function incident(){return{damage:0,componentDamage:createComponentDamage()};}
function collision({longitudinal=0,lateral=0,impactSpeed=8,impactImpulse=5000}={}){
  return{
    contact:{normalLong:longitudinal,normalLat:lateral},
    response:{normalLong:longitudinal,normalLat:lateral,impactSpeed,impactImpulse}
  };
}

test('DMG-01: fresh component damage state starts at zero',()=>{
  expect(createComponentDamage()).toEqual({aero:0,powertrain:0,steering:0,brakes:0});
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

test('DMG-05: identical impacts produce identical authoritative hash values',()=>{
  const a=incident(),b=incident(),{contact,response}=collision({longitudinal:.6,lateral:.8});
  applyImpactComponentDamage(a,6.25,contact,response);
  applyImpactComponentDamage(b,6.25,contact,response);
  expect(a).toEqual(b);
  expect(componentDamageHashValues(a)).toEqual(componentDamageHashValues(b));
  b.componentDamage.brakes+=.001;
  expect(componentDamageHashValues(a)).not.toEqual(componentDamageHashValues(b));
});

test('DMG-06: each detailed component primarily affects its matching performance channel',()=>{
  const aero=incident();aero.componentDamage.aero=.5;
  const powertrain=incident();powertrain.componentDamage.powertrain=.5;
  const steering=incident();steering.componentDamage.steering=.5;
  const brakes=incident();brakes.componentDamage.brakes=.5;

  const af=componentPerformanceFactors(aero);
  expect(af.aero).toBeLessThan(1);expect(af.drag).toBeGreaterThan(1);
  expect(af.drive).toBe(1);expect(af.steering).toBe(1);expect(af.brake).toBe(1);

  const pf=componentPerformanceFactors(powertrain);
  expect(pf.drive).toBeLessThan(1);expect(pf.top).toBeLessThan(1);
  expect(pf.aero).toBe(1);expect(pf.steering).toBe(1);expect(pf.brake).toBe(1);

  const sf=componentPerformanceFactors(steering);
  expect(sf.steering).toBeLessThan(1);
  expect(sf.aero).toBe(1);expect(sf.drive).toBe(1);expect(sf.brake).toBe(1);

  const bf=componentPerformanceFactors(brakes);
  expect(bf.brake).toBeLessThan(1);
  expect(bf.aero).toBe(1);expect(bf.drive).toBe(1);expect(bf.steering).toBe(1);
});
