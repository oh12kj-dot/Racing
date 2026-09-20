const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function passed(prev,current,mark){
  if(prev<=current)return prev<mark&&current>=mark;
  return mark>prev||mark<=current;
}
function boxFor(car,track){
  return track.pit.boxStart+(car.teamId%12)*track.pit.boxSpacing;
}
function fastLaneBlocked(car,cars,track){
  for(const o of cars){
    if(o===car||o.retired)continue;
    if(!['FAST_LANE','FAST_LANE_EXIT','PIT_ENTRY'].includes(o.pit.phase))continue;
    let d=o.s-car.s;
    if(d>track.total*.5)d-=track.total;
    if(d<-track.total*.5)d+=track.total;
    if(d<0){
      const closing=Math.max(.1,o.v-car.v);
      if(-d<28||(-d)/closing<1.8)return true;
    }else if(d<10)return true;
  }
  return false;
}
function sameTeamService(car,cars){
  return cars.find(o=>o!==car&&o.teamId===car.teamId&&o.pit.phase==='SERVICE');
}
function brakeEnvelope(car,dist,target){
  const a=Math.max(4,car.spec.brake*.72);
  return Math.sqrt(Math.max(target*target,target*target+2*a*Math.max(0,dist)));
}
export function maybeRequestPit(car,track,emit){
  if(car.pit.served||car.pit.requested||car.lap<car.pit.plannedLap)return;
  const d=track.forwardDistance(car.s,track.pit.entryStart);
  if(d<520){
    car.pit.requested=true;
    car.pit.phase='PIT_APPROACH';
    emit?.('PIT_CALL',car,`BOX THIS LAP — ${car.name}`);
  }
}
export function planPit(car,cars,track,dt,emit){
  const p=car.pit,t=track.pit;
  p.boxS=p.boxS||boxFor(car,track);
  let lane=track.idealLane(car.s),speed=Infinity,reason=p.phase;

  if(p.phase==='TRACK')return null;

  if(p.phase==='PIT_APPROACH'){
    const d=track.forwardDistance(car.s,t.entryStart);
    const blend=clamp(1-d/360,0,1);
    lane=car.lane+(t.approachLane-car.lane)*clamp(blend*dt*2.4,0,1);
    const toLine=track.forwardDistance(car.s,t.speedLine);
    speed=brakeEnvelope(car,toLine,t.speedLimit);
    if(passed(car.lastS,car.s,t.entryStart))p.phase='PIT_ENTRY';
  }

  if(p.phase==='PIT_ENTRY'){
    const span=Math.max(1,t.speedLine-t.entryStart);
    const u=clamp((car.s-t.entryStart)/span,0,1);
    lane=t.approachLane+(t.fastLane-t.approachLane)*u;
    const d=Math.max(0,t.speedLine-car.s);
    speed=brakeEnvelope(car,d,t.speedLimit);
    if(car.s>=t.speedLine){p.phase='FAST_LANE';emit?.('PIT_ENTRY',car,`${car.name} PIT ENTRY`);}
  }

  if(p.phase==='FAST_LANE'){
    lane=t.fastLane;speed=t.speedLimit;
    const toBox=p.boxS-car.s;
    if(toBox<120&&toBox>-8)p.phase='WORKING_APPROACH';
  }

  if(p.phase==='WORKING_APPROACH'){
    const toBox=p.boxS-car.s;
    const u=clamp(1-toBox/105,0,1);
    lane=t.fastLane+(t.workingLane-t.fastLane)*u;
    speed=Math.min(p.missedCount?6.5:8.5,Math.sqrt(Math.max(0,2*Math.max(4,car.spec.brake*.58)*Math.max(0,toBox))));
    const occupied=sameTeamService(car,cars);
    if(toBox<-2.8){
      p.missedCount=(p.missedCount||0)+1;
      p.phase='FAST_LANE_EXIT';p.queue=false;
      emit?.('PIT_MISSED',car,`${car.name} MISSED THE BOX`);
    }else if(occupied&&toBox<10){
      p.phase='QUEUE';p.queue=true;
    }else if(toBox<1.5&&car.v<1.8){
      p.phase='SERVICE';p.serviceTimer=3.2+(car.id%4)*.35;p.queue=false;
      emit?.('PIT_SERVICE',car,`${car.name} IN THE BOX`);
    }
  }

  if(p.phase==='QUEUE'){
    const queueS=p.boxS-8;
    lane=t.workingLane;
    const d=queueS-car.s;
    speed=Math.sqrt(Math.max(0,2*Math.max(4,car.spec.brake*.38)*Math.max(0,d)));
    if(!sameTeamService(car,cars)){p.phase='WORKING_APPROACH';p.queue=false;}
  }

  if(p.phase==='SERVICE'){
    lane=t.workingLane;speed=0;
    if(car.v<.35)p.serviceTimer=Math.max(0,p.serviceTimer-dt);
    if(p.serviceTimer<=0){
      p.phase=fastLaneBlocked(car,cars,track)?'RELEASE_WAIT':'WORKING_EXIT';
      emit?.('PIT_DONE',car,`${car.name} SERVICE COMPLETE`);
    }
  }

  if(p.phase==='RELEASE_WAIT'){
    lane=t.workingLane;speed=0;
    if(!fastLaneBlocked(car,cars,track))p.phase='WORKING_EXIT';
  }

  if(p.phase==='WORKING_EXIT'){
    const dist=track.forwardDistance(p.boxS,car.s);
    const u=clamp(dist/38,0,1);
    lane=t.workingLane+(t.fastLane-t.workingLane)*u;
    speed=t.speedLimit;
    if(u>=1)p.phase='FAST_LANE_EXIT';
  }

  if(p.phase==='FAST_LANE_EXIT'){
    lane=t.fastLane;speed=t.speedLimit;
    if(car.s>=t.mergeStart)p.phase='MERGE';
  }

  if(p.phase==='MERGE'){
    const u=clamp((car.s-t.mergeStart)/Math.max(1,t.mergeEnd-t.mergeStart),0,1);
    const mergeLane=-2.2+(track.idealLane(car.s)+2.2)*u;
    lane=t.fastLane+(mergeLane-t.fastLane)*u;
    speed=u<.3?t.speedLimit:Infinity;
    if(car.s>=t.mergeEnd){
      p.phase='TRACK';p.requested=false;
      if(p.missedCount){
        emit?.('PIT_RETRY',car,`${car.name} WILL TRY AGAIN NEXT LAP`);
      }else{
        p.served=true;
        emit?.('PIT_EXIT',car,`${car.name} REJOINS`);
      }
    }
  }
  return{targetLane:lane,targetSpeed:speed,reason};
}
