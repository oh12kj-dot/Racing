import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {createRaceSimulation} from '../src/simulation/race.js';
import {maybeRequestPit,planPit} from '../src/simulation/pit.js';

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

test('PIT-10: service release waits for unsafe fast-lane traffic and releases when TTC is safe',()=>{
  const track=createTrack(),entries=buildEntrants();
  const car=createVehicleState(entries[0],boxFor(entries[0],track),2);
  const traffic=createVehicleState(entries.find(e=>e.teamId!==car.teamId),track.wrapS(car.s-20),2);
  car.pit.phase='SERVICE';car.pit.requested=true;car.pit.boxS=boxFor(car,track);car.pit.serviceTimer=0;car.pit.serviceApplied=true;car.v=0;
  traffic.pit.phase='FAST_LANE';traffic.lane=track.pit.fastLane;traffic.v=22;
  planPit(car,[car,traffic],track,FIXED_DT);
  expect(car.pit.phase).toBe('RELEASE_WAIT');

  traffic.s=track.wrapS(car.s-65);
  planPit(car,[car,traffic],track,FIXED_DT);
  expect(car.pit.phase).toBe('WORKING_EXIT');
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
