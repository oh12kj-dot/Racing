import {buildEntrants,FIXED_DT,RACE_LAPS} from '../config.js';
import {createTrack} from './track.js';
import {createVehicleState,stepVehicle,cornerSpeedLimit,steerForLateralAccel} from './vehicle.js';
import {planRacecraft} from './racecraft.js';
import {maybeRequestPit,planPit} from './pit.js';
import {createRng} from './random.js';
import {stepSystems} from './systems.js';
import {updateTiming} from './timing.js';
import {createRaceControl} from './race-control.js';
import {computeTrafficAero} from './traffic-aero.js';
import {evaluatePitStrategy} from './strategy.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function speedEnvelope(car,track){
  let limit=car.spec.top;
  const grip=(car.systems?.grip??1);
  const aeroFactor=car.aeroTraffic?.downforceFactor??1;
  const look=[0,18,36,58,82,110];
  for(const d of look){
    const k=track.curvature(car.s+d);
    const vc=cornerSpeedLimit(car.spec,k,grip,aeroFactor);
    const braking=Math.max(5,car.spec.brake*.76*Math.max(.78,grip));
    const allowed=Math.sqrt(Math.max(vc*vc,vc*vc+2*braking*d));
    limit=Math.min(limit,allowed);
  }
  const skillFactor=.965+(car.skill-.78)*.18;
  const consistency=.997+Math.sin((car.totalProgress+car.id*91)*.008)*(1-car.consistency)*.05;
  return Math.min(car.spec.top,limit*skillFactor*consistency);
}
function controlFor(car,targetSpeed,targetLane){
  const speedError=targetSpeed-car.v;
  let throttle=0,brake=0;
  if(speedError>1.2)throttle=clamp(speedError/12,0,1);
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
  const track=createTrack(),rng=createRng(seed),raceControl=createRaceControl();
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
        let d=b.s-a.s;
        if(d>track.total*.5)d-=track.total;if(d<-track.total*.5)d+=track.total;
        const long=Math.abs(d),lat=Math.abs(b.lane-a.lane);
        const body=(a.length+b.length)*.48,width=(a.width+b.width)*.49;
        if(long<body&&lat<width){
          const pair=`${a.id}:${b.id}`;activePairs.add(pair);
          if(!contactPairs.has(pair))totalContacts++;
          const dv=Math.abs(a.v-b.v),mean=(a.v+b.v)*.5;
          a.v=Math.max(0,mean+(a.v-mean)*.35);b.v=Math.max(0,mean+(b.v-mean)*.35);
          const dir=(a.lane-b.lane)||((a.id<b.id)?-1:1);
          const impulse=(width-lat)*2.4;
          a.laneV+=Math.sign(dir)*impulse;b.laneV-=Math.sign(dir)*impulse;
          if(dv>7){
            const victim=a.v>b.v?a:b;
            victim.incident.spinTimer=Math.max(victim.incident.spinTimer,1.8+dv*.08);
            victim.incident.damage=clamp(victim.incident.damage+dv*.012,0,1);
            emit('CONTACT',victim,`CONTACT — ${victim.name}`,'CONTACT:'+a.id+':'+b.id+':'+Math.floor(time/2));
          }
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
    raceControl.update(time,cars,track,emit);

    for(const car of cars)car.aeroTraffic=computeTrafficAero(car,cars,track);

    for(const car of cars){
      if(car.retired||car.finished)continue;

      if(time<greenAt+car.reaction){
        car.targetSpeed=0;car.targetLane=car.lane;
        stepVehicle(car,track,{throttle:0,brake:1,steer:0},dt);stepSystems(car,dt);continue;
      }

      car.strategy=evaluatePitStrategy(car,track,raceLaps);
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
        car.incident.spinTimer=Math.max(0,car.incident.spinTimer-dt);
        targetSpeed=Math.min(targetSpeed,Math.max(5,car.v*.70));
        targetLane=clamp(car.lane+Math.sin(time*4.5+car.id)*.55,-6.2,6.2);source='INCIDENT_SPIN';
      }

      if(raceControl.flag==='YELLOW'){
        targetSpeed=Math.min(targetSpeed,raceControl.targetFor(car,cars,track));
        source=source.startsWith('PIT:')?source:'YELLOW_CONTROL';
      }

      car.targetSpeed=Number.isFinite(targetSpeed)?targetSpeed:car.spec.top;car.targetLane=targetLane;car.controlSource=source;
      const control=controlFor(car,car.targetSpeed,car.targetLane);
      if(car.driver.mistakeTimer>0&&car.pit.phase==='TRACK')control.throttle*=1-car.driver.lift;
      stepVehicle(car,track,control,dt);stepSystems(car,dt);updateTiming(car,track,time);

      if(car.incident.damage>.93&&car.v<2){car.retired=true;emit('RETIRE',car,`${car.name} RETIRES`,`RETIRE:${car.id}`);}

      if(car.lap>=raceLaps&&!car.finished&&car.pit.served&&car.pit.phase==='TRACK'){
        car.finished=true;car.finishTime=time;
        if(winnerId==null){winnerId=car.id;raceControl.chequered(time);emit('FINISH',car,`${car.name} WINS`,'FINISH');}
      }
    }

    physicalContacts();raceControl.update(time,cars,track,emit);
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
    const values=[Math.round(time*60),raceControl.flag];
    for(const c of [...cars].sort((a,b)=>a.id-b.id)){
      values.push(c.id,c.lap,Math.round(c.s*1000),Math.round(c.v*1000),Math.round(c.lane*1000),Math.round(c.yaw*1e5),Math.round(c.steer*1e5),c.gear,Math.round(c.systems.fuel*1000),Math.round(c.systems.tyreWear*1e6),c.strategy?.reason??'NONE',c.pit.phase,c.finished?1:0,c.retired?1:0);
    }
    return h.toString(16).padStart(8,'0');
  }

  function snapshot(){
    const order=standings(),lead=order[0],classification=classificationFor(order);
    let fastestLap=null;
    for(const car of cars){
      if(!Number.isFinite(car.timing.bestLap))continue;
      if(fastestLap==null||car.timing.bestLap<fastestLap.time)fastestLap={carId:car.id,time:car.timing.bestLap};
    }
    return{
      session:'RACE',time,greenAt,flag:raceControl.flag,running,finished,winnerId,RACE_LAPS:raceLaps,track,cars,events,
      order,classification,fastestLap,leader:lead,lap:Math.min(raceLaps,Math.max(0,(lead?.lap??-1)+1)),stateHash:stateHash(),
      diagnostics:{
        finite:cars.every(c=>[c.s,c.v,c.lane,c.laneV,c.yaw,c.yawRate,c.steer,c.gear,c.systems.fuel,c.systems.tyreWear].every(Number.isFinite)),
        maxSpeedKph:Math.max(...cars.map(c=>c.v*3.6)),
        pitCars:cars.filter(c=>c.pit.phase!=='TRACK').length,
        contacts:totalContacts,
        barrierContacts:cars.reduce((n,c)=>n+c.diagnostics.barrierContacts,0),
        recoveries:cars.reduce((n,c)=>n+c.diagnostics.recoveries,0),
        maxForceUsage:Math.max(...cars.map(c=>c.diagnostics.maxForceUsage)),
        maxYawRate:Math.max(...cars.map(c=>c.diagnostics.maxYawRate)),
        maxSteerRate:Math.max(...cars.map(c=>c.diagnostics.maxSteerRate)),
        maxWake:Math.max(...cars.map(c=>c.aeroTraffic?.wake||0)),
        blueFlags:cars.filter(c=>c.blueFlag).length
      }
    };
  }

  return{
    track,cars,events,update,snapshot,stateHash,raceControl,
    setRunning(v){running=!!v;},get running(){return running;},reset(){if(typeof location!=='undefined')location.reload();}
  };
}
