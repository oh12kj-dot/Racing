import {test,expect} from '@playwright/test';
import {buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {createRaceControl} from '../src/simulation/race-control.js';

function field(count=5){
  const track=createTrack(),entries=buildEntrants();
  const cars=entries.slice(0,count).map((entry,i)=>{
    const s=520-i*20,car=createVehicleState(entry,s,0);
    car.v=22;car.totalProgress=s;car.pit.phase='TRACK';
    return car;
  });
  return{track,cars};
}

test('RACE-13: pit-lane cars are not members of the physical safety-car queue',()=>{
  const {track,cars}=field(),rc=createRaceControl();
  const incident=cars[3],pitCar=cars[4];
  incident.v=0;incident.incident.damage=.7;
  rc.update(20,cars,track);
  expect(rc.flag).toBe('SAFETY_CAR');
  const clearAt=rc.cautionUntil;

  incident.incident.damage=0;
  pitCar.pit.phase='SERVICE';pitCar.s=120;pitCar.totalProgress=120;pitCar.v=0;
  const live=cars.slice(0,3);
  for(const [car,s] of [[live[0],520],[live[1],500],[live[2],480]]){car.s=s;car.totalProgress=s;car.v=22;}

  expect(rc.queueCars(cars)).not.toContain(pitCar);
  rc.update(clearAt+.1,cars,track);
  expect(rc.flag).toBe('GREEN');
});
