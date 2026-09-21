import {buildEntrants,FIXED_DT,RACE_LAPS} from '../config.js';
import {createTrack} from './track.js';
import {createVehicleState,stepVehicle,cornerSpeedLimit,steerForLateralAccel,tyreLongitudinalAccel,effectiveAeroFactor,effectiveTopSpeed} from './vehicle.js';
import {planRacecraft} from './racecraft.js';
import {maybeRequestPit,planPit} from './pit.js';
import {createRng} from './random.js';
import {stepSystems} from './systems.js';
import {updateTiming} from './timing.js';
import {createRaceControl} from './race-control.js';
import {computeTrafficAero} from './traffic-aero.js';
import {evaluatePitStrategy} from './strategy.js';
import {createEnvironment,stepEnvironment,environmentSnapshot} from './environment.js';
import {contactManifold,resolveContactImpulse} from './contact.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function physicalBrakeCapability(car,speed,grip,aeroFactor){
  const spec=car.spec;
  const unloaded=tyreLongitudinalAccel(spec,speed,grip,aeroFactor,0);
  const requested=Math.min(spec.brake,unloaded);
  const transfer=clamp((requested/9.81)*(spec.cgHeight??.42)/Math.max(1.8,spec.wheelbase),0,.30);
  return Math.min(spec.brake,tyreLongitudinalAccel(spec,speed,grip,aeroFactor,transfer));
}
function speedEnvelope(car,track){
  const effectiveTop=effectiveTopSpeed(car);
  let limit=effectiveTop;
  const grip=car.systems?.grip??1;
  const aeroFactor=effectiveAeroFactor(car);
  const look=[0,18,36,58,82,110];
  for(const d of look){
    const k=track.curvature(car.s+d);
    const vc=Math.min(effectiveTop,cornerSpeedLimit(car.spec,k,grip,aeroFactor));
    const brakeSpeed=clamp((Math.max(car.v,vc)+vc)*.5,vc,effectiveTop);
    const braking=Math.max(5,physicalBrakeCapability(car,brakeSpeed,grip,aeroFactor)*.82);
    const allowed=Math.sqrt(Math.max(vc*vc,vc*vc+2*braking*d));
    limit=Math.min(limit,allowed);
  }
  const skillFactor=.965+(car.skill-.78)*.18;
  const consistency=.997+Math.sin((car.totalProgress+car.id*91)*.008)*(1-car.consistency)*.05;
  return Math.min(effectiveTop,limit*skillFactor*consistency);
}
function controlFor(car,targetSpeed,targetLane){
  const speedError=targetSpeed-car.v;
  let throttle=0,brake=0;
  if(targetSpeed<=.25){
    throttle=0;
    brake=car.v>.05?clamp(.25+car.v/3.5,.25,1):0;
  }else if(speedError>1.2)throttle=clamp(speedError/12,0,1);
  else if(speedError<-.05)brake=clamp(-speedError/3.2,0,1);
  else throttle=clamp((speedError+.5)/2,0,.35);

  const laneError=targetLane-car.lane;
  const maxLat=car.spec.laneChangeG*9.81;
  const desiredLaneV=clamp(laneError*1.5,-4.2,4.2);
  const desiredLatAccel=clamp(laneError*2.4+(desiredLaneV-car.laneV)*2.1,-maxLat,maxLat);
  const steer=steerForLateralAccel(car,desiredLatAccel);
  return{throttle,brake,steer};
}
function fnv1a(values){
  let h=2166136261>>>0;
  for(const v of values){
    const s=String(v);
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  }
  return h.toString(16).padStart(8,'0');
}

export function createRaceSimulation(seed=0x5eed2026,options={}){
  const raceLaps=options.raceLaps??RACE_LAPS;
  const track=createTrack(),rng=createRng(seed),raceControl=createRaceControl(),environment=createEnvironment(options.environment||{});
  const entrants=buildEntrants();
  const cars=entrants.map((e,i)=>{
    const gridOffset=4.1+i*8.2;
    const s=track.wrapS(-gridOffset);
    const c=createVehicleState(e,s,-1);
    c.totalProgress=-gridOffset;
    c.yaw=track.sample(s).heading;
    c.lane=(i%2?1:-1)*(1.25+(Math.floor(i/2)%2)*.55);
    c.targetLane=c.lane;
    c.reaction=.12+rng.range(0,.28);
    c.driver={mistakeTimer:0,mistakeDuration:0,steerBias:0,lift:0};
    c.incident.redRecoveryTimer=0;
    return c;
  });
  const events=[],eventKeys=new Map();
  let time=0,greenAt=3.0,running=true,finished=false,winnerId=null,sequence=0,totalContacts=0,contactPairs=new Set();

  function emit(type,car,text,key=`${type}:${car?.id??'race'}:${Math.floor(time)}`){
    const last=eventKeys.get(key);
    if(last!=null&&time-last<20)return;
    eventKeys.set(key,time);
    events.push({id:++sequence,time,type,carId:car?.id??null,text});
    if(events.length>100)events.shift();
  }

  function physicalContacts(){
    const activePairs=new Set();
    for(let i=0;i<cars.length;i++){
      const a=cars[i];
      if(a.retired||a.finished||a.pit.phase==='SERVICE')continue;
      for(let j=i+1;j<cars.length;j++){
        const b=cars[j];
        if(b.retired||b.finished||b.pit.phase==='SERVICE')continue;
        const contact=contactManifold(a,b,track);
        if(!contact.hit)continue;

        const pair=`${a.id}:${b.id}`;activePairs.add(pair);
        if(!contactPairs.has(pair))totalContacts++;

        const response=resolveContactImpulse(a,b,contact);
        if(!response.applied)continue;

        const deltaA=Math.hypot(response.deltaVA||0,response.deltaLatA||0);
        const deltaB=Math.hypot(response.deltaVB||0,response.deltaLatB||0);
        const damageA=Math.max(0,deltaA-1.5)*.010;
        const damageB=Math.max(0,deltaB-1.5)*.010;
        if(damageA>0)a.incident.damage=clamp(a.incident.damage+damageA,0,1);
        if(damageB>0)b.incident.damage=clamp(b.incident.damage+damageB,0,1);

        // A spin state is a consequence of angular impulse, not an assigned
        // collision result. Door-to-door contact has almost no yaw lever, while
        // an oblique front/rear lateral hit can generate a sustained rotation.
        const yawKickA=Math.abs(response.deltaYawRateA||0);
        const yawKickB=Math.abs(response.deltaYawRateB||0);
        if(yawKickA>.65){
          const duration=clamp(1.4+yawKickA*.85,1.6,4.6);
          a.incident.spinTimer=Math.max(a.incident.spinTimer,duration);
        }
        if(yawKickB>.65){
          const duration=clamp(1.4+yawKickB*.85,1.6,4.6);
          b.incident.spinTimer=Math.max(b.incident.spinTimer,duration);
        }

        const lateralImpact=response.impactSpeed*Math.abs(response.normalLat||0);
        if(response.impactSpeed>5||lateralImpact>3){
          const victim=deltaA>=deltaB?a:b;
          emit('CONTACT',victim,`CONTACT — ${victim.name}`,'CONTACT:'+a.id+':'+b.id+':'+Math.floor(time/2));
        }
      }
    }
    contactPairs=activePairs;
  }

  function maybeDriverMistake(car,dt){
    const d=car.driver;
    if(d.mistakeTimer>0){d.mistakeTimer=Math.max(0,d.mistakeTimer-dt);return;}
    if(raceControl.flag!=='GREEN'||car.pit.phase!=='TRACK'||car.incident.spinTimer>0||car.lap<0)return;
    const k=Math.abs(track.curvature(car.s));
    if(k<.007||car.v<24)return;
    const wear=car.systems.tyreWear;
    const risk=(.0000006+Math.max(0,wear-.25)*.000004+(1-car.consistency)*.000003)*(dt/FIXED_DT);
    if(rng.next()<risk){
      d.mistakeDuration=.55+rng.range(0,.85);
      d.mistakeTimer=d.mistakeDuration;
      d.steerBias=rng.signed()*(.45+rng.range(0,.9));
      d.lift=.12+rng.range(0,.30);
      emit('DRIVER_ERROR',car,`${car.name} RUNS WIDE`,`DRIVER_ERROR:${car.id}:${car.lap}`);
    }
  }

  function update(dt=FIXED_DT){
    if(!running||finished)return;
    time+=dt;
    stepEnvironment(environment,dt);
    raceControl.update(time,cars,track,emit,environment);

    for(const car of cars)car.aeroTraffic=computeTrafficAero(car,cars,track);

    for(const car of cars){
      if(car.retired||car.finished)continue;

      if(time<greenAt+car.reaction){
        car.targetSpeed=0;car.targetLane=car.lane;
        stepVehicle(car,track,{throttle:0,brake:1,steer:0},dt);stepSystems(car,dt,environment);continue;
      }

      car.strategy=evaluatePitStrategy(car,track,raceLaps,environment);
      maybeRequestPit(car,track,(type,c,text)=>emit(type,c,text,`${type}:${c.id}:${c.pit.plannedLap}:${c.strategy.reason}`),car.strategy);
      const pitPlan=planPit(car,cars,track,dt,(type,c,text)=>emit(type,c,text,`${type}:${c.id}:${c.lap}`));

      let targetSpeed=speedEnvelope(car,track),targetLane=track.idealLane(car.s),source='PHYSICS_LINE';
      if(pitPlan){targetSpeed=Math.min(targetSpeed,pitPlan.targetSpeed);targetLane=pitPlan.targetLane;source='PIT:'+car.pit.phase;}
      else{const rc=planRacecraft(car,cars,track,time);targetSpeed=Math.min(targetSpeed,rc.targetSpeed);targetLane=rc.targetLane;source=rc.reason;}

      maybeDriverMistake(car,dt);
      if(car.driver.mistakeTimer>0&&car.pit.phase==='TRACK'){
        const phase=car.driver.mistakeTimer/Math.max(.01,car.driver.mistakeDuration);
        targetLane=clamp(targetLane+car.driver.steerBias*Math.sin(Math.PI*(1-phase)),-6.2,6.2);
        source='DRIVER_ERROR_INPUT';
      }
      if(car.incident.spinTimer>0){
        // Stabilise the current physical corridor; lateral/yaw motion comes from
        // vehicle state and contact impulse rather than a prescribed sine path.
        targetLane=car.lane;
        targetSpeed=Math.min(targetSpeed,Math.max(4,car.v*.62));
        source='INCIDENT_SPIN';
        car.incident.spinTimer=Math.max(0,car.incident.spinTimer-dt);
      }

      if(raceControl.isCaution()){
        targetSpeed=Math.min(targetSpeed,raceControl.targetFor(car,cars,track));
        if(raceControl.flag==='RED'){
          targetLane=car.lane;
          source='RED_CONTROL';
        }else{
          source=source.startsWith('PIT:')?source:`${raceControl.flag}_CONTROL`;
        }
      }
      if(car.systems.failed){
        targetSpeed=0;
        targetLane=car.lane;
        source='MECHANICAL_FAILURE';
      }

      car.targetSpeed=Number.isFinite(targetSpeed)?targetSpeed:effectiveTopSpeed(car);car.targetLane=targetLane;car.controlSource=source;
      const control=controlFor(car,car.targetSpeed,car.targetLane);
      if(car.driver.mistakeTimer>0&&car.pit.phase==='TRACK')control.throttle*=1-car.driver.lift;
      const wasFailed=car.systems.failed;
      stepVehicle(car,track,control,dt);stepSystems(car,dt,environment);updateTiming(car,track,time);
      if(!wasFailed&&car.systems.failed){
        emit('MECHANICAL_FAILURE',car,`${car.name} POWER UNIT FAILURE — ${car.systems.failureReason}`,`FAILURE:${car.id}`);
      }

      if(car.systems.failed&&car.v<1.2){
        car.retired=true;
        emit('RETIRE',car,`${car.name} RETIRES — ${car.systems.failureReason}`,`RETIRE:${car.id}`);
      }else if(car.incident.damage>.93&&car.v<2){
        car.retired=true;
        emit('RETIRE',car,`${car.name} RETIRES`,`RETIRE:${car.id}`);
      }else if(raceControl.fieldControlled(cars)&&raceControl.incidentIds.includes(car.id)&&car.v<1.2){
        car.incident.redRecoveryTimer=(car.incident.redRecoveryTimer||0)+dt;
        if(car.incident.redRecoveryTimer>=6){
          car.retired=true;
          car.diagnostics.recoveries++;
          emit('RECOVERY_RETIRE',car,`${car.name} REMOVED UNDER RED FLAG`,`RED_RECOVERY:${car.id}`);
        }
      }else if(raceControl.flag!=='RED'||!raceControl.fieldControlled(cars)){
        car.incident.redRecoveryTimer=0;
      }

      if(car.lap>=raceLaps&&!car.finished&&car.pit.served&&car.pit.phase==='TRACK'){
        car.finished=true;car.finishTime=time;
        if(winnerId==null){winnerId=car.id;raceControl.chequered(time);emit('FINISH',car,`${car.name} WINS`,'FINISH');}
      }
    }

    physicalContacts();raceControl.update(time,cars,track,emit,environment);
    if(!finished&&winnerId!=null&&cars.filter(c=>!c.finished&&!c.retired).length===0)finished=true;
  }

  function standings(){
    return [...cars].sort((a,b)=>{
      if(a.finished&&b.finished)return a.finishTime-b.finishTime;
      if(a.finished)return -1;if(b.finished)return 1;
      if(a.retired&&b.retired)return b.totalProgress-a.totalProgress;
      if(a.retired)return 1;if(b.retired)return -1;
      return b.totalProgress-a.totalProgress;
    });
  }

  function classificationFor(order){
    const classSeen=new Map(),lead=order[0];
    return order.map((car,index)=>{
      const classPosition=(classSeen.get(car.type)||0)+1;
      classSeen.set(car.type,classPosition);
      const previous=index>0?order[index-1]:null;
      const liveDistanceGap=!car.retired&&!(car.finished&&lead?.finished);
      const liveInterval=!car.retired&&previous&&!previous.retired&&!(car.finished&&previous.finished);
      return{
        carId:car.id,
        overallPosition:index+1,
        classPosition,
        className:car.spec.label,
        completedLaps:Math.max(0,car.lap),
        currentLap:car.lap<0?0:Math.min(raceLaps,car.lap+1),
        status:car.retired?'RETIRED':car.finished?'FINISHED':car.pit.phase==='TRACK'?'RUNNING':'PIT',
        pitStops:car.pit.completedStops||0,
        currentLapTime:car.lap<0||car.timing.lapStart==null?null:Math.max(0,time-car.timing.lapStart),
        lastLap:car.timing.lastLap,
        bestLap:car.timing.bestLap,
        gapToLeaderMeters:index===0?0:(liveDistanceGap?Math.max(0,(lead?.totalProgress??car.totalProgress)-car.totalProgress):null),
        intervalMeters:index===0?0:(liveInterval?Math.max(0,previous.totalProgress-car.totalProgress):null),
        gapToLeaderSeconds:index===0?0:(car.finished&&lead?.finished?Math.max(0,car.finishTime-lead.finishTime):null),
        intervalSeconds:index===0?0:(car.finished&&previous?.finished?Math.max(0,car.finishTime-previous.finishTime):null)
      };
    });
  }

  function stateHash(){
    const values=[
      Math.round(time*60),raceControl.flag,Math.round(raceControl.cautionUntil*60),raceControl.incidentId??-1,
      raceControl.restartPhase,Math.round((raceControl.restartStartedAt||0)*60),[...raceControl.incidentIds].sort((a,b)=>a-b).join(','),
      Math.round(environment.wetness*1e6),Math.round(environment.rainRate*1e6),Math.round(environment.visibility*1e6),Math.round(environment.ambientTemp*100)
    ];
    for(const c of [...cars].sort((a,b)=>a.id-b.id)){
      values.push(
        c.id,c.lap,Math.round(c.s*1000),Math.round(c.v*1000),Math.round(c.lane*1000),Math.round(c.yaw*1e5),Math.round(c.yawRate*1e5),Math.round(c.steer*1e5),c.gear,
        Math.round(c.systems.fuel*1000),Math.round(c.systems.tyreWear*1e6),Math.round(c.systems.tyreTemp*1000),Math.round(c.systems.grip*1e6),c.systems.tyreCompound,
        Math.round(c.systems.mechanicalStress*1e6),Math.round(c.systems.powerDerate*1e6),c.systems.failed?1:0,c.systems.failureReason??'NONE',
        Math.round((c.tyre?.slipRatio??0)*1e6),Math.round((c.tyre?.slipAngle??0)*1e6),Math.round((c.tyre?.loadTransfer??0)*1e6),
        Math.round((c.incident.spinTimer||0)*1000),Math.round((c.incident.redRecoveryTimer||0)*1000),c.strategy?.reason??'NONE',c.pit.phase,c.finished?1:0,c.retired?1:0
      );
    }
    return fnv1a(values);
  }

  function snapshot(){
    const order=standings(),lead=order[0],classification=classificationFor(order),environmentState=environmentSnapshot(environment);
    let fastestLap=null;
    for(const car of cars){
      if(!Number.isFinite(car.timing.bestLap))continue;
      if(fastestLap==null||car.timing.bestLap<fastestLap.time)fastestLap={carId:car.id,time:car.timing.bestLap};
    }
    return{
      session:'RACE',time,greenAt,flag:raceControl.flag,restartPhase:raceControl.restartPhase,running,finished,winnerId,RACE_LAPS:raceLaps,track,cars,events,environment:environmentState,
      order,classification,fastestLap,leader:lead,lap:Math.min(raceLaps,Math.max(0,(lead?.lap??-1)+1)),stateHash:stateHash(),
      diagnostics:{
        finite:cars.every(c=>[
          c.s,c.v,c.lane,c.laneV,c.yaw,c.yawRate,c.steer,c.gear,c.systems.fuel,c.systems.tyreWear,c.systems.tyreTemp,c.systems.grip,
          c.systems.mechanicalStress,c.systems.powerDerate,c.incident.spinTimer||0,c.incident.redRecoveryTimer||0,
          c.tyre?.slipRatio??0,c.tyre?.slipAngle??0,c.tyre?.loadTransfer??0,c.tyre?.longitudinalAccel??0,c.tyre?.forceUsage??0
        ].every(Number.isFinite))&&[environment.wetness,environment.rainRate,environment.visibility,environment.ambientTemp].every(Number.isFinite),
        maxSpeedKph:Math.max(...cars.map(c=>c.v*3.6)),
        pitCars:cars.filter(c=>c.pit.phase!=='TRACK').length,
        contacts:totalContacts,
        barrierContacts:cars.reduce((n,c)=>n+c.diagnostics.barrierContacts,0),
        recoveries:cars.reduce((n,c)=>n+c.diagnostics.recoveries,0),
        maxForceUsage:Math.max(...cars.map(c=>c.diagnostics.maxForceUsage)),
        maxYawRate:Math.max(...cars.map(c=>c.diagnostics.maxYawRate)),
        maxSteerRate:Math.max(...cars.map(c=>c.diagnostics.maxSteerRate)),
        maxSlipRatio:Math.max(...cars.map(c=>c.diagnostics.maxSlipRatio||0)),
        maxSlipAngle:Math.max(...cars.map(c=>c.diagnostics.maxSlipAngle||0)),
        maxLoadTransfer:Math.max(...cars.map(c=>c.diagnostics.maxLoadTransfer||0)),
        maxMechanicalStress:Math.max(...cars.map(c=>c.systems.mechanicalStress||0)),
        deratedCars:cars.filter(c=>c.systems.powerDerate>.01&&!c.systems.failed).length,
        failedCars:cars.filter(c=>c.systems.failed).length,
        wetness:environment.wetness,
        wetTyreCars:cars.filter(c=>c.systems.tyreCompound==='WET').length,
        redFlag:raceControl.flag==='RED',
        restartPhase:raceControl.restartPhase,
        maxWake:Math.max(...cars.map(c=>c.aeroTraffic?.wake||0)),
        blueFlags:cars.filter(c=>c.blueFlag).length
      }
    };
  }

  return{
    track,cars,events,environment,update,snapshot,stateHash,raceControl,
    setRunning(v){running=!!v;},get running(){return running;},reset(){if(typeof location!=='undefined')location.reload();}
  };
}
