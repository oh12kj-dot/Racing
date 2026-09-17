import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {CIRCUIT_PIT_PROFILES,RACING_LANE_PROFILES,resolveCircuitPitProfile,resolveRacingLaneProfile} from '../../iphone-demo/runtime/config.js';
import {createPitStateMachine} from '../../iphone-demo/runtime/pit-state.js';

function makeWorld(overrides={}){
  const total=1000;
  return{
    total,circuitName:'TEST',pitExitEndUF:1.05,pitSpeedLimit:22.22,pitMergeTrackOffset:5.5,
    inPitWindow:s=>s>=900,inPitSpeedZone:()=>false,pitOffsetAtS:()=>0,
    pitUnwrappedFraction:s=>Number(s)/total,pitBoxS:()=>950,pitDistanceToBox:s=>950-Number(s),
    ...overrides
  };
}
function makeCar(overrides={}){
  return{id:0,teamId:0,s:850,v:20,lane:0,laneTarget:0,pitState:'NONE',pitTimer:0,retired:false,type:'gt',...overrides};
}

test('each supported circuit owns an independent pit and racing-lane profile',()=>{
  const ids=['SUZUKA','FUJI_STYLE','MONZA_STYLE','SPA_STYLE'];
  for(const id of ids){expect(resolveCircuitPitProfile(id)).toBe(CIRCUIT_PIT_PROFILES[id]);expect(resolveRacingLaneProfile(id)).toBe(RACING_LANE_PROFILES[id]);}
  expect(new Set(ids.map(id=>resolveCircuitPitProfile(id).entryUF)).size).toBe(ids.length);
  expect(new Set(ids.map(id=>resolveCircuitPitProfile(id).exitEndUF)).size).toBe(ids.length);
  expect(new Set(ids.map(id=>resolveRacingLaneProfile(id).base)).size).toBe(ids.length);
});

test('an early pit request stays on track until the real pit-entry window opens',()=>{
  const W=makeWorld(),c=makeCar({pitState:'ENTRY'}),R={cars:[c],events:[]},P=createPitStateMachine(W,R);
  P.beforeUpdate();
  expect(c.pitState).toBe('NONE');expect(c._runtimePitPending).toBeTruthy();expect(c._runtimePitPhase).toBe('PIT_APPROACH');
  c.s=905;P.beforeUpdate();
  expect(c.pitState).toBe('ENTRY');expect(c._runtimePitPending).toBeFalsy();expect(c._runtimePitPhase).toBe('PIT_ENTRY');
  expect(P.diagnostics().metrics.earlyEntriesDeferred).toBe(1);expect(P.diagnostics().metrics.pitEntriesActivated).toBe(1);
});

test('drive-through advances exactly once per update and never enters service STOP',()=>{
  const W=makeWorld({inPitWindow:()=>true,pitUnwrappedFraction:s=>Number(s)/1000}),c=makeCar({s:500,v:10,pitState:'ENTRY',_driveThroughServing:true,_runtimePitPhase:'FAST_LANE'}),R={cars:[c],events:[]},P=createPitStateMachine(W,R);
  const snapshot=P.beforeUpdate(),before=c.s;P.afterUpdate(.1,snapshot,0);
  expect(c.s-before).toBeCloseTo(1,6);expect(c.pitState).toBe('ENTRY');expect(c.pitState).not.toBe('STOP');expect(c.pitTimer).toBe(0);
});

test('pit release safety uses time-to-collision for a fast car arriving from behind',()=>{
  const W=makeWorld({inPitWindow:()=>true,pitUnwrappedFraction:s=>Number(s)/1000}),released=makeCar({id:0,s:500,v:0,pitState:'EXIT',_runtimePitPhase:'RELEASE_WAIT'}),traffic=makeCar({id:1,s:490,v:35,pitState:'ENTRY',_runtimePitPhase:'FAST_LANE'}),R={cars:[released,traffic],events:[]},P=createPitStateMachine(W,R);
  const near=P.fastLaneTraffic(released);expect(near).toHaveLength(1);expect(near[0].car.id).toBe(1);expect(near[0].ttc).toBeLessThan(1.8);
});

test('contact layers no longer erase physical contact outcomes after the fact',()=>{
  const contact=readFileSync(new URL('../../iphone-demo/runtime/race-contact-avoidance.js',import.meta.url),'utf8');
  const side=readFileSync(new URL('../../iphone-demo/runtime/race-side-by-side.js',import.meta.url),'utf8');
  expect(contact).toContain("mode:'predictive-cap-physical-obb-authoritative'");
  expect(contact).not.toContain('suppressedFalseContacts');expect(contact).not.toContain('damage=b.damage');
  expect(side).toContain("contactPolicy:'physical-contact-authoritative'");
  expect(side).not.toContain('puncture=false');expect(side).not.toContain('events.push=function');
});

test('Formula strategy cannot refuel while endurance classes can',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-strategy-dynamics.js',import.meta.url),'utf8');
  const set=source.match(/REFUEL_ALLOWED=new Set\(\[([^\]]+)\]\)/)?.[1]||'';
  expect(set).not.toContain('formula');expect(set).toContain('hyper');expect(set).toContain('gt');
  expect(source).toContain("if(!REFUEL_ALLOWED.has(c.type))return s.fuelKg");
});

test('race-control uses VSC delta tracking instead of a universal fixed-speed cap',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-control.js',import.meta.url),'utf8');
  expect(source).toContain('s.allowed+=referenceVscSpeed(c)*dt');expect(source).toContain('s.delta=s.allowed-s.actual');
  expect(source).not.toContain('135/3.6');expect(source).not.toContain('37.5');
});

test('normal green longitudinal control yields to local safety speed authorities',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-base.js',import.meta.url),'utf8');
  const clear=source.match(/const clearState=c=>([^;]+);/)?.[1]||'';
  expect(clear).toContain('!c.localYellow');
  expect(clear).toContain('!c.hydroplaning');
  expect(clear).toContain('!punctured(c)');
  expect(source).toContain("const punctured=c=>c?.fault==='PUNCTURE'");
});

test('predictive collision braking requests a cap that the final longitudinal owner enforces',()=>{
  const contact=readFileSync(new URL('../../iphone-demo/runtime/race-contact-avoidance.js',import.meta.url),'utf8');
  const base=readFileSync(new URL('../../iphone-demo/runtime/race-base.js',import.meta.url),'utf8');
  expect(contact).toContain('c.predictiveSpeedCap=null');
  expect(contact).toContain('requestSpeedCap(c,cap)');
  expect(contact).toContain('requestSpeedCap(c,front.v+');
  expect(contact).not.toContain('c.v=Math.max(target');
  expect(base).toContain('const safetyCap=Number(c.predictiveSpeedCap)');
  expect(base).toContain('if(safetyActive&&c.v>safetyCap)');
  expect(base).toContain('safetyCap:c.racingSafetyCap??null');
});

test('deferred pit strategy does not overwrite racecraft lane intent',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-pit-strategy.js',import.meta.url),'utf8');
  const start=source.indexOf('function defer('),end=source.indexOf('\n  function admit',start),body=source.slice(start,end),writes=body.match(/c\.laneTarget\*=\.82/g)||[];
  expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
  expect(body).toContain("if(W.runtimeRacecraftAuthority!=='runtime-racecraft-v2')c.laneTarget*=.82");
  expect(writes).toHaveLength(1);
});
