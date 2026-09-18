import {test,expect} from '@playwright/test';
import {projectedSideBySideRisk} from '../../iphone-demo/runtime/race-contact-avoidance.js';
import {trafficFollowPolicy} from '../../iphone-demo/runtime/vehicle-performance-spec.js';

test('narrow but parallel straight-line overlap does not request avoidance',()=>{
  const a={width:2.0,lane:-1.03,laneTarget:-1.08,lateralVelocity:-.05};
  const b={width:2.0,lane:1.03,laneTarget:1.08,lateralVelocity:.05};
  const risk=projectedSideBySideRisk(a,b,{horizon:1,cornerLoad:0});
  expect(risk.currentSep).toBeCloseTo(2.06,2);
  expect(risk.currentSep).toBeGreaterThan(risk.physicalClearance);
  expect(risk.parallelClear).toBeTruthy();
  expect(risk.projectedContact).toBeFalsy();
});

test('side-by-side cars that converge toward each other remain an avoidance threat',()=>{
  const a={width:2.0,lane:-1.05,laneTarget:-.70,lateralVelocity:.70};
  const b={width:2.0,lane:1.05,laneTarget:.70,lateralVelocity:-.70};
  const risk=projectedSideBySideRisk(a,b,{horizon:1,cornerLoad:0});
  expect(risk.projectedContact).toBeTruthy();
  expect(risk.parallelClear).toBeFalsy();
  expect(risk.minFutureSep).toBeLessThan(risk.riskClearance);
});

test('corner load increases the clearance required for a projected parallel pass',()=>{
  const a={width:2.0,lane:-1.05,laneTarget:-1.075,lateralVelocity:-.025};
  const b={width:2.0,lane:1.05,laneTarget:1.075,lateralVelocity:.025};
  const straight=projectedSideBySideRisk(a,b,{horizon:1,cornerLoad:0});
  const corner=projectedSideBySideRisk(a,b,{horizon:1,cornerLoad:1});
  expect(straight.parallelClear).toBeTruthy();
  expect(corner.riskClearance).toBeGreaterThan(straight.riskClearance);
  expect(corner.projectedContact).toBeTruthy();
});

test('follow policy does not brake a physically clear parallel pass but still caps convergence',()=>{
  const common={followerType:'formula',leaderType:'touring',gapM:8,speedMps:78,leaderSpeedMps:69,bodyGapM:5,currentLateralM:2.06,safeLateralM:2.27,passIntent:false};
  const parallel=trafficFollowPolicy({...common,plannedLateralM:2.16});
  const converging=trafficFollowPolicy({...common,plannedLateralM:1.88});
  expect(parallel.parallelEscape).toBeTruthy();
  expect(parallel.shouldCap).toBeFalsy();
  expect(converging.parallelEscape).toBeFalsy();
  expect(converging.shouldCap).toBeTruthy();
});

test('runtime does not cap a faster car that is already safely parallel on a straight',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__;
    for(let i=0;i<500;i++){if(R.flag==='GREEN'&&R.sessionPhase==='RACE'&&R.race.t>12)break;R.update(.05);}
    let straight=400,best=Infinity;
    for(let s=250;s<(W.total||5800)-500;s+=25){
      let score=0;for(let d=0;d<=80;d+=20)score=Math.max(score,Number(W.braking?.(s+d))||0);
      if(!W.inPitWindow?.(s)&&score<best){best=score;straight=s;}
    }
    const active=R.cars.filter(c=>!c.retired),fast=active[0],slow=active[1];
    for(let i=2;i<active.length;i++){active[i].retired=true;if(active[i].mesh)active[i].mesh.visible=false;}
    const reset=c=>Object.assign(c,{pitState:'NONE',_runtimePitPhase:'TRACK',spinState:'NONE',offTrack:false,hazardAvoiding:false,localYellow:false,hydroplaning:false,incident:0,damage:0,damageState:'NONE',fault:null,wear:0,avoid:0,blueFlag:false,coolingMode:false,predictiveSpeedCap:null,multiclassPassIntent:false,multiclassPassTargetId:null,multiclassPassLane:null,racecraftBlocked:false});
    reset(fast);reset(slow);fast.type='formula';slow.type='touring';
    fast.s=straight;slow.s=straight+1.0;fast.v=78;slow.v=69;fast.lane=-1.03;slow.lane=1.03;fast.laneTarget=-1.08;slow.laneTarget=1.08;fast.lateralVelocity=-.05;slow.lateralVelocity=.05;
    for(const c of[fast,slow]){const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);c.mesh.visible=true;}
    const before=R.collisionAvoidance?.parallelPassFrames||0,speedBefore=fast.v;R.update(.016);
    return{best,cap:fast.predictiveSpeedCap,safetyCap:fast.racingSafetyCap,frames:(R.collisionAvoidance?.parallelPassFrames||0)-before,risk:fast.projectedSideBySideRisk||null,speedBefore,speedAfter:fast.v,brake:fast.racingBrake||0,mode:fast.racingMode||'',target:fast.racingSpeedTarget??null,traffic:fast.racingTrafficPolicy||null};
  });
  expect(result.best,JSON.stringify(result)).toBeLessThan(.25);
  expect(result.frames,JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.risk?.parallelClear,JSON.stringify(result)).toBeTruthy();
  expect(result.cap,JSON.stringify(result)).toBeNull();
  expect(result.safetyCap,JSON.stringify(result)).toBeNull();
  expect(result.traffic?.parallelEscape,JSON.stringify(result)).toBeTruthy();
  expect(result.traffic?.shouldCap,JSON.stringify(result)).toBeFalsy();
  expect(result.brake,JSON.stringify(result)).toBeLessThan(.08);
  expect(result.mode,JSON.stringify(result)).not.toBe('BRAKE');
  expect(result.speedAfter,JSON.stringify(result)).toBeGreaterThan(result.speedBefore-.08);
});
