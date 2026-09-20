import {buildEntrants,FIXED_DT,RACE_LAPS} from '../config.js';
import {createTrack} from './track.js';
import {createVehicleState,stepVehicle,cornerSpeedLimit} from './vehicle.js';
import {planRacecraft} from './racecraft.js';
import {maybeRequestPit,planPit} from './pit.js';
import {createRng} from './random.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function speedEnvelope(car,track){
  let limit=car.spec.top;
  const look=[0,18,36,58,82,110];
  for(const d of look){
    const k=track.curvature(car.s+d);
    const vc=cornerSpeedLimit(car.spec,k,1-Math.min(.08,car.incident.damage*.08));
    const braking=Math.max(5,car.spec.brake*.76);
    const allowed=Math.sqrt(Math.max(vc*vc,vc*vc+2*braking*d));
    limit=Math.min(limit,allowed);
  }
  return limit;
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
  const laneAccel=clamp(laneError*2.4+(desiredLaneV-car.laneV)*2.1,-maxLat,maxLat);
  return{throttle,brake,laneAccel};
}

export function createRaceSimulation(seed=0x5eed2026){
  const track=createTrack(),rng=createRng(seed);
  const entrants=buildEntrants();
  const cars=entrants.map((e,i)=>{
    const s=track.wrapS(-i*8.2);
    const c=createVehicleState(e,s,-1);
    c.lane=(i%2?1:-1)*(1.25+(Math.floor(i/2)%2)*.55);
    c.targetLane=c.lane;
    c.reaction=.12+rng.range(0,.28);
    return c;
  });
  const events=[],eventKeys=new Map();
  let time=0,greenAt=3.0,flag='GREEN',running=true,finished=false,winnerId=null;
  let sequence=0;

  function emit(type,car,text,key=`${type}:${car?.id??'race'}:${Math.floor(time)}`){
    const last=eventKeys.get(key);
    if(last!=null&&time-last<20)return;
    eventKeys.set(key,time);
    events.push({id:++sequence,time,type,carId:car?.id??null,text});
    if(events.length>80)events.shift();
  }

  function physicalContacts(){
    for(let i=0;i<cars.length;i++){
      const a=cars[i];
      if(a.retired||a.pit.phase==='SERVICE')continue;
      for(let j=i+1;j<cars.length;j++){
        const b=cars[j];
        if(b.retired||b.pit.phase==='SERVICE')continue;
        let d=b.s-a.s;
        if(d>track.total*.5)d-=track.total;
        if(d<-track.total*.5)d+=track.total;
        const long=Math.abs(d),lat=Math.abs(b.lane-a.lane);
        const body=(a.length+b.length)*.48;
        const width=(a.width+b.width)*.49;
        if(long<body&&lat<width){
          const dv=Math.abs(a.v-b.v);
          const mean=(a.v+b.v)*.5;
          a.v=Math.max(0,mean+(a.v-mean)*.35);
          b.v=Math.max(0,mean+(b.v-mean)*.35);
          const dir=(a.lane-b.lane)||((a.id<b.id)?-1:1);
          const impulse=(width-lat)*2.4;
          a.laneV+=Math.sign(dir)*impulse;
          b.laneV-=Math.sign(dir)*impulse;
          if(dv>7){
            const victim=a.v>b.v?a:b;
            victim.incident.spinTimer=Math.max(victim.incident.spinTimer,1.8+dv*.08);
            victim.incident.damage=clamp(victim.incident.damage+dv*.012,0,1);
            emit('CONTACT',victim,`CONTACT — ${victim.name}`,'CONTACT:'+a.id+':'+b.id+':'+Math.floor(time/2));
          }
        }
      }
    }
  }

  function update(dt=FIXED_DT){
    if(!running)return;
    time+=dt;

    for(const car of cars){
      if(car.retired||car.finished)continue;

      if(time<greenAt+car.reaction){
        car.targetSpeed=0;
        car.targetLane=car.lane;
        stepVehicle(car,track,{throttle:0,brake:1,laneAccel:0},dt);
        continue;
      }

      maybeRequestPit(car,track,(type,c,text)=>emit(type,c,text,`${type}:${c.id}:${c.pit.plannedLap}`));
      const pitPlan=planPit(car,cars,track,dt,(type,c,text)=>emit(type,c,text,`${type}:${c.id}:${c.lap}`));

      let targetSpeed=speedEnvelope(car,track);
      let targetLane=track.idealLane(car.s);
      let source='PHYSICS_LINE';

      if(pitPlan){
        targetSpeed=Math.min(targetSpeed,pitPlan.targetSpeed);
        targetLane=pitPlan.targetLane;
        source='PIT:'+car.pit.phase;
      }else{
        const rc=planRacecraft(car,cars,track,time);
        targetSpeed=Math.min(targetSpeed,rc.targetSpeed);
        targetLane=rc.targetLane;
        source=rc.reason;
      }

      if(car.incident.spinTimer>0){
        car.incident.spinTimer=Math.max(0,car.incident.spinTimer-dt);
        targetSpeed=Math.min(targetSpeed,Math.max(7,car.v*.72));
        targetLane=clamp(car.lane+Math.sin(time*5+car.id)*.7,-6.3,6.3);
        source='INCIDENT_SPIN';
      }

      if(flag!=='GREEN')targetSpeed=Math.min(targetSpeed,32);
      car.targetSpeed=Number.isFinite(targetSpeed)?targetSpeed:car.spec.top;
      car.targetLane=targetLane;
      car.controlSource=source;

      const control=controlFor(car,car.targetSpeed,car.targetLane);
      stepVehicle(car,track,control,dt);

      if(car.lap>=RACE_LAPS-1&&!car.finished){
        car.finished=true;
        car.finishTime=time;
        if(winnerId==null){winnerId=car.id;flag='CHEQUERED';emit('FINISH',car,`${car.name} WINS`,'FINISH');}
      }
    }

    physicalContacts();

    if(!finished&&winnerId!=null&&cars.filter(c=>!c.finished&&!c.retired).length===0){
      finished=true;
    }
  }

  function standings(){
    return [...cars].sort((a,b)=>{
      if(a.finished&&b.finished)return a.finishTime-b.finishTime;
      if(a.finished)return -1;if(b.finished)return 1;
      return b.totalProgress-a.totalProgress;
    });
  }

  function snapshot(){
    const order=standings();
    const lead=order[0];
    return{
      time,greenAt,flag,running,finished,winnerId,RACE_LAPS,track,cars,events,
      order,
      leader:lead,
      lap:Math.max(0,lead?.lap??0),
      diagnostics:{
        finite:cars.every(c=>[c.s,c.v,c.lane,c.laneV].every(Number.isFinite)),
        maxSpeedKph:Math.max(...cars.map(c=>c.v*3.6)),
        pitCars:cars.filter(c=>c.pit.phase!=='TRACK').length,
        contactEvents:events.filter(e=>e.type==='CONTACT').length
      }
    };
  }

  return{
    track,cars,events,update,snapshot,
    setRunning(v){running=!!v;},
    get running(){return running;},
    reset(){location.reload();}
  };
}
