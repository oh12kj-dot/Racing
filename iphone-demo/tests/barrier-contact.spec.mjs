import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState,stepVehicle} from '../src/simulation/vehicle.js';

for(const side of [-1,1]){
  test(`COL-02: repeated outward steering cannot leave a car embedded in the ${side<0?'left':'right'} barrier`,()=>{
    const track=createTrack();
    const entry=buildEntrants().find(e=>e.type==='gt');
    const car=createVehicleState(entry,300,0);
    car.v=38;
    const initialMax=track.sample(car.s).halfWidth-car.width*.52;
    car.lane=side*(initialMax-.08);
    car.laneV=side*2.2;
    car.yaw=track.sample(car.s).heading;
    let previousS=car.s,maxPenetration=0;

    for(let i=0;i<180;i++){
      stepVehicle(car,track,{throttle:.2,brake:0,steer:side*car.spec.maxSteer},FIXED_DT);
      const maxLane=track.sample(car.s).halfWidth-car.width*.52;
      const penetration=Math.max(0,Math.abs(car.lane)-maxLane);
      maxPenetration=Math.max(maxPenetration,penetration);
      const ds=Math.abs(track.signedDistance(previousS,car.s));
      expect(penetration).toBeLessThan(1e-8);
      expect(ds).toBeLessThan(1.5);
      expect([car.s,car.v,car.lane,car.laneV,car.laneA,car.yaw,car.steer].every(Number.isFinite)).toBeTruthy();
      previousS=car.s;
    }

    expect(car.diagnostics.barrierContacts).toBeGreaterThanOrEqual(1);
    expect(car.incident.damage).toBeGreaterThan(0);
    expect(maxPenetration).toBeLessThan(1e-8);
  });
}
