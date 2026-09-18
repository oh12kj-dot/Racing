import {createRace as createV26Race} from './v26-race.js';
import {performanceFor,resolveMulticlassPassPlan,trafficFollowPolicy} from './vehicle-performance-spec.js';

const clampValue=(v,a,b)=>Math.max(a,Math.min(b,v));
const laneOf=c=>Number(c?.lane)||0;
const laneTargetOf=c=>Number.isFinite(Number(c?.laneTarget))?Number(c.laneTarget):laneOf(c);

export function projectedSideBySideRisk(a,b,{horizon=1.0,cornerLoad=0}={}){
  const aLane=laneOf(a),bLane=laneOf(b),aTarget=laneTargetOf(a),bTarget=laneTargetOf(b),rel0=aLane-bLane,relTarget=aTarget-bTarget;
  const estimatedLatV=c=>{
    const measured=Number(c?.lateralVelocity);if(Number.isFinite(measured))return clampValue(measured,-5,5);
    return clampValue((laneTargetOf(c)-laneOf(c))*2.0,-4.2,4.2);
  };
  const relV=estimatedLatV(a)-estimatedLatV(b),load=clampValue(Number(cornerLoad)||0,0,1),h=clampValue((Number(horizon)||1)*(1+load*.22),.55,1.35),relH=rel0+relV*h;
  const currentSep=Math.abs(rel0),velocitySep=Math.abs(relH),targetSep=Math.abs(relTarget),bodyWidth=((Number(a?.width)||2)+(Number(b?.width)||2))*.5,physicalClearance=bodyWidth+.025,riskClearance=physicalClearance+.055+load*.14;
  const velocityCross=rel0===0||relH===0||Math.sign(rel0)!==Math.sign(relH),targetCross=rel0===0||relTarget===0||Math.sign(rel0)!==Math.sign(relTarget),minFutureSep=Math.min(velocitySep,targetSep),projectedContact=velocityCross||targetCross||minFutureSep<riskClearance;
  const currentlySeparate=currentSep>physicalClearance,parallelClear=currentlySeparate&&!projectedContact;
  return{parallelClear,projectedContact,currentSep,velocitySep,targetSep,minFutureSep,physicalClearance,riskClearance,relativeLateralVelocity:relV,horizon:h,cornerLoad:load};
}

export function createRace(W,statusEl,settings={}){
  const R=createV26Race(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,W.total||1),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%total)+total)%total;
  let raceStartAt=null,interventions=0,lateralVetoes=0,multiclassPassesArmed=0,multiclassPassesCompleted=0,parallelPassFrames=0,projectedConvergenceBlocks=0;
  function forwardGap(a,b){return wrap((b?.s||0)-(a?.s||0));}
  function signedGap(a,b){let d=(b?.s||0)-(a?.s||0);if(d>total*.5)d-=total;if(d<-total*.5)d+=total;return d;}
  function spatialFor(c){return(R.spatialNeighbours||W.runtimeSpatialNeighbours)?.get?.(c.id);}
  function pairCornerLoad(a,b){
    const samples=[a?.s,b?.s,(Number(a?.s)||0)+24,(Number(b?.s)||0)+24];let load=0;
    for(const s of samples)load=Math.max(load,clamp(Number(W.braking?.(s))||0,0,1));
    return load;
  }
  function laneConflict(a,b){
    const a0=laneOf(a),b0=laneOf(b),a1=laneTargetOf(a),b1=laneTargetOf(b),safe=((a?.width||2)+(b?.width||2))*.5+.48,d0=a0-b0,d1=a1-b1,body=((a?.length||5)+(b?.length||5))*.5,longitudinal=Math.abs(signedGap(a,b)),sideBySide=longitudinal<=body+2.8;
    if(sideBySide){
      const risk=projectedSideBySideRisk(a,b,{horizon:1.0,cornerLoad:pairCornerLoad(a,b)});
      a.projectedSideBySideRisk=risk;b.projectedSideBySideRisk=risk;
      if(risk.parallelClear){parallelPassFrames++;return false;}
      if(risk.projectedContact){projectedConvergenceBlocks++;return true;}
    }
    const now=Math.abs(d0)<safe,future=Math.abs(d1)<safe,crosses=d0===0||d1===0||Math.sign(d0)!==Math.sign(d1),converges=Math.abs(d1)<Math.abs(d0)&&Math.abs(d1)<safe*1.45;return now||future||crosses||converges;
  }
  function conflictingAhead(c,maxDist=120){const out=[];for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE'||!laneConflict(c,o))continue;const d=forwardGap(c,o);if(d>0&&d<maxDist)out.push({car:o,dist:d});}out.sort((a,b)=>a.dist-b.dist);return out;}
  function requestSpeedCap(c,cap){const x=Math.max(0,Number(cap)||0),old=c.predictiveSpeedCap;c.predictiveSpeedCap=old!=null&&Number.isFinite(Number(old))?Math.min(Number(old),x):x;}
  function frameRateAlpha(per60,dt){const a=clamp(Number(per60)||0,0,.999),frames=Math.max(0,Number(dt)||0)*60;return 1-Math.pow(1-a,frames);}
  function clearMulticlassPass(c,completed=false){
    if(completed)multiclassPassesCompleted++;
    const owned=c.racecraftIntent==='MULTICLASS_PASS';c.multiclassPassIntent=false;c.multiclassPassTargetId=null;c.multiclassPassLane=null;
    if(owned){c.racecraftIntent=null;if(c.battleState==='ATTACK')c.battleState='HUNT';}
  }
  function maintainMulticlassPass(c,dt){
    if(!c.multiclassPassIntent||!Number.isFinite(Number(c.multiclassPassTargetId)))return false;
    const targetId=Number(c.multiclassPassTargetId),front=R.cars.find(x=>Number(x?.id)===targetId);
    if(!front||front.retired||front.pitState!=='NONE'||c.retired||c.pitState!=='NONE'){clearMulticlassPass(c);return false;}
    const d=signedGap(c,front),body=((front.length||5)+(c.length||5))*.5,range=performanceFor(c.type).multiclassPassRangeM;
    if(d<-(body+6)){clearMulticlassPass(c,true);return false;}
    if(d>range+24){clearMulticlassPass(c);return false;}
    const lane=Number.isFinite(Number(c.multiclassPassLane))?Number(c.multiclassPassLane):((front.lane||0)>=0?-2.6:2.6),blend=frameRateAlpha(.16,dt);
    c.multiclassPassIntent=true;c.battleState='ATTACK';c.racecraftIntent='MULTICLASS_PASS';c.laneTarget+=(lane-c.laneTarget)*blend;return true;
  }
  function armMulticlassPass(c,front,dist,closing,dt){
    if(c.multiclassPassIntent&&Number.isFinite(Number(c.multiclassPassTargetId))&&Number(c.multiclassPassTargetId)!==Number(front.id))return false;
    const load=clamp(Number(W.braking?.((c.s||0)+45))||0,0,1),plan=resolveMulticlassPassPlan({followerType:c.type,leaderType:front.type,gapM:dist,closingMps:closing,brakingLoad:load,leaderLane:front.lane,halfWidth:Math.min(3.55,Math.max(2.75,(Number(W.trackHalfWidth)||7.2)-3.45))});
    if(!plan.eligible)return false;
    const oldTarget=Number.isFinite(Number(c.multiclassPassTargetId))?Number(c.multiclassPassTargetId):null;c.multiclassPassIntent=true;c.multiclassPassTargetId=front.id;c.multiclassPassLane=plan.targetLane;c.battleState='ATTACK';c.racecraftIntent='MULTICLASS_PASS';
    const blend=frameRateAlpha(.20+clamp(closing/35,0,.12),dt);c.laneTarget+=(plan.targetLane-c.laneTarget)*blend;if(oldTarget!==front.id)multiclassPassesArmed++;
    return true;
  }
  function lateralSafety(c){
    if(c.retired||c.pitState!=='NONE')return;
    const current=Number(c.lane)||0,requested=Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):current;
    if(Math.abs(requested-current)<.08)return;
    const nearby=spatialFor(c)?.near||R.cars;let lower=-3.55,upper=3.55,blocked=false;
    for(const o of nearby){
      if(o===c||o.retired||o.pitState!=='NONE')continue;
      const d=signedGap(c,o),body=((c.length||5)+(o.length||5))*.5;if(Math.abs(d)>body+6.5)continue;
      const risk=projectedSideBySideRisk(c,o,{horizon:.9,cornerLoad:pairCornerLoad(c,o)});if(risk.parallelClear)continue;
      const other=Number(o.lane)||0,safeLat=((c.width||2)+(o.width||2))*.5+.52,currentDelta=current-other,desiredDelta=requested-other;
      const targetIsPass=!!c.multiclassPassIntent&&Number(c.multiclassPassTargetId)===Number(o.id),aheadEnough=d>body+1.0;
      if(targetIsPass&&aheadEnough&&Math.abs(desiredDelta)>=safeLat*.88)continue;
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
    const phase=R.sessionPhase,flag=String(R.flag||'GREEN'),caution=flag==='VSC'||flag==='SC',active=flag==='GREEN'||caution;
    for(const c of R.cars){const launch=c.launchSpeedCap;c.predictiveSpeedCap=launch!=null&&Number.isFinite(Number(launch))&&Number(launch)>=0?Number(launch):null;c.projectedSideBySideRisk=null;if(caution||phase==='QUALIFYING'||phase==='FORMATION'||!active)clearMulticlassPass(c);else maintainMulticlassPass(c,dt);}
    if(phase==='QUALIFYING'||phase==='FORMATION'||!active)return;if(raceStartAt===null)raceStartAt=R.race.t;const launchAge=R.race.t-raceStartAt;
    for(const c of R.cars){
      if(c.retired||c.pitState!=='NONE')continue;const threats=conflictingAhead(c);if(!threats.length)continue;const multiThreat=threats.length>1;
      for(const a of threats){
        const front=a.car,closing=Math.max(0,(c.v||0)-(front.v||0)),samePassTarget=c.multiclassPassIntent&&Number(c.multiclassPassTargetId)===Number(front.id),passIntent=!caution&&launchAge>=8&&(samePassTarget||(!c.multiclassPassIntent&&armMulticlassPass(c,front,a.dist,closing,dt))),bodyGap=((front.length||5)+(c.length||5))*.5,currentLat=Math.abs((front.lane||0)-(c.lane||0)),plannedLat=Math.abs((Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):(c.lane||0))-(Number.isFinite(Number(front.laneTarget))?Number(front.laneTarget):(front.lane||0))),safeLat=((c.width||2)+(front.width||2))*.5+.48,follow=trafficFollowPolicy({followerType:c.type,leaderType:front.type,gapM:a.dist,speedMps:c.v||0,leaderSpeedMps:front.v||0,bodyGapM:bodyGap,currentLateralM:currentLat,plannedLateralM:plannedLat,safeLateralM:safeLat,passIntent});
        const reaction=caution?.24:launchAge<11?.18:(passIntent?.07:.12),compression=multiThreat&&!passIntent?Math.min(2.2,.8+closing*.10):0,desired=bodyGap+(caution?3.2:passIntent?1.5:2)+(c.v||0)*reaction+closing*(caution?.60:launchAge<11?.52:passIntent?.18:.42)+compression,usable=Math.max(.05,a.dist-bodyGap),ttc=closing>.15?usable/closing:99,ttcLimit=caution?1.9:launchAge<11?1.7:passIntent?1.02:follow.ttcLimit;
        if(a.dist<desired&&follow.shouldCap){const urgency=clamp((desired-a.dist)/Math.max(1,desired-bodyGap),0,1),target=Math.max(0,follow.allowedSpeed),decel=(c.brakeNominal||c.brake||performanceFor(c.type).brake)*(caution?.78:launchAge<8?.72:passIntent?.42:.58),cap=Math.max(target,(c.v||0)-decel*dt*(.55+urgency*.65));requestSpeedCap(c,cap);if(!passIntent)c.overtake=Math.min(c.overtake||0,.35);interventions++;}
        if(ttc<ttcLimit&&follow.shouldCap){requestSpeedCap(c,Math.max(follow.allowedSpeed,(front.v||0)+Math.max(0,(ttc-.45)*(caution?.9:passIntent?2.2:1.5))));if(!passIntent||ttc<.72)c.avoid=Math.max(c.avoid||0,.65);}
      }
      const a=threats[0],front=a.car,bodyGap=((front.length||5)+(c.length||5))*.5;
      if(!caution&&launchAge<9&&a.dist<38){const keepPer60=clamp(.16+(9-launchAge)*.018,.16,.32),keep=frameRateAlpha(keepPer60,dt);c.laneTarget+=(c.lane-c.laneTarget)*keep;c.avoid=Math.max(c.avoid||0,.30);}
      if(a.dist<bodyGap+1.2){const risk=projectedSideBySideRisk(c,front,{horizon:.75,cornerLoad:pairCornerLoad(c,front)});if(risk.parallelClear)continue;const safeLat=((front.width||2)+(c.width||2))*.53+.20,delta=(c.lane||0)-(front.lane||0);if(Math.abs(delta)<safeLat){const dir=delta===0?(c.id%2?1:-1):Math.sign(delta),respect=caution?1:1-clamp((c.driver?.aggression||.6)-.45,0,.45)*.35,step=frameRateAlpha(.20*respect,dt);c.laneTarget=clamp(c.laneTarget+dir*(safeLat-Math.abs(delta))*step,-3.75,3.75);}}
    }
    for(const c of R.cars)lateralSafety(c);
  }
  function update(dt){predictiveAvoidance(dt);baseUpdate(dt);}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='collisionAvoidance')return{raceStartAt,interventions,lateralVetoes,multiclassPassesArmed,multiclassPassesCompleted,parallelPassFrames,projectedConvergenceBlocks,mode:'projected-trajectory-parallel-pass-aware-physical-obb-authoritative',spatialGrid:!!(R.spatialNeighbours||W.runtimeSpatialNeighbours),frameRateInvariant:true,cautionAware:true,projectedLaneConflict:true,parallelPassPreservesSpeed:true,passIntentLatched:true};return Reflect.get(target,prop,target);}});
}
