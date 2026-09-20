import {createSystems} from './systems.js';
import {createTiming} from './timing.js';

const TAU=Math.PI*2;
const G=9.81;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrapAngle=a=>((a+Math.PI)%TAU+TAU)%TAU-Math.PI;

function interpBand(b,r){
  r=clamp(r,0,1);
  if(r<=.45){const t=r/.45;return b.low+(b.mid-b.low)*t;}
  const t=(r-.45)/.55;return b.mid+(b.high-b.mid)*t;
}
function aeroLoadG(spec,speed,aeroFactor=1){
  return (spec.aeroLoadG70||0)*(speed/Math.max(1,spec.aeroRefSpeed||70))**2*clamp(aeroFactor,.45,1.05);
}
function effectiveTyreMu(spec,grip,aero,loadTransfer=0){
  const transferRatio=clamp(Math.abs(loadTransfer)/.30,0,1);
  const transferPenalty=1-(spec.loadSensitivity??.08)*transferRatio;
  return spec.tyreMu*grip*transferPenalty/(1+.14*aero);
}
export function performanceFactors(car){
  const damage=clamp(car.incident?.damage||0,0,1);
  const failed=!!car.systems?.failed;
  const derate=failed?1:clamp(car.systems?.powerDerate||0,0,.48);
  return{
    aero:clamp(1-damage*.32,.68,1),
    drive:failed?0:clamp((1-damage*.22)*(1-derate),.35,1),
    steering:clamp(1-damage*.28,.65,1),
    top:clamp(1-damage*.10-derate*.10,.78,1),
    drag:1+damage*.22,
    damage,
    derate
  };
}
export function effectiveAeroFactor(car){
  return (car.aeroTraffic?.downforceFactor??1)*performanceFactors(car).aero;
}
export function effectiveTopSpeed(car){return car.spec.top*performanceFactors(car).top;}
export function tyreLateralAccel(spec,speed,grip=1,aeroFactor=1,loadTransfer=0){
  const aero=aeroLoadG(spec,speed,aeroFactor);
  const mu=effectiveTyreMu(spec,grip,aero,loadTransfer);
  return Math.max(1,mu*G*(1+aero));
}
export function tyreLongitudinalAccel(spec,speed,grip=1,aeroFactor=1,loadTransfer=0){
  const aero=aeroLoadG(spec,speed,aeroFactor);
  const mu=effectiveTyreMu(spec,grip,aero,loadTransfer);
  return Math.max(1,mu*G*(1+aero));
}
export function cornerSpeedLimit(spec,curvature,grip=1,aeroFactor=1){
  const k=Math.abs(curvature);
  if(k<1e-5)return spec.top;
  let v=Math.min(spec.top,Math.sqrt(spec.tyreMu*grip*G/k));
  for(let i=0;i<8;i++){
    const a=tyreLateralAccel(spec,v,grip,aeroFactor,0);
    const next=Math.min(spec.top,Math.sqrt(a/k));
    v=v*.45+next*.55;
  }
  return Math.max(4,Math.min(spec.top,v));
}
export function accelerationAt(spec,speed){
  return interpBand(spec.accel,speed/Math.max(1,spec.top));
}
export function steerForLateralAccel(car,desiredAccel){
  const maxSteer=car.spec.maxSteer??.52;
  const speedSq=Math.max(4,car.v*car.v);
  return clamp(Math.atan((desiredAccel*car.spec.wheelbase)/speedSq),-maxSteer,maxSteer);
}
function gearFor(spec,speed){
  const count=Math.max(1,spec.gears||6);
  if(speed<1)return 1;
  return clamp(1+Math.floor(clamp(speed/Math.max(1,spec.top),0,.9999)*count),1,count);
}
export function createVehicleState(entry,s,lap=-1){
  return{
    ...entry,
    length:entry.spec.length,width:entry.spec.width,mass:entry.spec.mass,
    s,lap,
    v:0,
    lane:0,laneV:0,laneA:0,
    yaw:0,yawRate:0,
    gear:1,
    steer:0,throttle:0,brake:1,
    targetSpeed:0,targetLane:0,
    racecraft:{state:'RESET',targetId:null,commitUntil:0,defenseUsed:false},
    pit:{phase:'TRACK',requested:false,served:false,plannedLap:2+(entry.id%3),serviceTimer:0,queue:false,boxS:0,missedCount:0},
    incident:{spinTimer:0,damage:0},
    systems:createSystems(entry.type),
    timing:createTiming(),
    tyre:{slipRatio:0,slipAngle:0,loadTransfer:0,longitudinalAccel:0,forceUsage:0},
    aeroTraffic:{wake:0,dragFactor:1,downforceFactor:1,sourceId:null},
    diagnostics:{barrierContacts:0,recoveries:0,maxForceUsage:0,maxYawRate:0,maxSteerRate:0,maxSlipRatio:0,maxSlipAngle:0,maxLoadTransfer:0,barrierActive:false},
    blueFlag:false,
    retired:false,finished:false,
    lastS:s,
    totalProgress:lap
  };
}
export function stepVehicle(car,track,control,dt){
  const spec=car.spec,performance=performanceFactors(car);
  const topSpeed=spec.top*performance.top;
  car.throttle=clamp(control.throttle||0,0,1);
  car.brake=clamp(control.brake||0,0,1);

  const maxSteer=spec.maxSteer??.52;
  const steerRate=Math.max(.5,(spec.steerRate??3.5)*performance.steering);
  const wantedSteer=clamp(control.steer||0,-maxSteer,maxSteer);
  const priorSteer=car.steer;
  car.steer+=clamp(wantedSteer-car.steer,-steerRate*dt,steerRate*dt);
  car.steer=clamp(car.steer,-maxSteer,maxSteer);
  car.diagnostics.maxSteerRate=Math.max(car.diagnostics.maxSteerRate,Math.abs(car.steer-priorSteer)/Math.max(1e-4,dt));

  const grip=car.systems?.grip??1;
  const aeroFactor=(car.aeroTraffic?.downforceFactor??1)*performance.aero;
  const loadTransfer=car.tyre?.loadTransfer??0;
  const tyreLat=tyreLateralAccel(spec,car.v,grip,aeroFactor,loadTransfer);
  const maxLat=Math.min(spec.laneChangeG*G,tyreLat);
  const speedSq=Math.max(1,car.v*car.v);
  const steeringAccel=speedSq/Math.max(1.5,spec.wheelbase)*Math.tan(car.steer);
  const wantedA=clamp(steeringAccel,-maxLat,maxLat);
  const jerk=maxLat*3.8;
  car.laneA+=clamp(wantedA-car.laneA,-jerk*dt,jerk*dt);
  car.laneA=clamp(car.laneA,-maxLat,maxLat);
  car.laneV=clamp(car.laneV+car.laneA*dt,-5.2,5.2);
  car.lane+=car.laneV*dt;

  const latUse=clamp(Math.abs(car.laneA)/Math.max(1,tyreLat),0,1);
  const ratio=car.v/Math.max(1,topSpeed);
  const fuelFactor=(car.systems?.fuel??1)>0?.99:.10;
  const baseDrive=car.throttle*accelerationAt(spec,car.v)*fuelFactor*performance.drive;
  const baseBrake=car.brake*spec.brake;
  const requestedLong=baseDrive-baseBrake;
  const tyreLong=tyreLongitudinalAccel(spec,car.v,grip,aeroFactor,loadTransfer);
  const ellipseFactor=Math.sqrt(Math.max(0,1-latUse*latUse));
  const longCapacity=tyreLong*ellipseFactor;
  const requestedMagnitude=Math.abs(requestedLong);
  const excess=Math.max(0,requestedMagnitude/Math.max(.5,longCapacity)-1);
  const slipTarget=clamp(.008+Math.max(car.throttle,car.brake)*.030+excess*.11,0,.24);
  const slipRate=slipTarget>car.tyre.slipRatio?3.6:1.8;
  car.tyre.slipRatio+=clamp(slipTarget-car.tyre.slipRatio,-slipRate*dt,slipRate*dt);
  car.tyre.slipRatio=clamp(car.tyre.slipRatio,0,.24);
  const tractionEfficiency=clamp(1-Math.max(0,car.tyre.slipRatio-.10)*.65,.90,1);
  const tyreForce=clamp(requestedLong,-longCapacity,longCapacity)*tractionEfficiency;
  const drag=0.18*ratio*ratio*G*(car.aeroTraffic?.dragFactor??1)*performance.drag;
  const overspeed=car.v>topSpeed?Math.min(10,(car.v-topSpeed)*2.2):0;
  const oldV=car.v;
  const acc=tyreForce-drag-overspeed;
  car.v=Math.max(0,car.v+acc*dt);
  const actualLongAccel=(car.v-oldV)/Math.max(1e-4,dt);
  car.tyre.longitudinalAccel=actualLongAccel;
  const transferTarget=clamp((-actualLongAccel/G)*(spec.cgHeight??.42)/Math.max(1.8,spec.wheelbase),-.30,.30);
  car.tyre.loadTransfer+=clamp(transferTarget-car.tyre.loadTransfer,-1.8*dt,1.8*dt);
  const longUse=clamp(Math.abs(tyreForce)/Math.max(1,tyreLong),0,1);
  const forceUsage=Math.hypot(latUse,longUse);
  car.tyre.forceUsage=forceUsage;
  car.diagnostics.maxForceUsage=Math.max(car.diagnostics.maxForceUsage,forceUsage);
  car.diagnostics.maxSlipRatio=Math.max(car.diagnostics.maxSlipRatio,car.tyre.slipRatio);
  car.diagnostics.maxLoadTransfer=Math.max(car.diagnostics.maxLoadTransfer,Math.abs(car.tyre.loadTransfer));

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

  const trackPose=track.sample(car.s);
  const velocitySlipYaw=Math.atan2(car.laneV,Math.max(4,car.v));
  const nextYaw=wrapAngle(trackPose.heading+velocitySlipYaw);
  car.yawRate=wrapAngle(nextYaw-car.yaw)/Math.max(1e-4,dt);
  car.yaw=nextYaw;
  const baseSteer=Math.atan(track.curvature(car.s)*spec.wheelbase);
  const frontVelocityAngle=Math.atan2(car.laneV+car.yawRate*spec.wheelbase*.5,Math.max(4,car.v));
  const frontSlip=wrapAngle(baseSteer+car.steer-frontVelocityAngle);
  car.tyre.slipAngle+=clamp(frontSlip-car.tyre.slipAngle,-2.8*dt,2.8*dt);
  car.tyre.slipAngle=clamp(car.tyre.slipAngle,-.32,.32);
  car.gear=gearFor(spec,car.v);
  car.diagnostics.maxYawRate=Math.max(car.diagnostics.maxYawRate,Math.abs(car.yawRate));
  car.diagnostics.maxSlipAngle=Math.max(car.diagnostics.maxSlipAngle,Math.abs(car.tyre.slipAngle));
}
