import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRaceSimulation} from '../src/simulation/race.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState,cornerSpeedLimit} from '../src/simulation/vehicle.js';
import {planRacecraft} from '../src/simulation/racecraft.js';
import {computeTrafficAero} from '../src/simulation/traffic-aero.js';
import {evaluatePitStrategy,PIT_REASON} from '../src/simulation/strategy.js';
import {buildEntrants,FIXED_DT,VEHICLE_CLASSES} from '../src/config.js';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=(sim,seconds)=>{for(let i=0;i<Math.round(seconds/FIXED_DT);i++){sim.update(FIXED_DT);if(sim.snapshot().finished)break;}};

test('architecture gate: no versioned behavior or qualifying runtime',()=>{
  const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p):files.push(p);}};
  walk(path.join(appRoot,'src'));
  expect(files.some(f=>/[/\\]v\d+[-_]/i.test(f))).toBeFalsy();
  const src=files.filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(f,'utf8')).join('\n');
  expect(src).not.toMatch(/\bQUALIFYING\b|\bQUALIFY\b/);
  expect(fs.existsSync(path.join(appRoot,'runtime'))).toBeFalsy();
});

test('PHY/TRK: class ordering, friction envelope and roundtrip',()=>{
  expect(cornerSpeedLimit(VEHICLE_CLASSES.formula,.012,1)).toBeGreaterThan(cornerSpeedLimit(VEHICLE_CLASSES.gt,.012,1)*1.12);
  const track=createTrack();
  for(const s of [0,track.total*.11,track.total*.37,track.total*.74,track.total*.96])for(const lane of [-5,0,4.5]){
    const q=track.sample(s,lane),back=track.worldToTrack(q.x,q.z);
    expect(Math.abs(track.signedDistance(s,back.s))).toBeLessThan(.8);expect(Math.abs(back.lateral-lane)).toBeLessThan(.12);
  }
  const sim=createRaceSimulation(0x1111,{raceLaps:40});run(sim,100);const snap=sim.snapshot();
  expect(snap.diagnostics.finite).toBeTruthy();expect(snap.diagnostics.maxForceUsage).toBeLessThanOrEqual(1.000001);expect(snap.diagnostics.recoveries).toBe(0);
});

test('PHY-01: 24-car state remains finite for 60 simulated minutes',()=>{
  test.setTimeout(240000);
  const sim=createRaceSimulation(0x7a11,{raceLaps:500});const steps=Math.round(3600/FIXED_DT);
  for(let i=0;i<steps;i++){sim.update(FIXED_DT);if(i%3600===0)expect(sim.snapshot().diagnostics.finite).toBeTruthy();}
  const snap=sim.snapshot();expect(snap.time).toBeGreaterThan(3599);expect(snap.diagnostics.finite).toBeTruthy();expect(snap.diagnostics.maxForceUsage).toBeLessThanOrEqual(1.000001);
  expect(Number.isFinite(snap.diagnostics.maxYawRate)).toBeTruthy();
});

test('AERO: draft reduces drag while dirty air only reduces aero when aligned in a wake',()=>{
  const track=createTrack(),entries=buildEntrants();
  const follower=createVehicleState(entries[0],100,1),leader=createVehicleState(entries[1],118,1);
  follower.v=60;leader.v=58;follower.lane=0;leader.lane=0;
  const aligned=computeTrafficAero(follower,[follower,leader],track);
  expect(aligned.sourceId).toBe(leader.id);expect(aligned.dragFactor).toBeLessThan(1);expect(aligned.downforceFactor).toBeLessThan(1);
  leader.lane=5;
  const offset=computeTrafficAero(follower,[follower,leader],track);
  expect(offset.dragFactor).toBe(1);expect(offset.downforceFactor).toBe(1);
  leader.lane=0;leader.s=170;
  const distant=computeTrafficAero(follower,[follower,leader],track);
  expect(distant.dragFactor).toBe(1);expect(distant.downforceFactor).toBe(1);
  expect(VEHICLE_CLASSES.formula.dirtyAirLoss).toBeGreaterThan(VEHICLE_CLASSES.gt.dirtyAirLoss);
});

test('STRATEGY: pit requests are reason-coded and never write tactical lane intent',()=>{
  const track=createTrack(),car=createVehicleState(buildEntrants()[0],100,1);
  car.targetLane=1.25;car.pit.plannedLap=3;
  let decision=evaluatePitStrategy(car,track,8);
  expect(decision.request).toBeFalsy();expect(decision.reason).toBe(PIT_REASON.NONE);expect(car.targetLane).toBe(1.25);
  car.systems.tyreWear=.7;
  decision=evaluatePitStrategy(car,track,8);
  expect(decision.request).toBeTruthy();expect(decision.reason).toBe(PIT_REASON.TYRES);expect(car.targetLane).toBe(1.25);
  car.systems.tyreWear=0;car.lap=3;
  decision=evaluatePitStrategy(car,track,8);
  expect(decision.reason).toBe(PIT_REASON.PLANNED);
});

test('REG-SPEED-101: green running is not locked around 101 km/h',()=>{
  const sim=createRaceSimulation(0x2222,{raceLaps:40}),tracked=[],spreads=[],stds=[],peaks=[];
  const total=Math.round(120/FIXED_DT),every=Math.round(.5/FIXED_DT);
  for(let i=0;i<total;i++){
    sim.update(FIXED_DT);if(i%every)continue;const s=sim.snapshot();if(s.flag!=='GREEN'||s.time<8)continue;
    const live=s.cars.filter(c=>!c.finished&&!c.retired&&c.pit.phase==='TRACK');if(!live.length)continue;
    if(s.cars[0].pit.phase==='TRACK')tracked.push(s.cars[0].v*3.6);
    const vs=live.map(c=>c.v*3.6),m=vs.reduce((a,b)=>a+b,0)/vs.length;
    spreads.push(Math.max(...vs)-Math.min(...vs));stds.push(Math.sqrt(vs.reduce((n,v)=>n+(v-m)**2,0)/vs.length));peaks.push(Math.max(...vs));
  }
  const ratio=tracked.filter(v=>v>=99&&v<=103).length/Math.max(1,tracked.length);
  expect(Math.max(...tracked)-Math.min(...tracked)).toBeGreaterThan(15);expect(ratio).toBeLessThan(.65);expect(Math.max(...peaks)).toBeGreaterThan(115);expect(Math.max(...spreads)).toBeGreaterThan(18);expect(Math.max(...stds)).toBeGreaterThan(4);
});

test('determinism: same seed produces the same authoritative hash',()=>{
  const a=createRaceSimulation(0x3333,{raceLaps:30}),b=createRaceSimulation(0x3333,{raceLaps:30});
  for(let i=0;i<60*90;i++){a.update(FIXED_DT);b.update(FIXED_DT);}expect(a.stateHash()).toBe(b.stateHash());
});

test('RC: multiclass pass, safe parallel running and convergence safety coexist',()=>{
  const track=createTrack(),entries=buildEntrants(),fast=createVehicleState(entries[0],100,1),slow=createVehicleState(entries.find(e=>e.type==='gt'),125,1);
  fast.v=55;slow.v=38;fast.lane=0;slow.lane=0;let p=planRacecraft(fast,[fast,slow],track,20);
  expect(['MULTICLASS_PASS','ATTACK']).toContain(p.reason);expect(Math.abs(p.targetLane-slow.lane)).toBeGreaterThan(2);
  fast.racecraft={state:'RESET',targetId:null,commitUntil:0,defenseUsed:false};fast.s=200;slow.s=201;fast.lane=-1.7;slow.lane=1.7;fast.v=46;slow.v=45;p=planRacecraft(fast,[fast,slow],track,30);
  expect(Number.isFinite(p.targetSpeed)?p.targetSpeed:999).toBeGreaterThan(40);
  fast.racecraft={state:'RESET',targetId:null,commitUntil:0,defenseUsed:false};fast.s=300;slow.s=302;fast.lane=-.4;slow.lane=.4;fast.v=48;slow.v=44;p=planRacecraft(fast,[fast,slow],track,40);
  expect(['COLLISION_AVOID','TRAFFIC_FOLLOW']).toContain(p.reason);
});

test('PIT/RACE/TIMING: mandatory stop completes and sector sum matches lap time',()=>{
  const sim=createRaceSimulation(0x4444);run(sim,420);const snap=sim.snapshot();expect(snap.finished).toBeTruthy();expect(snap.cars.filter(c=>!c.retired).every(c=>c.pit.served)).toBeTruthy();
  for(const car of snap.cars){const lap=car.timing.laps.find(x=>x.sectors?.length===3);if(lap)expect(Math.abs(lap.sectors.reduce((a,b)=>a+b,0)-lap.time)).toBeLessThan(.002);}
  expect(snap.session).toBe('RACE');
});

test('RACE-05: incident triggers physical yellow control without teleport',()=>{
  const sim=createRaceSimulation(0x5555,{raceLaps:20});run(sim,25);const victim=sim.cars[6];victim.incident.spinTimer=3;victim.yawRate=1.1;const before=sim.cars.map(c=>c.s);sim.update(FIXED_DT);const s=sim.snapshot();expect(s.flag).toBe('YELLOW');
  for(let i=0;i<sim.cars.length;i++)expect(Math.abs(sim.track.signedDistance(before[i],sim.cars[i].s))).toBeLessThan(Math.max(2,sim.cars[i].v*FIXED_DT*1.6+1));
});

test('desktop UI boots and presentation-only camera change preserves state',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.__RACING__&&!!window.__RACING_LIFECYCLE__);
  expect(await page.evaluate(()=>document.querySelectorAll('canvas').length)).toBe(1);expect(await page.evaluate(()=>window.__RACING_RACE__.cars.length)).toBe(24);
  await page.evaluate(()=>window.__RACING_LIFECYCLE__.pauseForTest());
  const hash=await page.evaluate(()=>window.__RACING_RACE__.stateHash());
  await page.locator('button[data-cam="FOLLOW"]').click();await expect.poll(()=>page.evaluate(()=>window.__RACING__.director.mode)).toBe('FOLLOW');
  expect(await page.evaluate(()=>window.__RACING_RACE__.stateHash())).toBe(hash);
});
