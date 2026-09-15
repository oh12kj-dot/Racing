import {createRace as createStrategyRace} from './race-strategy-dynamics.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const phases=new Set(['HUNT','PRESSURE','FEINT','ATTACK','SWITCHBACK','RESET','DEFEND']);

export function createRace(W,statusEl,settings={}){
  const R=createStrategyRace(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,Number(W.total)||1);
  const engagements=new Map(),strategy=new Map(),perfSaved=new Map();
  let updates=0,attackAttempts=0,feints=0,switchbacks=0,defensiveMoves=0,strategicCalls=0;

  const progress=c=>(Number(c?.lap)||0)*total+(Number(c?.s)||0);
  const gapSeconds=(a,b)=>{
    if(!a||!b)return Infinity;let d=progress(a)-progress(b);if(d<0)d+=total;
    return d/Math.max(12,Number(b.v)||12);
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
  function cornerSignal(c,meters=55){return Number(W.racingCurvatureAt?.((c.s||0)+meters)??W.curvatureAt?.((c.s||0)+meters))||0;}
  function brakingLoad(c,meters=35){return clamp(Number(W.braking?.((c.s||0)+meters))||0,0,1);}
  function savePerf(c){perfSaved.set(c.id,{max:c._v18BaseMax,accel:c._v18BaseAccel});}
  function restorePerf(c){const x=perfSaved.get(c.id);if(!x)return;c._v18BaseMax=x.max;c._v18BaseAccel=x.accel;perfSaved.delete(c.id);}
  function applyPace(c,mult){
    if(Number.isFinite(Number(c._v18BaseMax)))c._v18BaseMax*=mult;
    if(Number.isFinite(Number(c._v18BaseAccel)))c._v18BaseAccel*=clamp(.997+(mult-1)*.45,.985,1.012);
    c.racecraftPaceMultiplier=mult;
  }
  function prepareRacecraft(c,dt){
    if(!c||c.retired)return;savePerf(c);const s=stateFor(c),t=s.traits,{ahead,behind}=neighbours(c),now=R.race?.t||0;
    const raceActive=R.flag==='GREEN'&&R.sessionPhase==='RACE'&&c.pitState==='NONE'&&c.spinState==='NONE'&&!c.hazardAvoiding;
    if(!raceActive){c.racecraftIntent='RESET';c.battleState='NONE';applyPace(c,1);return;}
    const aheadGap=ahead?gapSeconds(ahead,c):Infinity,behindGap=behind?gapSeconds(c,behind):Infinity,closing=ahead?Math.max(-12,Math.min(12,(c.v||0)-(ahead.v||0))):0;
    const load=brakingLoad(c),curv=cornerSignal(c),draft=Number(c.slipstream)||0;
    s.targetId=ahead?.id??null;s.pressure=clamp((2.2-aheadGap)/2.2,0,1);

    if(ahead&&aheadGap<2.2){
      if(s.phase==='HUNT'&&aheadGap<1.45)transition(c,s,'PRESSURE','CLOSE ENOUGH TO PRESSURE',1.8+t.patience*1.8);
      if(s.phase==='PRESSURE'&&now>=s.phaseUntil){
        const attackReadiness=clamp((1.6-aheadGap)*.48+draft*.65+Math.max(0,closing)*.035+(t.overtake-1)*1.5,.05,.96);
        const feintBias=.25+(1-t.patience)*.22+(deterministic(c.id,Math.floor(now/3))-.5)*.16;
        if(attackReadiness>.54&&load<.72)transition(c,s,deterministic(c.id,s.attempts+7)<feintBias?'FEINT':'ATTACK','ATTACK WINDOW',1.05);
        else transition(c,s,'PRESSURE','WAIT FOR BETTER EXIT',1.5+t.patience*1.8);
      }
      if(s.phase==='FEINT'&&now>=s.phaseUntil)transition(c,s,'ATTACK','FEINT COMPLETE',1.15);
      if(s.phase==='ATTACK'&&now>=s.phaseUntil){
        if(load>.48&&aheadGap<.95)transition(c,s,'SWITCHBACK','CROSSOVER EXIT',.9);
        else transition(c,s,'RESET','ATTACK COMPLETE',.75);
      }
      if(s.phase==='SWITCHBACK'&&now>=s.phaseUntil)transition(c,s,'RESET','SWITCHBACK COMPLETE',.65);
      if(s.phase==='RESET'&&now>=s.phaseUntil)transition(c,s,aheadGap<1.7?'PRESSURE':'HUNT','RESET COMPLETE',1.2);
    }else if(s.phase!=='HUNT'&&s.phase!=='RESET'){transition(c,s,'RESET','GAP OPENED',.7);}else if(s.phase==='RESET'&&now>=s.phaseUntil)transition(c,s,'HUNT','GAP OPENED',1);

    let target=c.laneTarget||0,mult=1;
    if(s.phase==='HUNT'&&ahead){target+=(ahead.lane-target)*clamp(dt*.30,0,.025);mult=1.002;}
    if(s.phase==='PRESSURE'&&ahead){target+=(ahead.lane-target)*clamp(dt*.52,0,.045);mult=1.004+(t.overtake-1)*.028;}
    if(s.phase==='FEINT'&&ahead){
      const side=s.moveSide*(Math.abs(curv)>.0018?2.25:2.75);target+=(side-target)*clamp(dt*2.8,0,.18);mult=1.006;
    }
    if(s.phase==='ATTACK'&&ahead){
      const inside=Math.sign(curv||s.moveSide)*2.65,away=(ahead.lane||0)>=0?-2.75:2.75;
      const attackLane=Math.abs(curv)>.0018&&t.braking>1?inside:away;target+=(attackLane-target)*clamp(dt*(2.0+t.aggression),0,.20);mult=1.008+(t.overtake-1)*.045+draft*.006;
    }
    if(s.phase==='SWITCHBACK'&&ahead){const switchLane=clamp(-(ahead.lane||s.moveSide*1.5)*.92,-2.85,2.85);target+=(switchLane-target)*clamp(dt*3.0,0,.22);mult=1.010;}
    if(s.phase==='RESET'){target*=Math.max(.92,1-dt*.7);mult=.998;}

    if(behind&&behindGap<1.10&&behind.battleState==='ATTACK'&&now-s.lastDefenseAt>3.4&&load<.65){
      const threat=stateFor(behind),oneMove=clamp(-(threat.moveSide||1)*1.45,-1.55,1.55);target+=(oneMove-target)*clamp(dt*1.8*t.defense,0,.12);s.lastDefenseAt=now;defensiveMoves++;c.battleState='DEFEND';c.racecraftIntent='DEFEND';
    }else{c.battleState=['ATTACK','FEINT','SWITCHBACK'].includes(s.phase)?'ATTACK':s.phase==='PRESSURE'?'PRESSURE':'NONE';c.racecraftIntent=s.phase;}
    c.laneTarget=clamp(target,-3.35,3.35);applyPace(c,clamp(mult,.985,1.018));
    c.racecraftTelemetry={phase:s.phase,targetId:s.targetId,aheadGapSec:Number.isFinite(aheadGap)?aheadGap:null,behindGapSec:Number.isFinite(behindGap)?behindGap:null,closingMps:closing,pressure:s.pressure,attempts:s.attempts,style:t.style,aggression:t.aggression,patience:t.patience,composure:t.composure,overtake:t.overtake,defense:t.defense};
  }

  function estimateProjectedPosition(c,pitLossSec,standings){
    const me=progress(c),speed=Math.max(18,Number(c.v)||18),lossM=pitLossSec*speed;let pos=1;
    for(const o of standings){if(o===c||o.retired)continue;let d=me-progress(o);if(d<0)d+=total;if(d<lossM)pos++;}
    return clamp(pos,1,standings.length||1);
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
    c.strategyInsight={mode:s.mode,reason:s.reason,pitWindow:[s.windowStart,s.windowEnd],undercut:s.undercut,overcut:s.overcut,projectedAfterPit:s.projectedAfterPit,pitLossSec:s.pitLoss,safeToBox:s.safeToBox,confidence:s.confidence,lapsLeft};

    const nearEntry=(Number(c.s)||0)>total*.73,callLap=Math.floor(lap),canCall=R.flag==='GREEN'&&R.sessionPhase==='RACE'&&c.pitState==='NONE'&&lap>0&&lapsLeft>1&&nearEntry&&s.lastCallLap!==callLap;
    const tactical=(s.mode==='UNDERCUT'&&s.undercut>.68&&wear>.54)||(s.mode==='COVER'&&wear>.66),required=criticalWear||fuelLow;
    if(canCall&&(required||tactical)){
      c.pitState='ENTRY';c.pitTimer=0;c.strategy=c.strategy||{};c.strategy.window='BOX';c.strategy.reason=s.reason;s.lastCallLap=callLap;s.lastCallAt=R.race?.t||0;strategicCalls++;
      R.events?.push?.({id:`spectator-strategy-${c.id}-${Date.now()}`,type:'STRATEGY_CALL',t:R.race?.t||0,carId:c.id,data:{mode:s.mode,reason:s.reason,projectedAfterPit:s.projectedAfterPit,confidence:s.confidence}});
      if(Array.isArray(R.radio))R.radio.push({id:`spectator-radio-${c.id}-${Date.now()}`,t:R.race?.t||0,carId:c.id,name:`${c.team||'TEAM'} ENGINEER`,kind:'STRATEGY',text:s.mode==='UNDERCUT'?`Box this lap. Undercut opportunity. Target exit position ${s.projectedAfterPit}.`:`Box this lap. ${s.reason}. Target exit position ${s.projectedAfterPit}.`});
    }
  }

  function update(dt){
    const step=clamp(Number(dt)||.016,.001,.05);for(const c of R.cars)prepareRacecraft(c,step);
    try{baseUpdate(dt);}finally{for(const c of R.cars)restorePerf(c);}
    for(const c of R.cars)updateStrategy(c);updates++;
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='racecraftFor')return id=>{const s=engagements.get(Number(id));return s?{...s,traits:{...s.traits}}:null;};
    if(prop==='strategyInsightFor')return id=>{const s=strategy.get(Number(id));return s?{...s}:null;};
    if(prop==='racecraftDynamics')return{owner:'runtime-racecraft-v2',updates,attackAttempts,feints,switchbacks,defensiveMoves,cars:R.cars.map(c=>({id:c.id,...(c.racecraftTelemetry||{})}))};
    if(prop==='strategyIntelligence')return{owner:'runtime-strategy-intelligence-v2',strategicCalls,cars:R.cars.map(c=>({id:c.id,...(c.strategyInsight||{})}))};
    return Reflect.get(target,prop,target);
  }});
}
