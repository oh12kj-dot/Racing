import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {VEHICLE_PERFORMANCE,longitudinalPerformance,performanceFor,resolveMulticlassPassPlan,trafficFollowPolicy} from '../../iphone-demo/runtime/vehicle-performance-spec.js';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_TEST_TICK__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('vehicle class calibration keeps 2026 mass and hierarchy targets coherent',()=>{
  expect(VEHICLE_PERFORMANCE.formula.mass).toBe(768);
  expect(VEHICLE_PERFORMANCE.hyper.mass).toBe(1030);
  expect(VEHICLE_PERFORMANCE.lmh.mass).toBe(1030);
  expect(VEHICLE_PERFORMANCE.proto.mass).toBe(950);
  expect(VEHICLE_PERFORMANCE.supercar.mass).toBe(1350);
  expect(VEHICLE_PERFORMANCE.touring.mass).toBe(1265);
  expect(VEHICLE_PERFORMANCE.formula.fuelCapacity).toBe(70);
  expect(VEHICLE_PERFORMANCE.proto.fuelTankLitres).toBe(75);
  expect(VEHICLE_PERFORMANCE.proto.fuelCapacity).toBeCloseTo(56,0);
  expect(VEHICLE_PERFORMANCE.supercar.fuelTankLitres).toBe(135);
  expect(VEHICLE_PERFORMANCE.supercar.fuelCapacity).toBeCloseTo(101,0);
  expect(VEHICLE_PERFORMANCE.formula.lateralG).toBeGreaterThan(VEHICLE_PERFORMANCE.proto.lateralG);
  expect(VEHICLE_PERFORMANCE.proto.lateralG).toBeGreaterThan(VEHICLE_PERFORMANCE.gt.lateralG);
  expect(VEHICLE_PERFORMANCE.formula.brake).toBeGreaterThan(VEHICLE_PERFORMANCE.hyper.brake);
  expect(VEHICLE_PERFORMANCE.hyper.brake).toBeGreaterThan(VEHICLE_PERFORMANCE.gt.brake);
  expect(VEHICLE_PERFORMANCE.gt.brake).toBeGreaterThan(VEHICLE_PERFORMANCE.touring.brake);
  expect(VEHICLE_PERFORMANCE.supercar.top*3.6).toBeCloseTo(300,0);
  expect(VEHICLE_PERFORMANCE.touring.top*3.6).toBeCloseTo(253,0);
});

test('all supported classes expose a complete performance envelope',()=>{
  for(const type of ['formula','hyper','lmh','proto','gt','supercar','touring']){
    const p=performanceFor(type);
    for(const key of ['top','accel','brake','tyre','wet','mass','paceIndex','lateralG','laneChangeG','aero','traction','tyreWear','fuelCapacity','fuelBurnPerMeter','wheelbase','steer','steerRate','draftGain','dirtyAirLoss'])expect(Number.isFinite(p[key]),`${type}.${key}`).toBeTruthy();
    for(const band of ['accelBand','brakeBand'])for(const key of ['low','mid','high'])expect(Number.isFinite(p[band][key]),`${type}.${band}.${key}`).toBeTruthy();
  }
});

test('formula acceleration falls with speed while aero braking grows',()=>{
  const low=longitudinalPerformance('formula',15),mid=longitudinalPerformance('formula',55),high=longitudinalPerformance('formula',90);
  expect(low.accel).toBeGreaterThan(mid.accel);
  expect(mid.accel).toBeGreaterThan(high.accel);
  expect(high.brake).toBeGreaterThan(mid.brake);
  expect(mid.brake).toBeGreaterThan(low.brake);
});

test('faster class arms a multiclass pass before collision braking traps it behind traffic',()=>{
  const plan=resolveMulticlassPassPlan({followerType:'formula',leaderType:'touring',gapM:82,closingMps:19,brakingLoad:.08,leaderLane:.3,halfWidth:3.55});
  expect(plan.eligible).toBeTruthy();
  expect(Math.abs(plan.targetLane)).toBeGreaterThan(2.1);
  expect(plan.paceDelta).toBeGreaterThan(.25);
});

test('same-class traffic does not receive the multiclass early-pass exemption',()=>{
  const plan=resolveMulticlassPassPlan({followerType:'gt',leaderType:'gt',gapM:60,closingMps:8,brakingLoad:.05,leaderLane:0,halfWidth:3.55});
  expect(plan.eligible).toBeFalsy();
});

test('planned lateral escape prevents premature follow braking while blocked lane still caps speed',()=>{
  const passing=trafficFollowPolicy({followerType:'formula',leaderType:'touring',gapM:50,speedMps:90,leaderSpeedMps:65,bodyGapM:5,currentLateralM:.3,plannedLateralM:2.8,safeLateralM:2.4,passIntent:true});
  const blocked=trafficFollowPolicy({followerType:'formula',leaderType:'touring',gapM:50,speedMps:90,leaderSpeedMps:65,bodyGapM:5,currentLateralM:.3,plannedLateralM:.4,safeLateralM:2.4,passIntent:true});
  expect(passing.passEscape).toBeTruthy();
  expect(passing.shouldCap).toBeFalsy();
  expect(blocked.passEscape).toBeFalsy();
  expect(blocked.shouldCap).toBeTruthy();
});

test('legacy realism layer no longer applies a second hard-coded class performance table',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-realism.js',import.meta.url),'utf8');
  expect(source).toContain("from './vehicle-performance-spec.js'");
  expect(source).not.toContain('formula:{top:91');
  expect(source).not.toContain('cornerCoeff:.72');
});

test('Formula completes a clean multiclass pass on a slower Touring car',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,tick=window.__RACING_TEST_TICK__,total=W.total;
    let greenReady=false;
    for(let i=0;i<1200;i++){
      tick(.05,false);
      const control=R.physicalCaution;
      if(R.race.t>12&&R.flag==='GREEN'&&!(control?.localYellows?.length)&&!(control?.recoveries?.length)){greenReady=true;break;}
    }
    const startFlag=R.flag,startControl=R.physicalCaution;
    const fast=R.cars[0],slow=R.cars[1];
    for(let i=2;i<R.cars.length;i++){R.cars[i].retired=true;if(R.cars[i].mesh)R.cars[i].mesh.visible=false;}
    Object.assign(fast,{type:'formula',s:180,lap:1,_v8Progress:total+180,lane:0,laneTarget:0,v:82,pitState:'NONE',spinState:'NONE',offTrack:false,retired:false,damage:0,incident:0,avoid:0,position:2});
    Object.assign(slow,{type:'touring',s:242,lap:1,_v8Progress:total+242,lane:0,laneTarget:0,v:61,pitState:'NONE',spinState:'NONE',offTrack:false,retired:false,damage:0,incident:0,avoid:0,position:1});
    if(fast.driver){fast.driver.aggression=.92;fast.driver.racecraft=.94;}if(slow.driver){slow.driver.aggression=.55;slow.driver.racecraft=.82;}
    for(const c of[fast,slow]){const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);c.mesh.visible=true;}
    const progress=c=>Number(c._v8Progress??(c.lap*total+c.s)),startFast=progress(fast),startSlow=progress(slow),eventStart=R.events?.length||0;
    let passed=false,maxSeparation=0;
    for(let i=0;i<320;i++){
      tick(.05,false);const fp=progress(fast),sp=progress(slow);maxSeparation=Math.max(maxSeparation,Math.abs((fast.lane||0)-(slow.lane||0)));if(fp>sp+2){passed=true;break;}
    }
    const contacts=(R.events||[]).slice(eventStart).filter(e=>e.type==='CONTACT'&&(e.carId===fast.id||e.carId===slow.id));
    return{greenReady,startFlag,startControl:{type:startControl?.type,localYellows:startControl?.localYellows?.length||0,recoveries:startControl?.recoveries?.length||0},passed,startGap:startSlow-startFast,finalGap:progress(fast)-progress(slow),maxSeparation,armed:R.collisionAvoidance?.multiclassPassesArmed||0,contacts:contacts.map(e=>e.data?.severity||0),fastSpeed:fast.v,slowSpeed:slow.v};
  });
  expect(result.greenReady,JSON.stringify(result)).toBeTruthy();
  expect(result.startFlag,JSON.stringify(result)).toBe('GREEN');
  expect(result.startControl.localYellows,JSON.stringify(result)).toBe(0);
  expect(result.startControl.recoveries,JSON.stringify(result)).toBe(0);
  expect(result.startGap).toBeGreaterThan(50);
  expect(result.armed,JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.maxSeparation,JSON.stringify(result)).toBeGreaterThan(1.6);
  expect(result.passed,JSON.stringify(result)).toBeTruthy();
  expect(Math.max(0,...result.contacts),JSON.stringify(result)).toBeLessThan(.55);
});
