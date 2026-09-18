import {createRace as createStrategyRace} from './race-strategy-dynamics.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const phases=new Set(['HUNT','PRESSURE','FEINT','ATTACK','SWITCHBACK','RESET','DEFEND']);

export function createRace(W,statusEl,settings={}){
  const R=createStrategyRace(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,Number(W.total)||1);
  const engagements=new Map(),strategy=new Map(),perfSaved=new Map();
  let updates=0,attackAttempts=0,feints=0,switchbacks=0,defensiveMoves=0,strategicCalls=0,blockedMoves=0,pitRequests=0,pitEntries=0;

  const progress=c=>(Number(c?.lap)||0)*total+(Number(c?.s)||0);
  const gapSeconds=(a,b)=>{
    if(!a||!b)return Infinity;let d=progress(a)-progress(b);if(d<0)d+=total;
    return d/Math.max(12,Number(b.v)||12);
  };
  const signedTrackGap=(a,b)=>{
    let d=(Number(b?.s)||0)-(Number(a?.s)||0);
    if(d>total*.5)d-=total;if(d<-total*.5)d+=total;return d;
  };
  const deterministic=(id,salt=0)=>{
    const x=Math.sin((id+1)*12.9898+(salt+1)*78.233)*43758.5453;return x-Math.floor(x);
  };
  function traits(c){
    const p=c.driverProfile||{},d=c.driver||{};
    return{
      aggression:clamp(Number(d.aggression??p.overtake??1)-.02,.42,1.12),
      racecraft:clamp(Number(d.racecraft??p.pace??1),.70,1.12),
      composure:clamp(Number(p.pressure??p.consistency??1),.86,1.08),
      patience:clamp(.70+(Number(p.tyre??1)-.94)*1.8+(1-(Number(d.aggression)||.7))*.18,.62,1.08),
      defense:clamp(Number(p.defense??1),.92,1.12),
      overtake:clamp(Number(p.overtake??1),.92,1.14),
      tyreCare:clamp(Number(p.tyre??d.tireCare??1),.90,1.12),
      braking:clamp(Number(p.braking??1),.92,1.10),
      style:c.driverStyle||p.name||'ALL ROUNDER'
    };
  }
  function stateFor(c){
    let s=engagements.get(c.id);if(s)return s;
    const t=traits(c);s={phase:'HUNT',since:R.race?.t||0,targetId:null,phaseUntil:0,moveSide:deterministic(c.id,2)>.5?1:-1,attempts:0,pressure:0,traits:t,lastDefenseAt:-99,lastAttackAt:-99,lastTransition:'INIT'};engagements.set(c.id,s);return s;
  }
  function stratFor(c){
    let s=strategy.get(c.id);if(s)return s;
    s={mode:'NORMAL',reason:'PACE',windowStart:null,windowEnd:null,undercut:0,overcut:0,projectedAfterPit:null,pitLoss:22.5,lastCallLap:-99,lastCallAt:-99,confidence:.5};strategy.set(c.id,s);return s;
  }
  function transition(c,s,next,reason,duration){
    if(!phases.has(next)||s.phase===next)return;
    s.phase=next;s.since=R.race?.t||0;s.phaseUntil=s.since+Math.max(.15,duration||1);s.lastTransition=reason||next;
    if(next==='ATTACK'){s.attempts++;s.lastAttackAt=s.since;attackAttempts++;}
    if(next==='FEINT')feints++;if(next==='SWITCHBACK')switchbacks++;
  }
  function neighbours(c){
    const st=R.getStandings?.()||[],i=st.findIndex(x=>x.id===c.id);
    return{ahead:i>0?st[i-1]:null,behind:i>=0&&i<st.length-1?st[i+1]:null,index:i,standings:st};
  }
  function nearbyTraffic(c,front=18,back=8){
    let n=0;for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE')continue;const d=signedTrackGap(c,o);if(d>=-back&&d<=front)n++;}return n;
  }
  function laneClear(c,target,ignoreId=null){
    const from=Number(c.lane)||0,to=clamp(Number(target)||0,-2.75,2.75),lo=Math.min(from,to),hi=Math.max(from,to);
    for(const o of R.cars){
      if(o===c||o.retired||o.pitState!=='NONE')continue;
      const d=signedTrackGap(c,o),body=((c.length||5)+(o.length||5))*.5,safeLat=((c.width||2)+(o.width||2))*.5+.48;
      if(d<-(body+3.4)||d>body+8.5)continue;
      if(o.id===ignoreId&&d>body+1.2&&Math.abs(to-(Number(o.lane)||0))>safeLat+.20)continue;
      const ol=Number(o.lane)||0,latToSweep=ol<lo?lo-ol:ol>hi?ol-hi:0;
      if(latToSweep<safeLat)return false;
    }
    return true;
  }
  function moveLane(c,target,rate,dt,ignoreId=null){
    const desired=clamp(Number(target)||0,-2.75,2.75),current=Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):(Number(c.lane)||0);
    if(!laneClear(c,desired,ignoreId)){c.racecraftBlocked=true;blockedMoves++;return current;}
    const maxStep=Math.max(.006,Math.max(.15,Number(rate)||.5)*Math.max(.001,dt));
    c.racecraftBlocked=false;return current+clamp(desired-current,-maxStep,maxStep);
  }
  function cornerSignal(c,meters=55){return Number(W.racingCurvatureAt?.((c.s||0)+meters)??W.curvatureAt?.((c.s||0)+meters))||0;}
  function brakingLoad(c,meters=35){return clamp(Number(W.braking?.((c.s||0)+meters))||0,0,1);}
  function savePerf(c){perfSaved.set(c.id,{max:c._v18BaseMax,accel:c._v18BaseAccel});}
  function restorePerf(c){const x=perfSaved.get(c.id);if(!x)return;c._v18BaseMax=x.max;c._v18BaseAccel=x.accel;perfSaved.delete(c.id);}
  function applyPace(c,mult){
    if(Number.isFinite(Number(c._v18BaseMax)))c._v18BaseMax*=mult;
    if(Number.isFinite(Number(c._v18BaseAccel)))c._v18BaseAccel*=clamp(.998+(mult-1)*.30,.990,1.006);
    c.racecraftPaceMultiplier=mult;
  }
  function prepareRacecraft(c,dt){
    if(!c||c.retired)return;savePerf(c);const s=stateFor(c),t=s.traits,{ahead,behind}=neighbours(c),now=R.race?.t||0;
    const specialState=!!(c.blueFlag||c.coolingMode||c.hydroplaning),raceActive=R.flag==='GREEN'&&R.sessionPhase==='RACE'&&c.pitState==='NONE'&&c.spinState==='NONE'&&!c.hazardAvoiding&&!specialState;
    if(!raceActive){if(s.phase!=='HUNT'&&s.phase!=='RESET')transition(c,s,'RESET',specialState?'SPECIAL STATE PRIORITY':'RACECRAFT INACTIVE',.8);c.racecraftIntent=specialState?'SPECIAL':'RESET';c.battleState='NONE';c.racecraftBlocked=false;applyPace(c,1);return;}
    const aheadGap=ahead?gapSeconds(ahead,c):Infinity,behindGap=behind?gapSeconds(c,behind):Infinity,closing=ahead?Math.max(-12,Math.min(12,(c.v||0)-(ahead.v||0))):0;
    const load=brakingLoad(c),curv=cornerSignal(c),draft=Number(c.slipstream)||0,density=nearbyTraffic(c);
    s.targetId=ahead?.id??null;s.pressure=clamp((2.0-aheadGap)/2.0,0,1);

    if(ahead&&aheadGap<2.0){
      if(s.phase==='HUNT'&&aheadGap<1.35)transition(c,s,'PRESSURE','CLOSE ENOUGH TO PRESSURE',2.2+t.patience*2.0);
      if(s.phase==='PRESSURE'&&now>=s.phaseUntil){
        const attackReadiness=clamp((1.45-aheadGap)*.42+draft*.52+Math.max(0,closing)*.025+(t.overtake-1)*1.15,.04,.90);
        const feintBias=.19+(1-t.patience)*.15+(deterministic(c.id,Math.floor(now/4))-.5)*.10;
        const attackWindow=aheadGap>.42&&aheadGap<1.35&&load<.50&&density<=2;
        if(attackWindow&&attackReadiness>.58)transition(c,s,deterministic(c.id,s.attempts+7)<feintBias?'FEINT':'ATTACK','CLEAR ATTACK WINDOW',1.25);
        else transition(c,s,'PRESSURE',density>2?'TRAFFIC TOO DENSE':'WAIT FOR BETTER EXIT',1.8+t.patience*1.8);
      }
      if(s.phase==='FEINT'&&now>=s.phaseUntil)transition(c,s,'ATTACK','FEINT COMPLETE',1.25);
      if(s.phase==='ATTACK'&&now>=s.phaseUntil){
        if(load>.42&&aheadGap<1.0&&density<=2)transition(c,s,'SWITCHBACK','CROSSOVER EXIT',1.0);
        else transition(c,s,'RESET','ATTACK COMPLETE',.9);
      }
      if(s.phase==='SWITCHBACK'&&now>=s.phaseUntil)transition(c,s,'RESET','SWITCHBACK COMPLETE',.8);
      if(s.phase==='RESET'&&now>=s.phaseUntil)transition(c,s,aheadGap<1.65?'PRESSURE':'HUNT','RESET COMPLETE',1.3);
    }else if(s.phase!=='HUNT'&&s.phase!=='RESET'){transition(c,s,'RESET','GAP OPENED',.8);}else if(s.phase==='RESET'&&now>=s.phaseUntil)transition(c,s,'HUNT','GAP OPENED',1);

    let mult=1;
    if(s.phase==='HUNT')mult=1.0005;
    if(s.phase==='PRESSURE')mult=1.0015+(t.overtake-1)*.012;
    if(s.phase==='FEINT'&&ahead){
      const feintLane=s.moveSide*(Math.abs(curv)>.0018?1.05:1.25);c.laneTarget=moveLane(c,feintLane,.52,dt,ahead.id);mult=1.002;
    }
    if(s.phase==='ATTACK'&&ahead){
      const away=(ahead.lane||0)>=0?-2.15:2.15,inside=Math.sign(curv||s.moveSide)*1.75;
      const attackLane=Math.abs(curv)>.0018&&load<.34&&t.braking>1?inside:away;c.laneTarget=moveLane(c,attackLane,.78,dt,ahead.id);mult=1.0035+(t.overtake-1)*.018+draft*.003;
    }
    if(s.phase==='SWITCHBACK'&&ahead){const switchLane=clamp(-(ahead.lane||s.moveSide*1.2)*.78,-1.85,1.85);c.laneTarget=moveLane(c,switchLane,.86,dt,ahead.id);mult=1.004;}
    if(s.phase==='RESET'){mult=.999;}
    if(aheadGap<.42)mult=Math.min(mult,.997);

    if(behind&&behindGap<1.00&&behind.battleState==='ATTACK'&&now-s.lastDefenseAt>4.0&&load<.48&&density<=2){
      const threat=stateFor(behind),oneMove=clamp(-(threat.moveSide||1)*1.0,-1.05,1.05),next=moveLane(c,oneMove,.50,dt,behind.id);
      if(next!==(c.laneTarget||0)){c.laneTarget=next;s.lastDefenseAt=now;defensiveMoves++;}c.battleState='DEFEND';c.racecraftIntent='DEFEND';
    }else{c.battleState=['ATTACK','FEINT','SWITCHBACK'].includes(s.phase)?'ATTACK':s.phase==='PRESSURE'?'PRESSURE':'NONE';c.racecraftIntent=s.phase;}
    applyPace(c,clamp(mult,.992,1.008));
    c.racecraftTelemetry={phase:s.phase,targetId:s.targetId,aheadGapSec:Number.isFinite(aheadGap)?aheadGap:null,behindGapSec:Number.isFinite(behindGap)?behindGap:null,closingMps:closing,pressure:s.pressure,attempts:s.attempts,style:t.style,aggression:t.aggression,patience:t.patience,composure:t.composure,overtake:t.overtake,defense:t.defense,trafficDensity:density,laneBlocked:!!c.racecraftBlocked};
  }

  function estimateProjectedPosition(c,pitLossSec,standings){
    const me=progress(c),speed=Math.max(18,Number(c.v)||18),lossM=pitLossSec*speed;let pos=1;
    for(const o of standings){if(o===c||o.retired)continue;let d=me-progress(o);if(d<0)d+=total;if(d<lossM)pos++;}
    return clamp(pos,1,standings.length||1);
  }
  function pitEntryDistance(c){
    const f=Number(W.pitEntryFraction);if(!Number.isFinite(f))return Infinity;
    const s=((Number(c.s)||0)%total+total)%total,entry=((f%1)+1)%1*total;let d=entry-s;if(d<0)d+=total;return d;
  }
  function armPitRequest(c,s,callLap){
    if(c._spectatorPitRequest)return;
    c._spectatorPitRequest={lap:callLap,requestedAt:R.race?.t||0,mode:s.mode,reason:s.reason,projectedAfterPit:s.projectedAfterPit,confidence:s.confidence};
    c.strategy=c.strategy||{};c.strategy.window='BOX';c.strategy.reason=s.reason;s.lastCallLap=callLap;s.lastCallAt=R.race?.t||0;strategicCalls++;pitRequests++;
    R.events?.push?.({id:`spectator-strategy-${c.id}-${Date.now()}`,type:'STRATEGY_CALL',t:R.race?.t||0,carId:c.id,data:{mode:s.mode,reason:s.reason,projectedAfterPit:s.projectedAfterPit,confidence:s.confidence}});
    if(Array.isArray(R.radio))R.radio.push({id:`spectator-radio-${c.id}-${Date.now()}`,t:R.race?.t||0,carId:c.id,name:`${c.team||'TEAM'} ENGINEER`,kind:'STRATEGY',text:s.mode==='UNDERCUT'?`Box this lap. Undercut opportunity. Target exit position ${s.projectedAfterPit}.`:`Box this lap. ${s.reason}. Target exit position ${s.projectedAfterPit}.`});
  }
  function activatePitRequest(c){
    const req=c?._spectatorPitRequest;if(!req)return;
    if(c.retired){delete c._spectatorPitRequest;return;}
    if(c.pitState!=='NONE'){delete c._spectatorPitRequest;return;}
    if(!W.inPitWindow?.(c.s))return;
    if(W.inPitSpeedZone?.(c.s))return;
    c.pitState='ENTRY';c.pitTimer=0;c._runtimePitPhase='PIT_ENTRY';c.pitLaneStatus='PIT ENTRY';delete c._spectatorPitRequest;pitEntries++;
  }
  function updateStrategy(c){
    if(!c||c.retired)return;const s=stratFor(c),tele=c.strategyTelemetry||R.strategyFor?.(c.id)||{},n=neighbours(c),lap=Math.max(0,Number(c.lap)||0),target=Math.max(1,Number(R.race?.lapsTarget)||1),lapsLeft=Math.max(0,target-lap),wear=clamp(Number(tele.tyreWear??c.wear)||0,0,1),fuel=Number(tele.fuelKg??c.fuelKg),aheadGap=n.ahead?gapSeconds(n.ahead,c):Infinity,behindGap=n.behind?gapSeconds(c,n.behind):Infinity;
    const trafficPenalty=n.standings.filter(o=>o!==c&&Math.abs(progress(o)-progress(c))<80).length*.35;s.pitLoss=21.5+trafficPenalty+(c.type==='gt'?1.2:0);
    const targetWear=clamp(.78+(s.traits?.tyreCare||stateFor(c).traits.tyreCare-1)*.12,.74,.84),wearPressure=clamp((wear-.48)/.34,0,1);
    s.windowStart=clamp(Math.ceil(lap+Math.max(1,lapsLeft*(1-wearPressure)*.35)),lap+1,target-1);s.windowEnd=clamp(s.windowStart+1,s.windowStart,target-1);
    s.undercut=clamp((3.2-aheadGap)/3.2,0,1)*clamp((wear-.48)/.26,0,1)*(lapsLeft>1?1:0);
    const aheadPitting=!!n.ahead&&n.ahead.pitState!=='NONE';s.overcut=clamp((2.5-aheadGap)/2.5,0,1)*(aheadPitting?1:.15)*clamp((.72-wear)/.30,0,1);
    s.projectedAfterPit=estimateProjectedPosition(c,s.pitLoss,n.standings);s.confidence=clamp(.50+Math.abs(s.undercut-s.overcut)*.38+wearPressure*.18,.45,.94);
    const fuelLow=Number.isFinite(fuel)&&fuel<8.5,criticalWear=wear>targetWear,shortRun=lapsLeft<=1;
    if(shortRun){s.mode='STAY OUT';s.reason='FINISH WINDOW';}
    else if(s.undercut>.52){s.mode='UNDERCUT';s.reason=`ATTACK P${Math.max(1,(c.position||1)-1)}`;}
    else if(s.overcut>.52){s.mode='OVERCUT';s.reason='EXTEND INTO CLEAN AIR';}
    else if(behindGap<2.0&&wear>.58){s.mode='COVER';s.reason='COVER CAR BEHIND';}
    else if(criticalWear||fuelLow){s.mode='BOX';s.reason=fuelLow?'FUEL WINDOW':'TYRE LIFE';}
    else{s.mode='NORMAL';s.reason='PACE';}
    s.safeToBox=s.projectedAfterPit<=Math.min((c.position||99)+4,n.standings.length||99);
    c.strategyInsight={mode:s.mode,reason:s.reason,pitWindow:[s.windowStart,s.windowEnd],undercut:s.undercut,overcut:s.overcut,projectedAfterPit:s.projectedAfterPit,pitLossSec:s.pitLoss,safeToBox:s.safeToBox,confidence:s.confidence,lapsLeft,pitRequested:!!c._spectatorPitRequest};

    const entryDistance=pitEntryDistance(c),nearEntry=entryDistance>35&&entryDistance<1100,callLap=Math.floor(lap),canCall=R.flag==='GREEN'&&R.sessionPhase==='RACE'&&c.pitState==='NONE'&&!c._spectatorPitRequest&&lap>0&&lapsLeft>1&&nearEntry&&s.lastCallLap!==callLap;
    const tactical=(s.mode==='UNDERCUT'&&s.undercut>.68&&wear>.54)||(s.mode==='COVER'&&wear>.66),required=criticalWear||fuelLow;
    if(canCall&&(required||tactical))armPitRequest(c,s,callLap);
  }

  function update(dt){
    const step=clamp(Number(dt)||.016,.001,.05);for(const c of R.cars){activatePitRequest(c);prepareRacecraft(c,step);}
    try{baseUpdate(dt);}finally{for(const c of R.cars)restorePerf(c);}
    for(const c of R.cars)updateStrategy(c);updates++;
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='racecraftFor')return id=>{const s=engagements.get(Number(id));return s?{...s,traits:{...s.traits}}:null;};
    if(prop==='strategyInsightFor')return id=>{const s=strategy.get(Number(id));return s?{...s}:null;};
    if(prop==='racecraftDynamics')return{owner:'runtime-racecraft-v2',updates,attackAttempts,feints,switchbacks,defensiveMoves,blockedMoves,cars:R.cars.map(c=>({id:c.id,...(c.racecraftTelemetry||{})}))};
    if(prop==='strategyIntelligence')return{owner:'runtime-strategy-intelligence-v2',strategicCalls,pitRequests,pitEntries,cars:R.cars.map(c=>({id:c.id,...(c.strategyInsight||{})}))};
    return Reflect.get(target,prop,target);
  }});
}
