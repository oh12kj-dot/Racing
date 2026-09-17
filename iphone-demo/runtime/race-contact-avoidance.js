import {createRace as createV26Race} from './v26-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV26Race(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,W.total||1),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%total)+total)%total;
  let raceStartAt=null,interventions=0,lateralVetoes=0;
  function forwardGap(a,b){return wrap((b?.s||0)-(a?.s||0));}
  function signedGap(a,b){let d=(b?.s||0)-(a?.s||0);if(d>total*.5)d-=total;if(d<-total*.5)d+=total;return d;}
  function spatialFor(c){return(R.spatialNeighbours||W.runtimeSpatialNeighbours)?.get?.(c.id);}
  function nearestAhead(c){let car=null,dist=Infinity;for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE')continue;const laneGap=Math.abs((o.lane||0)-(c.lane||0)),sameChannel=laneGap<((o.width||2)+(c.width||2))*.58;if(!sameChannel)continue;const d=forwardGap(c,o);if(d>0&&d<dist){dist=d;car=o;}}return{car,dist};}
  function requestSpeedCap(c,cap){const x=Math.max(0,Number(cap)||0),old=Number(c.predictiveSpeedCap);c.predictiveSpeedCap=Number.isFinite(old)?Math.min(old,x):x;}
  function frameRateAlpha(per60,dt){const a=clamp(Number(per60)||0,0,.999),frames=Math.max(0,Number(dt)||0)*60;return 1-Math.pow(1-a,frames);}
  function lateralSafety(c){
    if(c.retired||c.pitState!=='NONE')return;
    const current=Number(c.lane)||0;let desired=Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):current;
    if(Math.abs(desired-current)<.08)return;
    const nearby=spatialFor(c)?.near||R.cars;
    for(const o of nearby){
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
    for(const c of R.cars){const launch=Number(c.launchSpeedCap);c.predictiveSpeedCap=Number.isFinite(launch)&&launch>=0?launch:null;}
    const phase=R.sessionPhase,green=R.flag==='GREEN';if(phase==='QUALIFYING'||phase==='FORMATION'||!green)return;if(raceStartAt===null)raceStartAt=R.race.t;const launchAge=R.race.t-raceStartAt;
    for(const c of R.cars){if(c.retired||c.pitState!=='NONE')continue;const a=nearestAhead(c);if(!a.car)continue;const front=a.car,lat=Math.abs((front.lane||0)-(c.lane||0)),overlapLane=lat<((front.width||2)+(c.width||2))*.58,closing=Math.max(0,c.v-front.v),bodyGap=((front.length||5)+(c.length||5))*.5,reaction=launchAge<11?.42:.26,desired=bodyGap+2+c.v*reaction*.10+closing*.42,usable=Math.max(.05,a.dist-bodyGap),ttc=closing>.15?usable/closing:99;
      if(overlapLane&&a.dist<desired){const urgency=clamp((desired-a.dist)/Math.max(1,desired-bodyGap),0,1),target=Math.max(0,front.v+(1-urgency)*1.8),decel=(c.brakeNominal||c.brake||15)*(launchAge<8?.72:.58),cap=Math.max(target,c.v-decel*dt*(.55+urgency*.65));requestSpeedCap(c,cap);c.overtake=Math.min(c.overtake||0,.35);interventions++;}
      if(overlapLane&&ttc<1.45){requestSpeedCap(c,front.v+Math.max(0,(ttc-.45)*1.5));c.avoid=Math.max(c.avoid||0,.65);}
      if(launchAge<9&&a.dist<38){const keepPer60=clamp(.16+(9-launchAge)*.018,.16,.32),keep=frameRateAlpha(keepPer60,dt);c.laneTarget+=(c.lane-c.laneTarget)*keep;c.avoid=Math.max(c.avoid||0,.30);}
      if(a.dist<bodyGap+1.2){const safeLat=((front.width||2)+(c.width||2))*.53+.20,delta=(c.lane||0)-(front.lane||0);if(Math.abs(delta)<safeLat){const dir=delta===0?(c.id%2?1:-1):Math.sign(delta),respect=1-clamp((c.driver?.aggression||.6)-.45,0,.45)*.35,step=frameRateAlpha(.20*respect,dt);c.laneTarget=clamp(c.laneTarget+dir*(safeLat-Math.abs(delta))*step,-3.75,3.75);}}
    }
    for(const c of R.cars)lateralSafety(c);
  }
  function update(dt){predictiveAvoidance(dt);baseUpdate(dt);}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='collisionAvoidance')return{raceStartAt,interventions,lateralVetoes,mode:'predictive-cap-physical-obb-authoritative',spatialGrid:!!(R.spatialNeighbours||W.runtimeSpatialNeighbours),frameRateInvariant:true};return Reflect.get(target,prop,target);}});
}
