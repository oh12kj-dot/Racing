import {test,expect} from '@playwright/test';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {planRacecraft} from '../src/simulation/racecraft.js';
import {buildEntrants} from '../src/config.js';

function straightS(track){
  for(let s=0;s<track.total;s+=4){
    if(Math.abs(track.curvature(s+20))<.006)return s;
  }
  throw new Error('No representative straight found');
}

test('RC-07: one defensive move is allowed per continuous attack episode',()=>{
  const track=createTrack(),entries=buildEntrants(),s=straightS(track);
  const defender=createVehicleState(entries[2],s,2);
  const attacker=createVehicleState(entries[3],track.wrapS(s-14),2);
  defender.v=45;attacker.v=48;defender.lane=0;attacker.lane=0;
  defender.targetLane=0;attacker.targetLane=0;

  let p=planRacecraft(defender,[defender,attacker],track,10);
  expect(p.reason).toBe('DEFEND_ONE_MOVE');
  expect(defender.racecraft.defenseUsed).toBeTruthy();
  const firstDefenseLane=p.targetLane;
  expect(Math.abs(firstDefenseLane-defender.lane)).toBeGreaterThan(1);

  p=planRacecraft(defender,[defender,attacker],track,11);
  expect(p.reason).not.toBe('DEFEND_ONE_MOVE');
  expect(defender.racecraft.defenseUsed).toBeTruthy();

  p=planRacecraft(defender,[defender,attacker],track,20);
  expect(p.reason).not.toBe('DEFEND_ONE_MOVE');
  expect(defender.racecraft.defenseUsed).toBeTruthy();

  attacker.s=track.wrapS(defender.s-60);
  planRacecraft(defender,[defender,attacker],track,21);
  expect(defender.racecraft.defenseUsed).toBeFalsy();

  attacker.s=track.wrapS(defender.s-14);
  p=planRacecraft(defender,[defender,attacker],track,22);
  expect(p.reason).toBe('DEFEND_ONE_MOVE');
});

test('BLUE FLAG: yield context cancels attack intent without abrupt braking or position change',()=>{
  const track=createTrack(),entries=buildEntrants(),s=straightS(track);
  const slow=createVehicleState(entries.find(e=>e.type==='gt'),s,2);
  const fast=createVehicleState(entries[0],track.wrapS(s-30),2);
  slow.v=42;fast.v=55;slow.lane=.4;fast.lane=-1.2;
  slow.targetLane=.4;fast.targetLane=-1.2;
  slow.racecraft={state:'COMMIT',targetId:fast.id,commitUntil:30,setupUntil:0,switchUntil:0,attackKind:'STRAIGHT',lane:2.5,defenseUsed:false,alongsideAt:0};
  slow.blueFlag=true;
  const before={s:slow.s,v:slow.v,lane:slow.lane};

  const p=planRacecraft(slow,[slow,fast],track,25);
  expect(p.reason).toBe('BLUE_FLAG_PREDICTABLE');
  expect(p.state).toBe('YIELD');
  expect(p.targetSpeed).toBe(Infinity);
  expect(Math.abs(p.targetLane-track.idealLane(slow.s))).toBeLessThan(1e-9);
  expect({s:slow.s,v:slow.v,lane:slow.lane}).toEqual(before);
});
