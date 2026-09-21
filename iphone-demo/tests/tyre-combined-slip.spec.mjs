import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState,cornerSpeedLimit,stepVehicle} from '../src/simulation/vehicle.js';

function curvatureExtremes(track){
  let corner={s:0,k:0},straight={s:0,k:Infinity};
  for(let i=0;i<720;i++){
    const s=track.total*i/720,k=Math.abs(track.curvature(s));
    if(k>corner.k)corner={s,k};
    if(k<straight.k)straight={s,k};
  }
  return{corner,straight};
}
function prepared(entry,s,v){
  const c=createVehicleState(entry,s,0);
  c.v=v;c.yaw=0;c.pit.phase='TRACK';
  return c;
}

test('PHY-04A: circuit cornering consumes the friction circle and reduces simultaneous braking capacity',()=>{
  const track=createTrack(),entry=buildEntrants().find(e=>e.type==='gt');
  const {corner,straight}=curvatureExtremes(track);
  expect(corner.k).toBeGreaterThan(straight.k+.003);
  const safeCornerSpeed=Math.min(34,cornerSpeedLimit(entry.spec,corner.k,1)*.72);
  const bend=prepared(entry,corner.s,safeCornerSpeed),line=prepared(entry,straight.s,safeCornerSpeed);
  for(let i=0;i<2;i++){
    stepVehicle(bend,track,{throttle:0,brake:.85,steer:0},FIXED_DT);
    stepVehicle(line,track,{throttle:0,brake:.85,steer:0},FIXED_DT);
  }
  expect(bend.tyre.lateralForceUsage).toBeGreaterThan(.12);
  expect(line.tyre.lateralForceUsage).toBeLessThan(bend.tyre.lateralForceUsage*.35+.02);
  expect(Math.abs(bend.tyre.longitudinalAccel)).toBeLessThan(Math.abs(line.tyre.longitudinalAccel)-.15);
  expect(bend.tyre.slipRatio).toBeGreaterThan(line.tyre.slipRatio+.002);
  expect(bend.tyre.forceUsage).toBeLessThanOrEqual(1.000001);
});

test('PHY-04B: longitudinal load transfer follows acceleration sign and relaxes after the manoeuvre',()=>{
  const track=createTrack(),entry=buildEntrants().find(e=>e.type==='gt');
  const {straight}=curvatureExtremes(track);
  const braking=prepared(entry,straight.s,38),driving=prepared(entry,straight.s,38);
  for(let i=0;i<18;i++){
    stepVehicle(braking,track,{throttle:0,brake:.9,steer:0},FIXED_DT);
    stepVehicle(driving,track,{throttle:1,brake:0,steer:0},FIXED_DT);
  }
  expect(braking.tyre.loadTransfer).toBeGreaterThan(.015);
  expect(driving.tyre.loadTransfer).toBeLessThan(-.003);
  const peak=Math.abs(braking.tyre.loadTransfer);
  for(let i=0;i<90;i++)stepVehicle(braking,track,{throttle:0,brake:0,steer:0},FIXED_DT);
  expect(Math.abs(braking.tyre.loadTransfer)).toBeLessThan(peak);
  expect(braking.tyre.forceUsage).toBeLessThanOrEqual(1.000001);
});
