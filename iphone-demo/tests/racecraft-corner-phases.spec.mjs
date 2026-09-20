import {test,expect} from '@playwright/test';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {planRacecraft} from '../src/simulation/racecraft.js';
import {buildEntrants} from '../src/config.js';

function pairAt(track,s=8){
  const entries=buildEntrants();
  const attacker=createVehicleState(entries[0],s,1);
  const leader=createVehicleState(entries[1],track.wrapS(s+24),1);
  attacker.v=55;leader.v=50;attacker.lane=0;leader.lane=0;
  attacker.targetLane=0;leader.targetLane=0;
  return{attacker,leader,entries};
}

test('RC-04: braking-zone attack progresses SETUP -> COMMIT -> ALONGSIDE -> COMPLETE',()=>{
  const track=createTrack(),{attacker,leader}=pairAt(track,8);
  const insideSign=track.curvature(attacker.s+35)>=0?1:-1;

  let p=planRacecraft(attacker,[attacker,leader],track,20);
  expect(p.state).toBe('SETUP');
  expect(attacker.racecraft.attackKind).toBe('INSIDE');
  expect(Math.sign(p.targetLane-leader.lane)).toBe(insideSign);

  p=planRacecraft(attacker,[attacker,leader],track,20.7);
  expect(p.state).toBe('COMMIT');
  expect(p.reason).toContain('PASS_COMMIT');

  attacker.lane=attacker.racecraft.lane;
  leader.lane=0;
  leader.s=track.wrapS(attacker.s+1.2);
  p=planRacecraft(attacker,[attacker,leader],track,21);
  expect(p.state).toBe('ALONGSIDE');
  expect(Number.isFinite(p.targetSpeed)?p.targetSpeed:999).toBeGreaterThan(40);

  attacker.s=track.wrapS(leader.s+10);
  p=planRacecraft(attacker,[attacker,leader],track,22);
  expect(p.state).toBe('COMPLETE');
  expect(p.reason).toBe('PASS_COMPLETE');
});

test('RC-05: outside attack remains available when the inside corridor is occupied',()=>{
  const track=createTrack(),{attacker,leader,entries}=pairAt(track,8);
  const insideSign=track.curvature(attacker.s+35)>=0?1:-1;
  const blocker=createVehicleState(entries[2],track.wrapS(attacker.s+6.2),1);
  blocker.v=50;blocker.lane=insideSign*4;blocker.targetLane=blocker.lane;

  const p=planRacecraft(attacker,[attacker,leader,blocker],track,30);
  expect(p.state).toBe('SETUP');
  expect(attacker.racecraft.attackKind).toBe('OUTSIDE');
  expect(Math.sign(p.targetLane-leader.lane)).toBe(-insideSign);
});

test('RC-06: lost inside overlap can request a physical switchback path without scripted position exchange',()=>{
  const track=createTrack(),{attacker,leader}=pairAt(track,944);
  const k=track.curvature(attacker.s+12),insideSign=k>=0?1:-1;
  attacker.v=45;leader.v=48;
  attacker.lane=insideSign*3.15;leader.lane=0;
  leader.s=track.wrapS(attacker.s+12);
  attacker.racecraft={state:'ALONGSIDE',targetId:leader.id,commitUntil:30,setupUntil:0,switchUntil:0,attackKind:'INSIDE',lane:attacker.lane,defenseUsed:false,alongsideAt:18};

  const progressBefore=[attacker.s,leader.s];
  const p=planRacecraft(attacker,[attacker,leader],track,20);
  expect(p.state).toBe('SWITCHBACK');
  expect(['SWITCHBACK_EXIT','TRAFFIC_FOLLOW']).toContain(p.reason);
  expect(Math.sign(p.targetLane)).toBe(-insideSign);
  expect([attacker.s,leader.s]).toEqual(progressBefore);
  if(p.reason==='TRAFFIC_FOLLOW')expect(p.targetSpeed).toBeLessThanOrEqual(leader.v+4);
});
