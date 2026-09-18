import {createRace as createV26Race} from './v26-race.js';
import {trafficFollowPolicy} from './vehicle-performance-spec.js';

export function createRace(W,statusEl,settings={}){
  const R=createV26Race(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,W.total||1),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%total)+total)%total;
  let raceStartAt=null,interventions=0,lateralVetoes=0,passAwareDeferrals=0;
  function forwardGap(a,b){return wrap((b?.s||0)-(a?.s||0));}
  function signedGap(a,b){let d=(b?.s||0)-(a?.s||0);if(d>total*.5)d-=total;if(d<-total*.5)d+=total;return d;}
  function spatialFor(c){return(R.spatialNeighbours||W.runtimeSpatialNeighbours)?.get?.(c.id);}
  function laneConflict(a,b){const a0=Number(a?.lane)||0,b0=Number(b?.lane)||0,a1=Number.isFinite(Number(a?.laneTarget))?Number(a.laneTarget):a0,b1=Number.isFinite(Number(b?.laneTarget))?Number(b.laneTarget):b0,safe=((a?.width||2)+(b?.width||2))*.5+.48,d0=a0-b0,d1=a1-b1,now=Math.abs(d0)<safe,future=Math.abs(d1)<safe,crosses=d0===0||d1===0||Math.sign(d0)!==Math.sign(d1),converges=Math.abs(d1)<Math.abs(d0)&&Math.abs(d1)<safe*1.45;return now||future||crosses||converges;}
  function nearestAhead(c){let car=null,dist=Infinity;for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE'||!laneConflict(c,o))continue;const d=forwardGap(c,o);if(d>0&&d<dist){dist=d;car=o;}}return{car,dist};}
  function conflictingAhead(c,maxDist=90){const out=[];for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE'||!laneConflict(c,o))continue;const d=forwardGap(c,o);if(d>0&&d<maxDist)out.push({car:o,dist:d});}out.sort((a,b)=>a.dist-b.dist);return out;}
  function requestSpeedCap(c,cap){const x=Math.max(0,Number(cap)||0),old=c.predictiveSpeedCap;c.predictiveSpeedCap=old!=null&&Number.isFinite(Number(old))?Math.min(Number(old),x):x;}
  function frameRateAlpha(per60,dt){const a=clamp(Number(per60)||0,0,.999),frames=Math.max(0,Number(dt)||0)*60;return 1-Math.pow(1-a,frames);}
  function lateralSafety(c){
    if(c.retired||c.pitState!=='NONE')return;
    const current=Number(c.lane)||0,requested=Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):current;
    if(Math.abs(requested-current)<.08)return;
    const nearby=spatialFor(c)?.near||R.cars;let lower=-3.55,upper=3.55,blocked=false;
    for(const o of nearby){
      if(o===c||o.retired||o.pitState!=='NONE')continue;
      const d=signedGap(c,o),body=((c.length||5)+(o.length||5))*.5;if(Math.abs(d)>body+6.5)continue;
      const other=Number(o.lane)||0,safeLat=((c.width||2)+(o.width||2))*.5+.52,currentDelta=current-other,desiredDelta=requested-other;
      const crosses=currentDelta===0||desiredDelta===0||Math.sign(currentDelta)!==Math.sign(desiredDelta),narrows=Math.abs(desiredDelta)<Math.abs(currentDelta);
      if(!(crosses||narrows)||Math.abs(desiredDelta)>=safeLat)continue;
      const dir=currentDelta===0?(c.id<o.id?-1:1):Math.sign(currentDelta);if(dir<0)upper=Math.min(upper,other-safeLat);else lower=Math.max(lower,other+safeLat);blocked=true;
    }
    if(!blocked){c.laneTarget=requested;return;}
    c.avoid=Math.max(c.avoid||0,.82);c.racecraftBlocked=true;let desired;
    if(lower<=upper)desired=clamp(requested,lower,upper);else desired=current;
    if(Math.abs(desired-requested)>.02)lateralVetoes++;c.laneTarget=clamp(desired,-3.55,3.55);
  }
  function predictiveAvoidance(dt){
    for(const c of R.cars){const launch=c.launchSpeedCap;c.predictiveSpeedCap=launch!=null&&Number.isFinite(Number(launch))&&Number(launch)>=0?Number(launch):null;}
    const phase=R.sessionPhase,flag=String(R.flag||'GREEN'),caution=flag==='VSC'||flag==='SC',active=flag==='GREEN'||caution;if(phase==='QUALIFYING'||phase==='FORMATION'||!active)return;if(raceStartAt===null)raceStartAt=R.race.t;const launchAge=R.race.t-raceStartAt;
    for(const c of R.cars){
      if(c.retired||c.pitState!=='NONE')continue;const threats=conflictingAhead(c);if(!threats.length)continue;const multiThreat=threats.length>1;
      for(const a of threats){
        const front=a.car,conflict=laneConflict(c,front),closing=Math.max(0,c.v-front.v),bodyGap=((front.length||5)+(c.length||5))*.5,safeLat=((front.width||2)+(c.width||2))*.5+.48,currentLat=Math.abs((c.lane||0)-(front.lane||0)),plannedLat=Math.abs((Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):(c.lane||0))-(Number.isFinite(Number(front.laneTarget))?Number(front.laneTarget):(front.lane||0))),passIntent=!!c.multiclassPassIntent&&(!Number.isFinite(Number(c.multiclassPassTargetId))||Number(c.multiclassPassTargetId)===Number(front.id)),follow=trafficFollowPolicy({followerType:c.type,leaderType:front.type,gapM:a.dist,speedMps:c.v||0,leaderSpeedMps:front.v||0,bodyGapM:bodyGap,currentLateralM:currentLat,plannedLateralM:plannedLat,safeLateralM:safeLat,passIntent}),passEscape=follow.passEscape&&!caution,reaction=caution?.24:passEscape?.065:launchAge<11?.18:.12,compression=multiThreat?(passEscape?Math.min(.65,.20+closing*.025):Math.min(2.2,.8+closing*.10)):0,closingFactor=caution?.60:passEscape?.24:launchAge<11?.52:.42,desired=bodyGap+(caution?3.2:passEscape?1.0:2)+c.v*reaction+closing*closingFactor+compression,normalDesired=bodyGap+2+c.v*(launchAge<11?.18:.12)+closing*(launchAge<11?.52:.42)+(multiThreat?Math.min(2.2,.8+closing*.10):0),usable=Math.max(.05,a.dist-bodyGap),ttc=closing>.15?usable/closing:99,ttcLimit=caution?1.9:passEscape?.95:launchAge<11?1.7:1.45,normalTtcLimit=launchAge<11?1.7:1.45;
        if(passEscape&&conflict&&(a.dist<normalDesired||ttc<normalTtcLimit)&&a.dist>=desired&&ttc>=ttcLimit)passAwareDeferrals++;
        if(conflict&&a.dist<desired){const urgency=clamp((desired-a.dist)/Math.max(1,desired-bodyGap),0,1),target=Math.max(0,front.v+(1-urgency)*(caution?.9:passEscape?8.0:1.8)),decel=(c.brakeNominal||c.brake||15)*(caution?.78:launchAge<8?.72:passEscape?.68:.58),cap=Math.max(target,c.v-decel*dt*(.55+urgency*.65));requestSpeedCap(c,cap);if(!passEscape||urgency>.72)c.overtake=Math.min(c.overtake||0,.35);interventions++;}
        if(conflict&&ttc<ttcLimit){requestSpeedCap(c,front.v+Math.max(0,(ttc-.45)*(caution?.9:passEscape?4.2:1.5)));c.avoid=Math.max(c.avoid||0,passEscape?.35:.65);}
      }
      const a=threats[0],front=a.car,bodyGap=((front.length||5)+(c.length||5))*.5;
      if(!caution&&launchAge<9&&a.dist<38&&!c.multiclassPassIntent){const keepPer60=clamp(.16+(9-launchAge)*.018,.16,.32),keep=frameRateAlpha(keepPer60,dt);c.laneTarget+=(c.lane-c.laneTarget)*keep;c.avoid=Math.max(c.avoid||0,.30);}
      if(a.dist<bodyGap+1.2){const safeLat=((front.width||2)+(c.width||2))*.53+.20,delta=(c.lane||0)-(front.lane||0);if(Math.abs(delta)<safeLat){const dir=delta===0?(c.id%2?1:-1):Math.sign(delta),respect=caution?1:1-clamp((c.driver?.aggression||.6)-.45,0,.45)*.35,step=frameRateAlpha(.20*respect,dt);c.laneTarget=clamp(c.laneTarget+dir*(safeLat-Math.abs(delta))*step,-3.75,3.75);}}
    }
    for(const c of R.cars)lateralSafety(c);
  }
  function update(dt){predictiveAvoidance(dt);baseUpdate(dt);}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='collisionAvoidance')return{raceStartAt,interventions,lateralVetoes,passAwareDeferrals,mode:'predictive-cap-physical-obb-authoritative',spatialGrid:!!(R.spatialNeighbours||W.runtimeSpatialNeighbours),frameRateInvariant:true,cautionAware:true,projectedLaneConflict:true,passAware:true};return Reflect.get(target,prop,target);}});
}
