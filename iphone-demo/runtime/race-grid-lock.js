import {createRace as createBaseRace} from './race-realism.js';

const num=v=>Number.isFinite(Number(v))?Number(v):0;

export function resolveStartGateState({sessionPhase='',flag='',raceTime=0,greenTime=NaN,launchComplete=false}={}){
  const phase=String(sessionPhase||'').toUpperCase(),nonRace=phase==='QUALIFYING'||phase==='FORMATION';
  const t=num(raceTime),g=Number(greenTime),timedGreen=!Number.isFinite(g)||g<=0||t>=g;
  const canLaunch=!nonRace&&String(flag||'').toUpperCase()==='GREEN'&&timedGreen;
  const preStart=!launchComplete&&!nonRace&&!canLaunch;
  return{phase,nonRace,preStart,canLaunch,raceTime:t,greenTime:Number.isFinite(g)?g:null};
}

export function getDisplaySpeedKmh(car,preStart=false){
  if(!car||preStart)return 0;
  const kmh=Math.max(0,num(car.v)*3.6);
  return kmh<.45?0:kmh;
}

export function createRace(W,statusEl,settings={}){
  const R=createBaseRace(W,statusEl,settings),baseUpdate=R.update,total=W.total;
  const wrap=v=>((v%total)+total)%total;
  let gridSnapshot=null,launchComplete=false,launchAt=null,gridHoldFrames=0;

  function gateState(){return resolveStartGateState({sessionPhase:R.sessionPhase,flag:R.flag,raceTime:R.race?.t||0,greenTime:R.race?.green,launchComplete});}
  function pose(c){
    const q=W.sample(wrap(c.s),c.lane||0);c.mesh?.position?.copy?.(q.p);if(c.mesh?.position)c.mesh.position.y+=.12;if(c.mesh)c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
  }
  function captureGrid(){
    gridSnapshot=new Map();
    for(const c of R.cars)gridSnapshot.set(c.id,{s:c.s,lane:c.lane,laneTarget:c.laneTarget,lap:c.lap,progress:c._v8Progress,position:c.position,prevPosition:c.prevPosition});
  }
  function holdGrid(){
    if(!gridSnapshot)return;
    for(const c of R.cars){
      const x=gridSnapshot.get(c.id);if(!x)continue;
      c.s=x.s;c.lane=x.lane;c.laneTarget=x.laneTarget;c.lap=x.lap;c._v8Progress=x.progress;c.position=x.position;c.prevPosition=x.prevPosition;
      c.v=0;c.racingThrottle=0;c.brakeVisual=0;c.drsActive=false;c.drsEligible=false;c.hasLaunched=false;c.launchAge=0;
      pose(c);
    }
    gridHoldFrames++;
  }
  function openLaunch(){
    if(launchComplete)return;
    launchComplete=true;launchAt=R.race?.t||0;
    for(const c of R.cars){c.hasLaunched=false;c.launchAge=0;}
  }
  function markLaunches(){
    if(!launchComplete)return;
    const now=R.race?.t||0;
    for(const c of R.cars){
      if(!c.hasLaunched&&Math.max(0,num(c.v)*3.6)>=.8){c.hasLaunched=true;c.launchAt=now;}
      c.launchAge=c.hasLaunched?Math.max(0,now-num(c.launchAt)):0;
    }
  }
  function sanitizeTelemetry(id){
    const fn=Reflect.get(R,'telemetryFor',R);if(typeof fn!=='function')return[];
    const rows=fn.call(R,id);if(!gateState().preStart)return rows;
    return rows.map(x=>({...x,speed:0,throttle:0,gLong:0}));
  }
  function update(dt){
    const before=gateState();
    if(before.preStart&&gridSnapshot)holdGrid();
    if(before.canLaunch&&!launchComplete)openLaunch();
    baseUpdate(dt);
    const after=gateState();
    if(after.preStart){
      // The underlying session controller forms/normalises the grid during its
      // update. Capture only afterwards on the first grid frame so we never
      // freeze the final formation-lap pose by mistake.
      if(!gridSnapshot)captureGrid();
      holdGrid();
    }else{
      if(after.canLaunch&&!launchComplete)openLaunch();
      markLaunches();
    }
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='displaySpeedKmh')return c=>getDisplaySpeedKmh(c,gateState().preStart);
    if(prop==='telemetryFor')return sanitizeTelemetry;
    if(prop==='startGate'){const g=gateState();return{owner:'runtime-grid-lock-v1',...g,launchComplete,launchAt,gridFrozen:!!gridSnapshot,gridHoldFrames,launched:R.cars.filter(c=>c.hasLaunched).length};}
    return Reflect.get(target,prop,target);
  }});
}
