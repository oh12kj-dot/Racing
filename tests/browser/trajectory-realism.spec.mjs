import {test,expect} from '@playwright/test';
import {createTrajectoryController} from '../../iphone-demo/runtime/trajectory-controller.js';
import {createPitStateMachine,pitStopCaptureWindow} from '../../iphone-demo/runtime/pit-state.js';

function pos(x=0,z=0){return{x,y:0,z,copy(p){this.x=Number(p.x)||0;this.y=Number(p.y)||0;this.z=Number(p.z)||0;return this;}};}
function mesh(){return{position:pos(),rotation:{y:0},visible:true};}
function world(){return{total:1000,racingLineFor:()=>0,racingLineAt:()=>0,inPitWindow:()=>false,sample:(s,lane)=>({p:{x:Number(lane)||0,y:0,z:Number(s)||0},t:{x:0,z:1}})};}
function car(id=0,overrides={}){return{id,type:'gt',length:5,width:2,s:100,lane:0,laneTarget:0,v:30,lap:0,pitState:'NONE',spinState:'NONE',retired:false,driver:{racecraft:.86,aggression:.65},mesh:mesh(),...overrides};}
function race(cars,{t=20,green=4,flag='GREEN',sessionPhase='RACE'}={}){return{cars,race:{t,green},flag,sessionPhase,events:[],physicalCrashHistory:[]};}
function pitWorld(){return{...world(),inPitWindow:()=>true,inPitSpeedZone:()=>true,pitSpeedLimit:22.22,pitBoxS:()=>100,pitDistanceToBox:s=>100-Number(s||0),pitPose:s=>({p:{x:0,y:0,z:Number(s)||0},rotationY:0}),pitWorkingPose:s=>({p:{x:0,y:0,z:Number(s)||0},rotationY:0})};}

test('trajectory controller turns lane requests into bounded progressive steering',()=>{
  const W=world(),c=car(0,{laneTarget:2,battleState:'ATTACK'}),R=race([c]),T=createTrajectoryController(W,R);
  for(let i=0;i<90;i++){const snap=T.capture();c.s+=c.v*.016;R.race.t+=.016;T.update(.016,snap);}
  expect(c.lane).toBeGreaterThan(.25);expect(c.lane).toBeLessThanOrEqual(2.05);
  expect(Number.isFinite(c.steeringAngle)).toBeTruthy();expect(Math.abs(c.steeringAngle)).toBeLessThanOrEqual(.431);
  expect(Number.isFinite(c.lateralAcceleration)).toBeTruthy();expect(Math.abs(c.lateralAcceleration)).toBeLessThanOrEqual(1.95*9.81+.01);
  expect(Number.isFinite(c.yawError)).toBeTruthy();expect(Math.abs(c.yawError)).toBeLessThan(.5);
  expect(T.diagnostics().snapshotAllocations).toBe(1);
});

test('pre-green and formation control remain authoritative',()=>{
  const W=world(),c=car(0,{lane:2.5,laneTarget:0}),R=race([c],{t:1,green:4,sessionPhase:'FORMATION'}),T=createTrajectoryController(W,R),before=c.lane;
  for(let i=0;i<20;i++){const snap=T.capture();T.update(.016,snap);}
  expect(c.lane).toBe(before);expect(c.lateralVelocity).toBe(0);expect(c.steeringAngle).toBe(0);expect(c.trajectorySource).toBe('SESSION_CONTROL');
});

test('pit exit merge starts from the runtime merge offset instead of stale pit lane state',()=>{
  const W=world(),c=car(0,{lane:4,laneTarget:4,pitState:'EXIT',_runtimePitPhase:'FAST_LANE_EXIT',v:12}),R=race([c]),T=createTrajectoryController(W,R);
  const snap=T.capture();c.pitState='NONE';c._runtimePitPhase='MERGE';c.lane=3.2;c.laneTarget=0;c.s+=.2;R.race.t+=.016;T.update(.016,snap);
  expect(c.trajectorySource).toBe('PIT_MERGE');expect(c.lane).toBeGreaterThan(3.0);expect(c.lane).toBeLessThan(3.3);
});

test('pit stop service capture only engages within a sub-quarter-meter stopping window',()=>{
  expect(pitStopCaptureWindow(.7,.016)).toBeLessThanOrEqual(.22);expect(pitStopCaptureWindow(20,.05)).toBe(.22);
  const W=pitWorld(),c=car(0,{teamId:0,s:99.45,v:.7,pitState:'ENTRY',_runtimePitPhase:'WORKING_APPROACH'}),R={cars:[c],events:[]},P=createPitStateMachine(W,R);
  let snap=P.beforeUpdate();c.s=99.47;P.afterUpdate(.016,snap,0);expect(c.pitState).toBe('ENTRY');
  c.s=99.90;c.v=.7;snap=P.beforeUpdate();c.s=99.92;P.afterUpdate(.016,snap,0);
  expect(c.pitState).toBe('STOP');expect(c._runtimePitStopCaptureDistance).toBeLessThanOrEqual(.22);expect(P.metrics.maxServiceCaptureMeters).toBeLessThanOrEqual(.22);
});

test('legacy STOP cannot bypass the bounded pit service capture window',()=>{
  const W=pitWorld(),c=car(0,{teamId:0,s:99.45,v:.7,pitState:'ENTRY',_runtimePitPhase:'WORKING_APPROACH'}),R={cars:[c],events:[]},P=createPitStateMachine(W,R);
  let snap=P.beforeUpdate();c.s=99.50;c.pitState='STOP';c.pitTimer=4.1;P.afterUpdate(.016,snap,0);
  expect(c.pitState).toBe('ENTRY');expect(P.metrics.legacyStopsRejected).toBe(1);
  c.s=99.90;c.v=.7;c.pitState='ENTRY';c._runtimePitPhase='WORKING_APPROACH';snap=P.beforeUpdate();c.s=99.93;c.pitState='STOP';c.pitTimer=4.1;P.afterUpdate(.016,snap,0);
  expect(c.pitState).toBe('STOP');expect(c._runtimePitStopCaptureDistance).toBeLessThanOrEqual(.22);expect(P.metrics.services).toBe(1);
});

test('fallback OBB contact audit latches one continuous overlap',()=>{
  const W=world(),a=car(0,{s:100,lane:0,v:20}),b=car(1,{s:100.2,lane:.2,v:19}),R=race([a,b]),T=createTrajectoryController(W,R);
  for(let i=0;i<12;i++){const snap=T.capture();R.race.t+=.016;T.update(.016,snap);}
  const contacts=R.events.filter(e=>e.type==='CONTACT'&&e.data?.trajectoryAudit);expect(contacts).toHaveLength(1);expect(T.diagnostics().contactLatches).toBe(1);
  b.s=120;b.mesh.position.z=120;const snap=T.capture();R.race.t+=.016;T.update(.016,snap);expect(T.diagnostics().contactLatches).toBe(0);
});

test('wet racing line stays continuous instead of alternating across straights',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_WORLD__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,status=document.querySelector('#status')?.textContent||'',error=document.querySelector('#error')?.textContent||'';
    if(!W?.racingLineFor)return{supported:false,status,error};
    const d=W.multiCornerLineDiagnostics||{},count=Math.max(1,Number(d.count)||1200),step=(Number(d.step)||((W.total||1)/count));
    let maxJump=0,maxStraightJump=0,largeStraightJumps=0;
    for(let i=0;i<count;i++){
      const s=i*step,next=(i+1)*step,a=Number(W.racingLineFor(s,'WET'))||0,b=Number(W.racingLineFor(next,'WET'))||0,jump=Math.abs(b-a),k=Math.abs(Number(W.racingCurvatureAt?.(s))||0);
      maxJump=Math.max(maxJump,jump);if(k<.0011){maxStraightJump=Math.max(maxStraightJump,jump);if(jump>.36)largeStraightJumps++;}
    }
    return{supported:true,status,error,maxJump,maxStraightJump,largeStraightJumps,allowed:Number(d.wetContinuityDelta)||null,owner:d.owner||''};
  });
  expect(result.status,result.error||JSON.stringify(result)).not.toBe('ERROR');expect(result.supported).toBeTruthy();
  expect(result.owner).toBe('runtime-multi-corner-line-v2');expect(result.largeStraightJumps,JSON.stringify(result)).toBe(0);
  expect(result.maxStraightJump,JSON.stringify(result)).toBeLessThan(.31);expect(result.maxJump,JSON.stringify(result)).toBeLessThan(.31);
});
