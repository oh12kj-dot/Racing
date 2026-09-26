import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {createRaceSimulation} from '../src/simulation/race.js';
import {maybeRequestPit,planPit} from '../src/simulation/pit.js';
import {serviceSystems} from '../src/simulation/systems.js';

const boxFor=(car,track)=>track.pit.boxStart+car.teamId*track.pit.boxSpacing;

test('PIT-01/02/13: pit call is deduplicated and early ENTRY is deferred to physical approach',()=>{
  const track=createTrack(),car=createVehicleState(buildEntrants()[0],track.wrapS(track.pit.entryStart-300),1);
  car.pit.plannedLap=1;
  const events=[];
  for(let i=0;i<40;i++)maybeRequestPit(car,track,(type,c,text)=>events.push({type,id:c.id,text}),{request:true,reason:'PLANNED'});
  expect(car.pit.phase).toBe('PIT_APPROACH');
  expect(events.filter(e=>e.type==='PIT_CALL')).toHaveLength(1);

  const legacy=createVehicleState(buildEntrants()[2],track.wrapS(track.pit.entryStart-240),1);
  legacy.pit.phase='ENTRY';legacy.pit.requested=true;
  const plan=planPit(legacy,[legacy],track,FIXED_DT);
  expect(legacy.pit.phase).toBe('PIT_APPROACH');
  expect(Math.abs(plan.targetLane)).toBeLessThan(track.sample(legacy.s).halfWidth);
});

test('PIT-06/07/08/09: capture is physical, teams service in parallel and same-team double stack queues',()=>{
  const track=createTrack(),entries=buildEntrants();
  const a=createVehicleState(entries[0],boxFor(entries[0],track)-4,2);
  const same=createVehicleState(entries[1],boxFor(entries[1],track)+1,2);
  const otherEntry=entries.find(e=>e.teamId!==a.teamId);
  const b=createVehicleState(otherEntry,boxFor(otherEntry,track)+1,2);
  for(const c of [a,same,b]){c.pit.phase='WORKING_APPROACH';c.pit.requested=true;c.pit.boxS=boxFor(c,track);}

  a.v=3.2;
  planPit(a,[a,same,b],track,FIXED_DT);
  expect(a.pit.phase).toBe('WORKING_APPROACH');

  a.s=a.pit.boxS+.8;a.v=1.0;a.lane=track.pit.fastLane;
  planPit(a,[a,same,b],track,FIXED_DT);
  expect(a.pit.phase).toBe('WORKING_APPROACH');

  a.lane=track.pit.workingLane;b.s=b.pit.boxS+.8;b.v=1.0;b.lane=track.pit.workingLane;
  planPit(a,[a,same,b],track,FIXED_DT);
  planPit(b,[a,same,b],track,FIXED_DT);
  expect(a.pit.phase).toBe('SERVICE');
  expect(b.pit.phase).toBe('SERVICE');

  same.s=same.pit.boxS+1;same.v=1.0;
  const queued=planPit(same,[a,same,b],track,FIXED_DT);
  expect(same.pit.phase).toBe('QUEUE');
  expect(queued.targetLane).toBe(track.pit.workingLane);
  expect(Math.abs(track.pit.fastLane-queued.targetLane)).toBeGreaterThan((same.width+a.width)*.5+.45);
});

test('PIT-10: service release reserves enough time to clear the working-lane exit',()=>{
  const track=createTrack(),entries=buildEntrants();
  const car=createVehicleState(entries[0],boxFor(entries[0],track),2);
  const traffic=createVehicleState(entries.find(e=>e.teamId!==car.teamId),track.wrapS(car.s-20),2);
  car.pit.phase='SERVICE';car.pit.requested=true;car.pit.boxS=boxFor(car,track);car.pit.serviceTimer=0;car.pit.serviceApplied=true;car.v=0;
  traffic.pit.phase='FAST_LANE';traffic.lane=track.pit.fastLane;traffic.v=22;
  planPit(car,[car,traffic],track,FIXED_DT);
  expect(car.pit.phase).toBe('RELEASE_WAIT');

  // 65 m is only about three seconds at pit-lane speed and is not enough for
  // every stopped class to accelerate through the 38 m working-lane exit.
  traffic.s=track.wrapS(car.s-65);
  planPit(car,[car,traffic],track,FIXED_DT);
  expect(car.pit.phase).toBe('RELEASE_WAIT');

  traffic.s=track.wrapS(car.s-85);
  planPit(car,[car,traffic],track,FIXED_DT);
  expect(car.pit.phase).toBe('WORKING_EXIT');
});

test('PIT-14: pit exit yields physically to unsafe main-track traffic before merge',()=>{
  const track=createTrack(),entries=buildEntrants();
  const car=createVehicleState(entries[0],track.pit.mergeStart-42,2);
  const traffic=createVehicleState(entries[3],track.pit.mergeStart-70,2);
  car.pit.phase='FAST_LANE_EXIT';car.pit.requested=true;car.lane=track.pit.fastLane;car.v=22;
  traffic.pit.phase='TRACK';traffic.lane=-2.0;traffic.v=50;
  const beforeTraffic={s:traffic.s,v:traffic.v,lane:traffic.lane};
  let plan=planPit(car,[car,traffic],track,FIXED_DT);
  expect(car.pit.phase).toBe('FAST_LANE_EXIT');
  expect(plan.targetLane).toBe(track.pit.fastLane);
  // The target is the exact braking envelope needed to stop at the hold point;
  // it need only be below the limiter, not an arbitrary whole m/s lower.
  expect(plan.targetSpeed).toBeLessThan(track.pit.speedLimit);
  expect({s:traffic.s,v:traffic.v,lane:traffic.lane}).toEqual(beforeTraffic);

  car.s=track.pit.mergeStart-4;car.v=.2;
  traffic.s=track.pit.mergeStart-24;traffic.v=45;
  plan=planPit(car,[car,traffic],track,FIXED_DT);
  expect(car.pit.phase).toBe('FAST_LANE_EXIT');
  expect(plan.targetSpeed).toBe(0);
  expect(plan.targetLane).toBe(track.pit.fastLane);

  traffic.s=track.pit.mergeStart+70;traffic.v=45;
  car.s=track.pit.mergeStart;car.v=.2;
  plan=planPit(car,[car,traffic],track,FIXED_DT);
  expect(car.pit.phase).toBe('MERGE');
  // Entry into MERGE starts from the physical fast-lane position; lateral
  // motion begins continuously after crossing the merge start, not instantly.
  expect(plan.targetLane).toBeCloseTo(track.pit.fastLane,9);
  car.s=track.pit.mergeStart+(track.pit.mergeEnd-track.pit.mergeStart)*.5;
  plan=planPit(car,[car,traffic],track,FIXED_DT);
  expect(plan.targetLane).toBeGreaterThan(track.pit.fastLane);
  expect(plan.targetLane).toBeLessThan(-2.2);
});

test('PIT-15: merge completes in the merge corridor instead of cutting straight to the racing line',()=>{
  const track=createTrack(),entries=buildEntrants();
  const car=createVehicleState(entries[0],track.pit.mergeEnd,2);
  car.pit.phase='MERGE';car.pit.requested=true;car.lane=-2.4;car.v=22;
  const plan=planPit(car,[car],track,FIXED_DT);
  expect(car.pit.phase).toBe('TRACK');
  expect(plan.targetLane).toBeCloseTo(-2.2,9);
});

test('PIT-16: pit-exit traffic follows a slower car instead of stacking into it',()=>{
  const track=createTrack(),entries=buildEntrants();
  const follower=createVehicleState(entries[0],track.pit.mergeStart-30,2);
  const leader=createVehicleState(entries[2],track.pit.mergeStart-18,2);
  for(const c of [follower,leader]){c.pit.phase='FAST_LANE_EXIT';c.pit.requested=true;c.lane=track.pit.fastLane;}
  follower.v=22;leader.v=8;
  const plan=planPit(follower,[follower,leader],track,FIXED_DT);
  expect(plan.targetLane).toBe(track.pit.fastLane);
  expect(plan.targetSpeed).toBeLessThan(track.pit.speedLimit-2);
  expect(plan.targetSpeed).toBeGreaterThanOrEqual(leader.v);
});

test('PIT-17: service plan applies only the requested pit work',()=>{
  const entries=buildEntrants();

  const tyreOnly=createVehicleState(entries[0],100,2);
  Object.assign(tyreOnly.systems,{fuel:20,tyreWear:.64,tyreTemp:108,engineTemp:121,brakeTemp:520,mechanicalStress:.62,powerDerate:.24});
  tyreOnly.incident.damage=.70;tyreOnly.tyre.slipRatio=.22;tyreOnly.tyre.slipAngle=.18;
  serviceSystems(tyreOnly,{tyres:true,tyreCompound:'WET',fuel:false,repair:false,cooling:false});
  expect(tyreOnly.systems.tyreCompound).toBe('WET');
  expect(tyreOnly.systems.tyreWear).toBe(0);
  expect(tyreOnly.systems.tyreTemp).toBe(70);
  expect(tyreOnly.tyre.slipRatio).toBe(0);expect(tyreOnly.tyre.slipAngle).toBe(0);
  expect(tyreOnly.systems.fuel).toBe(20);
  expect(tyreOnly.systems.engineTemp).toBe(121);expect(tyreOnly.systems.brakeTemp).toBe(520);
  expect(tyreOnly.systems.mechanicalStress).toBe(.62);expect(tyreOnly.systems.powerDerate).toBe(.24);
  expect(tyreOnly.incident.damage).toBe(.70);

  const fuelOnly=createVehicleState(entries[2],100,2);
  Object.assign(fuelOnly.systems,{fuel:20,tyreWear:.51,tyreTemp:101,engineTemp:118,brakeTemp:490,mechanicalStress:.50,powerDerate:.18});
  fuelOnly.incident.damage=.55;
  serviceSystems(fuelOnly,{tyres:false,tyreCompound:'WET',fuel:true,repair:false,cooling:false});
  expect(fuelOnly.systems.fuel).toBeCloseTo(fuelOnly.systems.fuelCapacity*.82,9);
  expect(fuelOnly.systems.tyreCompound).toBe('SLICK');
  expect(fuelOnly.systems.tyreWear).toBe(.51);expect(fuelOnly.systems.tyreTemp).toBe(101);
  expect(fuelOnly.systems.engineTemp).toBe(118);expect(fuelOnly.systems.brakeTemp).toBe(490);
  expect(fuelOnly.systems.mechanicalStress).toBe(.50);expect(fuelOnly.systems.powerDerate).toBe(.18);
  expect(fuelOnly.incident.damage).toBe(.55);

  const maintenance=createVehicleState(entries[4],100,2);
  Object.assign(maintenance.systems,{fuel:20,tyreWear:.52,tyreTemp:104,engineTemp:124,brakeTemp:530,mechanicalStress:.68,powerDerate:.30});
  maintenance.incident.damage=.75;
  serviceSystems(maintenance,{tyres:false,fuel:false,repair:true,cooling:true});
  expect(maintenance.systems.fuel).toBe(20);
  expect(maintenance.systems.tyreWear).toBe(.52);expect(maintenance.systems.tyreTemp).toBe(104);
  expect(maintenance.systems.engineTemp).toBe(94);expect(maintenance.systems.brakeTemp).toBe(260);
  expect(maintenance.systems.mechanicalStress).toBeCloseTo(.33,9);expect(maintenance.systems.powerDerate).toBe(0);
  expect(maintenance.incident.damage).toBeCloseTo(.43,9);

  const legacy=createVehicleState(entries[6],100,2);
  Object.assign(legacy.systems,{fuel:20,tyreWear:.50,tyreTemp:103,engineTemp:120,brakeTemp:500,mechanicalStress:.60,powerDerate:.22});
  legacy.incident.damage=.60;
  serviceSystems(legacy,null);
  expect(legacy.systems.fuel).toBeCloseTo(legacy.systems.fuelCapacity*.82,9);
  expect(legacy.systems.tyreWear).toBe(0);
  expect(legacy.systems.engineTemp).toBe(94);expect(legacy.systems.brakeTemp).toBe(260);
  expect(legacy.systems.mechanicalStress).toBeCloseTo(.25,9);expect(legacy.systems.powerDerate).toBe(0);
  expect(legacy.incident.damage).toBeCloseTo(.28,9);

  expect([tyreOnly,fuelOnly,maintenance,legacy].map(c=>c.systems.serviceCount)).toEqual([1,1,1,1]);
});

test('PIT-03/04/05/11/12: full pit transit is continuous, corridor-bound and limiter-controlled',()=>{
  test.setTimeout(90000);
  const sim=createRaceSimulation(0xabc5,{raceLaps:100}),track=sim.track,car=sim.cars[0];
  for(const c of sim.cars.slice(1))c.retired=true;
  for(let i=0;i<Math.round(4/FIXED_DT);i++)sim.update(FIXED_DT);

  car.s=track.wrapS(track.pit.entryStart-330);car.lastS=car.s;car.lap=2;car.v=62;car.lane=track.idealLane(car.s);car.laneV=0;car.laneA=0;car.steer=0;
  car.pit.requested=true;car.pit.served=false;car.pit.phase='PIT_APPROACH';car.pit.boxS=boxFor(car,track);car.pit.missedCount=0;
  let previous={s:car.s,lane:car.lane,v:car.v,yaw:car.yaw},sawLimiter=false,sawService=false,maxLaneStep=0,maxSpeedStep=0;

  for(let i=0;i<Math.round(70/FIXED_DT);i++){
    sim.update(FIXED_DT);
    const ds=Math.abs(track.signedDistance(previous.s,car.s));
    const dl=Math.abs(car.lane-previous.lane),dv=Math.abs(car.v-previous.v);
    maxLaneStep=Math.max(maxLaneStep,dl);maxSpeedStep=Math.max(maxSpeedStep,dv);
    expect(ds).toBeLessThan(Math.max(1.6,previous.v*FIXED_DT*1.7+.3));
    expect(dl).toBeLessThan(.35);
    expect(dv).toBeLessThan((car.spec.brake+3)*FIXED_DT+.08);
    expect([car.s,car.lane,car.v,car.yaw,car.steer].every(Number.isFinite)).toBeTruthy();

    if(car.pit.phase==='FAST_LANE'||car.pit.phase==='FAST_LANE_EXIT')expect(Math.abs(car.lane-track.pit.fastLane)).toBeLessThan(2.3);
    if(['WORKING_APPROACH','QUEUE','WORKING_EXIT'].includes(car.pit.phase)){
      const inner=Math.min(track.pit.fastLane,track.pit.workingLane)-1.2;
      const outer=Math.max(track.pit.fastLane,track.pit.workingLane)+2.3;
      expect(car.lane).toBeGreaterThan(inner);
      expect(car.lane).toBeLessThan(outer);
    }
    if(['SERVICE','RELEASE_WAIT'].includes(car.pit.phase))expect(Math.abs(car.lane-track.pit.workingLane)).toBeLessThan(1.15);
    if(car.s>=track.pit.speedLine&&car.s<track.pit.limiterEnd&&car.pit.phase!=='TRACK'){
      sawLimiter=true;
      expect(car.targetSpeed).toBeLessThanOrEqual(track.pit.speedLimit+1e-9);
      expect(car.v).toBeLessThan(track.pit.speedLimit+2.2);
    }
    if(car.pit.phase==='SERVICE')sawService=true;
    previous={s:car.s,lane:car.lane,v:car.v,yaw:car.yaw};
    if(car.pit.phase==='TRACK'&&car.pit.served)break;
  }

  expect(sawLimiter).toBeTruthy();expect(sawService).toBeTruthy();
  expect(car.pit.phase).toBe('TRACK');expect(car.pit.served).toBeTruthy();
  expect(maxLaneStep).toBeLessThan(.35);expect(maxSpeedStep).toBeLessThan(.7);
});