const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function signedDelta(track,a,b){
  let d=track.wrapS(b.s)-track.wrapS(a.s);
  if(d>track.total*.5)d-=track.total;
  if(d<-track.total*.5)d+=track.total;
  return d;
}
function safeLat(a,b){return (a.width+b.width)*.5+.45;}
function laneAvailable(car,candidate,cars,track,horizon=1.25){
  if(Math.abs(candidate)>track.sample(car.s).halfWidth-car.width*.55-.35)return false;
  for(const o of cars){
    if(o===car||o.retired||o.pit.phase!=='TRACK')continue;
    const d=signedDelta(track,car,o);
    if(Math.abs(d)>16)continue;
    const futureSelf=candidate+(car.laneV||0)*horizon*.25;
    const futureOther=o.lane+(o.laneV||0)*horizon;
    if(Math.abs(futureSelf-futureOther)<safeLat(car,o)&&Math.abs(d)<(car.length+o.length)*.6+4)return false;
  }
  return true;
}
function fasterAdvantage(a,b){return a.spec.pace>b.spec.pace+.02||a.spec.top>b.spec.top+3;}

export function planRacecraft(car,cars,track,time){
  const ideal=track.idealLane(car.s);
  const state=car.racecraft;
  const nearby=cars.filter(o=>o!==car&&!o.retired&&o.pit.phase==='TRACK').map(o=>({o,d:signedDelta(track,car,o)}));
  const ahead=nearby.filter(x=>x.d>0&&x.d<130).sort((a,b)=>a.d-b.d);
  const behind=nearby.filter(x=>x.d<0&&x.d>-45).sort((a,b)=>b.d-a.d);

  let targetLane=ideal,targetSpeed=Infinity,reason='RACING_LINE';

  const hazard=ahead.find(x=>x.d<85&&(x.o.incident.spinTimer>.2||x.o.v<4));
  if(hazard){
    const left=hazard.o.lane-safeLat(car,hazard.o)-.8;
    const right=hazard.o.lane+safeLat(car,hazard.o)+.8;
    const options=[left,right].filter(l=>laneAvailable(car,l,cars,track,.9));
    if(options.length){
      options.sort((a,b)=>Math.abs(a-car.lane)-Math.abs(b-car.lane));
      targetLane=options[0];
      const closing=Math.max(.1,car.v-hazard.o.v);
      const ttc=Math.max(.1,(hazard.d-(car.length+hazard.o.length)*.5)/closing);
      targetSpeed=ttc<1.2?Math.max(5,hazard.o.v+2):Math.min(targetSpeed,car.v);
      reason='HAZARD_EVADE';
    }else{
      targetSpeed=Math.min(targetSpeed,Math.max(0,hazard.o.v-2));
      reason='HAZARD_BRAKE';
    }
    return{targetLane,targetSpeed,reason,state:state.state};
  }

  if(car.blueFlag){state.state='YIELD';state.targetId=null;targetLane=ideal;reason='BLUE_FLAG_PREDICTABLE';}

  const front=ahead.find(x=>Math.abs(x.o.lane-car.lane)<3.6);
  const committed=state.state==='COMMIT'&&time<state.commitUntil;
  const target=committed?cars.find(x=>x.id===state.targetId):null;

  if(committed&&target){
    const d=signedDelta(track,car,target);
    if(d<-(car.length+target.length)*.55-5){state.state='COMPLETE';state.targetId=null;state.commitUntil=time+.8;}
    else{targetLane=state.lane;reason='PASS_COMMIT';}
  }else if(front&&!car.blueFlag){
    const closing=car.v-front.o.v;
    const faster=(car.spec.pace-front.o.spec.pace)>.025||(car.spec.top-front.o.spec.top)>3;
    const straightLoad=Math.min(1,Math.abs(track.curvature(car.s+25))*85);
    const gap=front.d;
    const canAttack=gap<62&&closing>.6&&straightLoad<.72&&(faster||closing>1.8);
    if(canAttack){
      const side=front.o.lane>=0?-1:1;
      const candidates=[front.o.lane+side*3.0,front.o.lane-side*3.0,car.lane+side*2.6];
      const choice=candidates.find(l=>laneAvailable(car,l,cars,track));
      if(choice!=null){
        state.state='COMMIT';state.targetId=front.o.id;state.lane=clamp(choice,-6.4,6.4);state.commitUntil=time+3.2;
        targetLane=state.lane;reason=faster?'MULTICLASS_PASS':'ATTACK';
      }
    }
  }

  if(!front&&!committed&&!car.blueFlag&&behind.length){
    const attacker=behind[0];
    const similarClass=Math.abs(car.spec.pace-attacker.o.spec.pace)<.08;
    const closing=attacker.o.v-car.v;
    const straight=Math.abs(track.curvature(car.s+20))<.006;
    if(similarClass&&closing>.8&&-attacker.d<24&&straight&&car.aggression>.62&&!state.defenseUsed){
      const k=track.curvature(car.s+55),inside=k>=0?1:-1,candidate=clamp(inside*2.2,-4.5,4.5);
      if(laneAvailable(car,candidate,cars,track,.7)){targetLane=candidate;reason='DEFEND_ONE_MOVE';state.defenseUsed=true;state.defenseResetAt=time+7;}
    }
  }
  if(state.defenseUsed&&time>(state.defenseResetAt||0)&&behind.length===0)state.defenseUsed=false;

  const activeTarget=state.targetId!=null?cars.find(x=>x.id===state.targetId):null;
  for(const x of ahead.slice(0,4)){
    const other=x.o;
    const body=(car.length+other.length)*.5;
    const currentLat=Math.abs(car.lane-other.lane);
    const desiredLat=Math.abs(targetLane-other.lane);
    const closing=Math.max(0,car.v-other.v);
    const safe=safeLat(car,other);
    const usable=Math.max(.2,x.d-body);
    const ttc=closing>.1?usable/closing:99;
    const passEscape=activeTarget===other&&desiredLat>=safe*.92;
    const parallel=currentLat>=safe&&desiredLat>=safe;
    if(parallel)continue;

    if(!passEscape){
      const desired=body+4.8+car.v*.18+closing*.42;
      if(x.d<desired){
        const margin=clamp((x.d-body)/Math.max(4,desired-body),0,1);
        targetSpeed=Math.min(targetSpeed,other.v+margin*(fasterAdvantage(car,other)?6:4));reason='TRAFFIC_FOLLOW';
      }
      if(ttc<1.45)targetSpeed=Math.min(targetSpeed,Math.max(0,other.v-1.2));
    }else{
      if(ttc<1.15&&currentLat<safe*.86){targetSpeed=Math.min(targetSpeed,other.v+Math.max(0,(currentLat/safe-.55)*4));reason='PASS_BUILD_OVERLAP';}
      if(ttc<.55&&currentLat<safe*.68){
        targetSpeed=Math.min(targetSpeed,Math.max(0,other.v-2));reason='PASS_ABORT_SAFETY';
        state.state='ABORT';state.targetId=null;state.commitUntil=time+.7;targetLane=car.lane;
      }
    }
  }

  for(const o of cars){
    if(o===car||o.retired||o.pit.phase!=='TRACK')continue;
    const d=signedDelta(track,car,o);
    if(Math.abs(d)>(car.length+o.length)*.55+2.5)continue;
    const sepNow=car.lane-o.lane;
    const sepFuture=(targetLane+car.laneV*.55)-(o.targetLane??o.lane);
    const safe=safeLat(car,o);
    const crosses=sepNow===0||sepFuture===0||Math.sign(sepNow)!==Math.sign(sepFuture);
    const converges=Math.abs(sepFuture)<safe;
    if(crosses||converges){
      const dir=sepNow===0?(car.id<o.id?-1:1):Math.sign(sepNow);
      const candidate=o.lane+dir*safe;
      if(Math.abs(candidate)<=6.5)targetLane=candidate;
      if(Math.abs(sepNow)<safe*.6)targetSpeed=Math.min(targetSpeed,o.v);
      reason='COLLISION_AVOID';
    }
  }

  return{targetLane,targetSpeed,reason,state:state.state};
}
