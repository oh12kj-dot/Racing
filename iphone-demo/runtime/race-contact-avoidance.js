import {createRace as createV26Race} from './v26-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV26Race(W,statusEl,settings),baseUpdate=R.update,total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const wrap=v=>((v%total)+total)%total;
  let raceStartAt=null,lateralVetoes=0;
  const suppressed=[];

  function progress(c){return c?._v8Progress??((c?.lap||0)*total+(c?.s||0));}
  function forwardGap(a,b){return wrap((b?.s||0)-(a?.s||0));}
  function signedGap(a,b){let d=(b?.s||0)-(a?.s||0);if(d>total*.5)d-=total;if(d<-total*.5)d+=total;return d;}
  function actualOverlap(a,b){
    if(!a||!b||a.retired||b.retired)return false;
    const longitudinal=Math.abs(progress(a)-progress(b));
    const halfLength=((a.length||5)+(b.length||5))*.5;
    const lateral=Math.abs((a.lane||0)-(b.lane||0));
    const halfWidth=((a.width||2)+(b.width||2))*.5;
    return longitudinal<halfLength*.94+.18&&lateral<halfWidth*.90;
  }

  function nearestAhead(c){
    let car=null,dist=Infinity;
    for(const o of R.cars){
      if(o===c||o.retired||o.pitState!=='NONE')continue;
      const d=forwardGap(c,o);
      if(d>0&&d<dist){dist=d;car=o;}
    }
    return{car,dist};
  }

  function lateralSafety(c){
    if(c.retired||c.pitState!=='NONE')return;
    const current=Number(c.lane)||0;let desired=Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):current;
    if(Math.abs(desired-current)<.08)return;
    for(const o of R.cars){
      if(o===c||o.retired||o.pitState!=='NONE')continue;
      const d=signedGap(c,o),body=((c.length||5)+(o.length||5))*.5;if(Math.abs(d)>body+6.5)continue;
      const other=Number(o.lane)||0,safeLat=((c.width||2)+(o.width||2))*.5+.52,currentDelta=current-other,desiredDelta=desired-other;
      const crosses=currentDelta===0||desiredDelta===0||Math.sign(currentDelta)!==Math.sign(desiredDelta),narrows=Math.abs(desiredDelta)<Math.abs(currentDelta);
      if(!(crosses||narrows)||Math.abs(desiredDelta)>=safeLat)continue;
      const dir=currentDelta===0?(c.id<o.id?-1:1):Math.sign(currentDelta),safeTarget=clamp(other+dir*safeLat,-3.55,3.55);
      if(Math.abs(safeTarget-desired)>.02){desired=safeTarget;c.avoid=Math.max(c.avoid||0,.82);c.racecraftBlocked=true;lateralVetoes++;}
    }
    c.laneTarget=desired;
  }

  function predictiveAvoidance(dt){
    const phase=R.sessionPhase,green=R.flag==='GREEN';
    if(phase==='QUALIFYING'||phase==='FORMATION'||!green)return;
    if(raceStartAt===null)raceStartAt=R.race.t;
    const launchAge=R.race.t-raceStartAt;
    for(const c of R.cars){
      if(c.retired||c.pitState!=='NONE')continue;
      const a=nearestAhead(c);if(!a.car)continue;
      const front=a.car,lat=Math.abs((front.lane||0)-(c.lane||0));
      const overlapLane=lat<((front.width||2)+(c.width||2))*.58;
      const closing=Math.max(0,c.v-front.v);
      const bodyGap=((front.length||5)+(c.length||5))*.5;
      const reaction=launchAge<11?.42:.26;
      const desired=bodyGap+2.0+c.v*reaction*.10+closing*.42;
      const usable=Math.max(.05,a.dist-bodyGap);
      const ttc=closing>.15?usable/closing:99;

      if(overlapLane&&a.dist<desired){
        const urgency=clamp((desired-a.dist)/Math.max(1,desired-bodyGap),0,1);
        const target=Math.max(0,front.v+(1-urgency)*1.8);
        const decel=(c.brakeNominal||c.brake||15)*(launchAge<8?.72:.58);
        c.v=Math.max(target,c.v-decel*dt*(.55+urgency*.65));
        c.overtake=Math.min(c.overtake||0,.35);
      }
      if(overlapLane&&ttc<1.45){
        c.v=Math.min(c.v,front.v+Math.max(0,(ttc-.45)*1.5));
        c.avoid=Math.max(c.avoid||0,.65);
      }

      // Realistic launch discipline: drivers initially hold their grid channel instead
      // of making multiple aggressive lateral moves before the field has opened up.
      if(launchAge<9&&a.dist<38){
        const keep=clamp(.16+(9-launchAge)*.018,.16,.32);
        c.laneTarget+=(c.lane-c.laneTarget)*keep;
        c.avoid=Math.max(c.avoid||0,.30);
      }

      // When genuinely side-by-side, create a small amount of racing room rather than
      // forcing both centre-lines into one another. Aggressive drivers still leave less.
      const longitudinal=Math.abs(progress(c)-progress(front));
      if(longitudinal<bodyGap+1.2){
        const safeLat=((front.width||2)+(c.width||2))*.53+.20;
        const delta=(c.lane||0)-(front.lane||0);
        if(Math.abs(delta)<safeLat){
          const dir=delta===0?(c.id%2?1:-1):Math.sign(delta);
          const respect=1-clamp((c.driver?.aggression||.6)-.45,0,.45)*.35;
          c.laneTarget=clamp(c.laneTarget+dir*(safeLat-Math.abs(delta))*.20*respect,-3.75,3.75);
        }
      }
    }
    // Universal safety net for every overtaking layer: a requested lateral move may
    // not cut through a car that is already alongside or in the immediate rear quarter.
    for(const c of R.cars)lateralSafety(c);
  }

  function filteredUpdate(dt){
    predictiveAvoidance(dt);
    const before=new Map(R.cars.map(c=>[c.id,{damage:c.damage,spinState:c.spinState,spinTimer:c.spinTimer,fault:c.fault,pitState:c.pitState,punctures:(c.wheelState||[]).map(w=>!!w.puncture)}]));
    const events=R.events,originalPush=events?.push;
    const stewardBefore=R.stewardCases?.length||0;
    suppressed.length=0;
    if(events&&originalPush){
      events.push=function(...items){
        const keep=[];
        for(const e of items){
          if(e?.type==='CONTACT'){
            const a=R.cars[e.carId],b=R.cars[e.data?.otherId];
            if(!actualOverlap(a,b)){suppressed.push({a:a?.id,b:b?.id,t:R.race.t});continue;}
          }
          if(e?.type==='INCIDENT_NOTED'&&suppressed.some(x=>x.a===e.carId&&Math.abs(x.t-R.race.t)<.05))continue;
          keep.push(e);
        }
        return keep.length?originalPush.apply(this,keep):this.length;
      };
    }
    try{baseUpdate(dt);}finally{if(events&&originalPush)events.push=originalPush;}

    if(suppressed.length){
      const ids=new Set(suppressed.flatMap(x=>[x.a,x.b]).filter(Number.isFinite));
      for(const id of ids){
        const c=R.cars[id],b=before.get(id);if(!c||!b)continue;
        c.damage=b.damage;c.spinState=b.spinState;c.spinTimer=b.spinTimer;c.fault=b.fault;
        if(c.pitState==='ENTRY'&&b.pitState==='NONE'&&b.fault!=='PUNCTURE')c.pitState=b.pitState;
        for(let i=0;i<(c.wheelState||[]).length;i++)c.wheelState[i].puncture=b.punctures[i]||false;
      }
      const cases=R.stewardCases;
      if(Array.isArray(cases)&&cases.length>stewardBefore){
        for(let i=cases.length-1;i>=stewardBefore;i--){
          const x=cases[i];if(x?.type==='CAUSING_COLLISION'&&suppressed.some(s=>s.a===x.carId&&(s.b===x.otherId||s.b==null)))cases.splice(i,1);
        }
      }
    }
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return filteredUpdate;
    if(prop==='collisionAvoidance')return{raceStartAt,suppressedFalseContacts:suppressed.length,lateralVetoes};
    return Reflect.get(target,prop,target);
  }});
}
