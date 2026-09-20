import {createSystems} from './systems.js';
import {createTiming} from './timing.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function interpBand(b,r){
  r=clamp(r,0,1);
  if(r<=.45){const t=r/.45;return b.low+(b.mid-b.low)*t;}
  const t=(r-.45)/.55;return b.mid+(b.high-b.mid)*t;
}
export function tyreLateralAccel(spec,speed,grip=1){
  const aero=(spec.aeroLoadG70||0)*(speed/Math.max(1,spec.aeroRefSpeed||70))**2;
  const mu=spec.tyreMu*grip/(1+.14*aero);
  return Math.max(1,mu*9.81*(1+aero));
}
export function cornerSpeedLimit(spec,curvature,grip=1){
  const k=Math.abs(curvature);
  if(k<1e-5)return spec.top;
  let v=Math.min(spec.top,Math.sqrt(spec.tyreMu*grip*9.81/k));
  for(let i=0;i<8;i++){
    const a=tyreLateralAccel(spec,v,grip);
    const next=Math.min(spec.top,Math.sqrt(a/k));
    v=v*.45+next*.55;
  }
  return Math.max(4,Math.min(spec.top,v));
}
export function accelerationAt(spec,speed){
  return interpBand(spec.accel,speed/Math.max(1,spec.top));
}
export function createVehicleState(entry,s,lap=-1){
  return{
    ...entry,
    length:entry.spec.length,width:entry.spec.width,mass:entry.spec.mass,
    s,lap,
    v:0,
    lane:0,laneV:0,laneA:0,
    steer:0,throttle:0,brake:1,
    targetSpeed:0,targetLane:0,
    racecraft:{state:'RESET',targetId:null,commitUntil:0,defenseUsed:false},
    pit:{phase:'TRACK',requested:false,served:false,plannedLap:2+(entry.id%3),serviceTimer:0,queue:false,boxS:0,missedCount:0},
    incident:{spinTimer:0,damage:0},
    systems:createSystems(entry.type),
    timing:createTiming(),
    diagnostics:{barrierContacts:0,recoveries:0,maxForceUsage:0,barrierActive:false},
    blueFlag:false,
    retired:false,finished:false,
    lastS:s,
    totalProgress:lap
  };
}
export function stepVehicle(car,track,control,dt){
  const spec=car.spec;
  car.throttle=clamp(control.throttle||0,0,1);
  car.brake=clamp(control.brake||0,0,1);

  const grip=car.systems?.grip??1;
  const tyreLat=tyreLateralAccel(spec,car.v,grip);
  const maxLat=Math.min(spec.laneChangeG*9.81,tyreLat);
  const wantedA=clamp(control.laneAccel||0,-maxLat,maxLat);
  const jerk=maxLat*3.8;
  car.laneA+=clamp(wantedA-car.laneA,-jerk*dt,jerk*dt);
  car.laneA=clamp(car.laneA,-maxLat,maxLat);
  car.laneV=clamp(car.laneV+car.laneA*dt,-5.2,5.2);
  car.lane+=car.laneV*dt;

  const latUse=clamp(Math.abs(car.laneA)/Math.max(1,tyreLat),0,1);
  const longFactor=Math.sqrt(Math.max(0,1-latUse*latUse));
  const ratio=car.v/Math.max(1,spec.top);
  const fuelFactor=(car.systems?.fuel??1)>0?.99:.10;
  const baseDrive=car.throttle*accelerationAt(spec,car.v)*fuelFactor;
  const baseBrake=car.brake*spec.brake;
  const drive=baseDrive*longFactor;
  const brake=baseBrake*longFactor;
  const drag=0.18*ratio*ratio*9.81;
  const overspeed=car.v>spec.top?Math.min(10,(car.v-spec.top)*2.2):0;
  const acc=drive-brake-drag-overspeed;
  car.v=Math.max(0,car.v+acc*dt);
  const tireLong=Math.max(car.throttle,car.brake)*longFactor;
  car.diagnostics.maxForceUsage=Math.max(car.diagnostics.maxForceUsage,Math.hypot(latUse,tireLong));

  const normalTrack=car.pit.phase==='TRACK'||car.pit.phase==='PIT_APPROACH';
  const q=track.sample(car.s);
  const maxLane=normalTrack?q.halfWidth-car.width*.52:15.2;
  const penetration=Math.abs(car.lane)-maxLane;
  if(penetration>0){
    const sign=Math.sign(car.lane)||1;
    car.lane=sign*maxLane;
    car.laneV=-sign*Math.abs(car.laneV)*.28;
    car.laneA=-sign*Math.abs(car.laneA)*.25;
    car.v*=Math.max(.72,1-Math.min(.22,penetration*.045));
    car.incident.damage=clamp(car.incident.damage+Math.min(.025,penetration*.003),0,1);
    if(!car.diagnostics.barrierActive)car.diagnostics.barrierContacts++;
    car.diagnostics.barrierActive=true;
    if(penetration>3)car.diagnostics.recoveries++;
  }else{
    car.diagnostics.barrierActive=false;
  }

  car.lastS=car.s;
  car.s=track.wrapS(car.s+car.v*dt);
  if(car.lastS>track.total*.85&&car.s<track.total*.15)car.lap++;
  car.totalProgress=car.lap*track.total+car.s;

  const yaw=Math.atan2(car.laneV,Math.max(4,car.v));
  car.steer=clamp(Math.atan2(spec.wheelbase*Math.tan(yaw),Math.max(2,car.v*.12)),-.52,.52);
}
