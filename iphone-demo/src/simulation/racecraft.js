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

export function planRacecraft(car,cars,track,time){
  const ideal=track.idealLane(car.s);
  const state=car.racecraft;
  const ahead=cars
    .filter(o=>o!==car&&!o.retired&&o.pit.phase==='TRACK')
    .map(o=>({o,d:signedDelta(track,car,o)}))
    .filter(x=>x.d>0&&x.d<130)
    .sort((a,b)=>a.d-b.d);

  let targetLane=ideal,targetSpeed=Infinity,reason='RACING_LINE';
  const front=ahead.find(x=>Math.abs(x.o.lane-car.lane)<3.6);
  const committed=state.state==='COMMIT'&&time<state.commitUntil;
  const target=committed?cars.find(x=>x.id===state.targetId):null;

  if(committed&&target){
    const d=signedDelta(track,car,target);
    if(d<-(car.length+target.length)*.55-5){
      state.state='COMPLETE';state.targetId=null;state.commitUntil=time+.8;
    }else{
      targetLane=state.lane;
      reason='PASS_COMMIT';
    }
  }else if(front){
    const closing=car.v-front.o.v;
    const faster=(car.spec.pace-front.o.spec.pace)>.025||(car.spec.top-front.o.spec.top)>3;
    const straightLoad=Math.min(1,Math.abs(track.curvature(car.s+25))*85);
    const gap=front.d;
    const canAttack=gap<62&&closing>.6&&straightLoad<.72&&(faster||closing>1.8);
    if(canAttack){
      const side=front.o.lane>=0?-1:1;
      const candidates=[
        front.o.lane+side*3.0,
        front.o.lane-side*3.0,
        car.lane+side*2.6
      ];
      const choice=candidates.find(l=>laneAvailable(car,l,cars,track));
      if(choice!=null){
        state.state='COMMIT';
        state.targetId=front.o.id;
        state.lane=clamp(choice,-6.4,6.4);
        state.commitUntil=time+3.2;
        targetLane=state.lane;
        reason=faster?'MULTICLASS_PASS':'ATTACK';
      }
    }
  }

  const activeTarget=state.targetId!=null?cars.find(x=>x.id===state.targetId):null;
  for(const o of ahead.slice(0,4)){
    const other=o.o;
    const body=(car.length+other.length)*.5;
    const currentLat=Math.abs(car.lane-other.lane);
    const desiredLat=Math.abs(targetLane-other.lane);
    const closing=Math.max(0,car.v-other.v);
    const safe=safeLat(car,other);
    const usable=Math.max(.2,o.d-body);
    const ttc=closing>.1?usable/closing:99;
    const passEscape=activeTarget===other&&desiredLat>=safe*.92;
    const parallel=currentLat>=safe&&desiredLat>=safe;
    if(parallel)continue;

    if(!passEscape){
      const desired=body+4.2+car.v*.16+closing*.38;
      if(o.d<desired){
        const margin=clamp((o.d-body)/Math.max(4,desired-body),0,1);
        targetSpeed=Math.min(targetSpeed,other.v+margin*(fasterAdvantage(car,other)?7:5));
        reason='TRAFFIC_FOLLOW';
      }
      if(ttc<1.35)targetSpeed=Math.min(targetSpeed,Math.max(0,other.v-1.2));
    }else if(ttc<.6&&currentLat<safe*.7){
      targetSpeed=Math.min(targetSpeed,Math.max(0,other.v-2));
      reason='PASS_ABORT_SAFETY';
      state.state='ABORT';
      state.targetId=null;
      state.commitUntil=time+.7;
      targetLane=car.lane;
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
function fasterAdvantage(a,b){
  return a.spec.pace>b.spec.pace+.02||a.spec.top>b.spec.top+3;
}
