import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {pitServiceDuration,planPit} from '../src/simulation/pit.js';

const boxFor=(car,track)=>track.pit.boxStart+car.teamId*track.pit.boxSpacing;

test('PIT-18: service duration follows the requested work and parallel tasks use the longest clock',()=>{
  const car=createVehicleState(buildEntrants()[0],100,2);
  const tyrePlan={tyres:true,tyreCompound:'SLICK',fuel:false,repair:false,cooling:false};
  const tyreTime=pitServiceDuration(car,tyrePlan);
  expect(tyreTime).toBeCloseTo(3.2+(car.id%4)*.35,9);

  car.systems.fuel=0;
  const fuelPlan={tyres:false,tyreCompound:'SLICK',fuel:true,repair:false,cooling:false};
  const fuelTime=pitServiceDuration(car,fuelPlan);
  expect(fuelTime).toBeGreaterThan(tyreTime);

  car.incident.damage=.12;
  const minorRepair=pitServiceDuration(car,{tyres:false,fuel:false,repair:true,cooling:false});
  car.incident.damage=.72;
  const majorRepair=pitServiceDuration(car,{tyres:false,fuel:false,repair:true,cooling:false});
  expect(majorRepair).toBeGreaterThan(minorRepair);
  expect(majorRepair).toBeGreaterThan(tyreTime);

  car.systems.engineTemp=124;
  car.systems.mechanicalStress=.68;
  const coolingTime=pitServiceDuration(car,{tyres:false,fuel:false,repair:false,cooling:true});
  expect(coolingTime).toBeGreaterThan(tyreTime);

  const combined=pitServiceDuration(car,{tyres:true,tyreCompound:'SLICK',fuel:true,repair:true,cooling:true});
  expect(combined).toBeCloseTo(Math.max(tyreTime,fuelTime,majorRepair,coolingTime),9);
  expect(combined).toBeLessThan(tyreTime+fuelTime+majorRepair+coolingTime);
});

test('PIT-19: physical box capture starts the computed service clock',()=>{
  const track=createTrack();
  const car=createVehicleState(buildEntrants()[0],100,2);
  car.pit.phase='WORKING_APPROACH';
  car.pit.requested=true;
  car.pit.boxS=boxFor(car,track);
  car.pit.servicePlan={tyres:false,tyreCompound:'SLICK',fuel:true,repair:false,cooling:false};
  car.systems.fuel=0;
  car.s=car.pit.boxS+.8;
  car.v=1;
  car.lane=track.pit.workingLane;

  const expected=pitServiceDuration(car,car.pit.servicePlan);
  planPit(car,[car],track,FIXED_DT);
  expect(car.pit.phase).toBe('SERVICE');
  expect(car.pit.serviceTimer).toBeCloseTo(expected,9);
});
