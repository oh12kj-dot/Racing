import {createRace as createPitExitRace} from './race-pit-exit-release.js';
import {performanceFor,resolveMulticlassPassPlan} from './vehicle-performance-spec.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function createRace(W,statusEl,settings={}){
  const R=createPitExitRace(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,Number(W.total)||1),passStates=new Map();
  let prepared=0,blocked=0,completed=0;

  const forwardGap=(a,b)=>{let d=(Number(b?.s)||0)-(Number(a?.s)||0);while(d<=0)d+=total;return d;};
  const signedGap=(a,b)=>{let d=(Number(b?.s)||0)-(Number(a?.s)||0);if(d>total*.5)d-=total;if(d<-total*.5)d+=total;return d;};
  function ahead(c){
    const spatial=(R.spatialNeighbours||W.runtimeSpatialNeighbours)?.get?.(c.id),candidate=spatial?.aheadView||spatial?.ahead;
    if(candidate?.car&&candidate.car!==c&&!candidate.car.retired&&candidate.car.pitState==='NONE')return{car:candidate.car,dist:Number(candidate.dist)||forwardGap(c,candidate.car)};
    let car=null,dist=Infinity;for(const o of R.cars||[]){if(o===c||o.retired||o.pitState!=='NONE')continue;const d=forwardGap(c,o);if(d<dist){dist=d;car=o;}}return car?{car,dist}:null;
  }
  function laneClear(c,target,ignoreId=null){
    const current=Number(c.lane)||0,to=clamp(Number(target)||0,-2.85,2.85),lo=Math.min(current,to),hi=Math.max(current,to);
    for(const o of R.cars||[]){
      if(o===c||o.retired||o.pitState!=='NONE')continue;const d=signedGap(c,o),body=((c.length||5)+(o.length||5))*.5,safe=((c.width||2)+(o.width||2))*.5+.48;
      if(d<-(body+7)||d>body+11)continue;
      const ol=Number(o.lane)||0,sweep=ol<lo?lo-ol:ol>hi?ol-hi:0;
      if(o.id===ignoreId&&d>body+1.0&&Math.abs(to-ol)>=safe+.12)continue;
      if(sweep<safe)return false;
    }
    return true;
  }
  function calibrate(c){
    const p=performanceFor(c.type);c.classPerformance={...(c.classPerformance||{}),...p,massKg:p.mass};c.massKg=p.mass;c.paceIndex=p.paceIndex;c.baseMaxNominal=p.top;c.accelNominal=p.accel;c.brakeNominal=p.brake;
  }
  function clearPass(c,reason='NONE'){
    const old=passStates.get(c.id);if(old&&reason==='PASSED')completed++;passStates.delete(c.id);c.multiclassPassIntent=false;c.multiclassPassTargetId=null;c.multiclassPassTelemetry={active:false,reason};
  }
  function preparePass(c){
    const now=Number(R.race?.t)||0,green=String(R.flag||'GREEN')==='GREEN'&&String(R.sessionPhase||'')==='RACE',launchAge=now-(Number(R.race?.green)||0);
    if(!green||launchAge<8||c.retired||c.pitState!=='NONE'||c.spinState!=='NONE'||c.hazardAvoiding||c.blueFlag||c.coolingMode||c.hydroplaning){clearPass(c,'INACTIVE');return;}
    let held=passStates.get(c.id);
    if(held){const leader=(R.cars||[]).find(x=>x.id===held.targetId),d=leader?forwardGap(c,leader):Infinity;if(!leader||d>held.rangeM+25){clearPass(c,leader?'PASSED':'TARGET LOST');held=null;}else if(now<held.until&&laneClear(c,held.targetLane,held.targetId)){c.multiclassPassIntent=true;c.multiclassPassTargetId=held.targetId;c.laneTarget=held.targetLane;c.multiclassPassTelemetry={active:true,targetId:held.targetId,targetLane:held.targetLane,gapM:d,reason:'COMMITTED'};return;}}
    const a=ahead(c);if(!a?.car){clearPass(c,'NO TARGET');return;}
    const closing=Math.max(0,(Number(c.v)||0)-(Number(a.car.v)||0)),load=clamp(Number(W.braking?.((c.s||0)+50)??W.racingBrakingAt?.((c.s||0)+50))||0,0,1),halfWidth=Math.min(3.55,Math.max(2.8,(Number(W.trackHalfWidth)||7.2)-3.5)),plan=resolveMulticlassPassPlan({followerType:c.type,leaderType:a.car.type,gapM:a.dist,closingMps:closing,brakingLoad:load,leaderLane:a.car.lane,halfWidth});
    if(!plan.eligible){clearPass(c,'NO CLASS ADVANTAGE');return;}
    if(!laneClear(c,plan.targetLane,a.car.id)){blocked++;clearPass(c,'LANE BLOCKED');return;}
    held={targetId:a.car.id,targetLane:plan.targetLane,until:now+1.6,rangeM:plan.rangeM};passStates.set(c.id,held);c.multiclassPassIntent=true;c.multiclassPassTargetId=a.car.id;c.laneTarget=plan.targetLane;c.multiclassPassTelemetry={active:true,targetId:a.car.id,targetLane:plan.targetLane,gapM:a.dist,closingMps:closing,paceDelta:plan.paceDelta,topDelta:plan.topDelta,reason:'FASTER CLASS'};prepared++;
  }
  function update(dt){for(const c of R.cars||[]){calibrate(c);preparePass(c);}return baseUpdate(dt);}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='realismCalibration')return{owner:'runtime-realism-calibration-v1',prepared,blocked,completed,active:passStates.size,cars:(R.cars||[]).map(c=>({id:c.id,type:c.type,massKg:c.massKg,paceIndex:c.paceIndex,topKmh:(c.classPerformance?.top||0)*3.6,pass:c.multiclassPassTelemetry||null}))};return Reflect.get(target,prop,target);}});
}
