import {createRace as createV20Race} from './v20-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV20Race(W,statusEl,settings),baseUpdate=R.update,total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%total)+total)%total;
  const isHybrid=t=>['formula','hyper','lmh','proto'].includes(t);
  const wheelNames=['FL','FR','RL','RR'],stewardCases=[],neighbourCache=new Map();
  let strategyClock=0,driverClock=0,prevFlag=R.flag,scOrder=null,restartLock=0,caseId=0,standingsCache=[];
  R.trackEvolution={rubber:.08,marbles:0,dryLine:0};

  const event=(type,car,data={})=>{R.events?.push({id:`v24-${Date.now()}-${Math.random()}`,type,t:R.race.t,carId:car?.id??null,data});if(R.events?.length>100)R.events.shift();};
  const radio=(car,text,kind='ENGINEER_AI')=>{if(!R.radio)return;R.radio.push({id:`v24r-${Date.now()}-${Math.random()}`,t:R.race.t,carId:car?.id??null,name:car?.name||'RACE CONTROL',text,kind});while(R.radio.length>30)R.radio.shift();};
  function refreshNeighbours(){
    standingsCache=R.getStandings();neighbourCache.clear();const active=R.cars.filter(c=>!c.retired).sort((a,b)=>(a.s||0)-(b.s||0)),n=active.length;if(!n)return;
    for(let i=0;i<n;i++){const c=active[i],a=active[(i+1)%n],b=active[(i-1+n)%n],ad=a===c?Infinity:wrap((a.s||0)-(c.s||0)),bd=b===c?Infinity:wrap((c.s||0)-(b.s||0));neighbourCache.set(c.id,{ahead:a===c?null:a,aheadDist:ad,behind:b===c?null:b,behindDist:bd});}
  }
  function aheadOf(c){const x=neighbourCache.get(c.id);return x?{car:x.ahead,dist:x.aheadDist}:{car:null,dist:Infinity};}
  function behindOf(c){const x=neighbourCache.get(c.id);return x?{car:x.behind,dist:x.behindDist}:{car:null,dist:Infinity};}

  for(const c of R.cars){
    c.energyMode='BALANCED';c.ers=isHybrid(c.type)?1:0;c.liftCoast=0;c.slipstream=0;c.dirtyAir=0;
    c.wheelState=wheelNames.map(name=>({name,temp:c.tyreTemp||86,wear:c.wear||0,brake:c.brakeTemp||320,flat:0,puncture:false,nutIssue:false}));
    c.strategy={plan:'ONE STOP',window:'--',reason:'BASELINE',pitLoss:22,undercut:0,overcut:0,freeStop:false};
    c.driverState={confidence:.72,morale:.72,pressure:.28,fatigue:0};
    c._v24PitFailure=null;
  }

  function strategyUpdate(){
    const st=standingsCache.length?standingsCache:R.getStandings(),wet=W.env?.wetness||0,flag=R.flag;
    for(const c of st){
      if(c.retired)continue;
      const a=aheadOf(c),b=behindOf(c),lapsLeft=Math.max(0,R.race.lapsTarget-(c.lap||0));
      const tyreLife=Math.max(.2,(1-(c.wear||0))/Math.max(.01,.018+(c.driverFatigue||0)*.004));
      const cheap=['SC','VSC'].includes(flag),needWet=wet>.44&&c.compound!=='WET',needDry=wet<.18&&c.compound==='WET',worn=(c.wear||0)>.70;
      const gapAhead=a.car?a.dist/Math.max(10,c.v):99,gapBehind=b.car?b.dist/Math.max(10,b.car.v):99;
      const undercut=gapAhead<3.2&&gapBehind>2.2&&c.wear>.48?clamp((3.2-gapAhead)/3.2,0,1):0;
      const overcut=gapAhead<4&&c.wear<.48?clamp((.5-c.wear)*1.8,0,1):0;
      c.strategy.undercut=undercut;c.strategy.overcut=overcut;c.strategy.freeStop=cheap;c.strategy.window=tyreLife<lapsLeft?'OPEN':'EXTEND';
      c.strategy.reason=cheap?'SAFETY CAR WINDOW':needWet?'RAIN CROSSOVER':needDry?'DRY CROSSOVER':worn?'TYRE LIFE':undercut>.55?'UNDERCUT ATTACK':overcut>.55?'OVERCUT':'BASELINE';
      if(c.pitState==='NONE'&&c.lap>0&&c.s>total*.72&&(needWet||needDry||worn||(cheap&&c.wear>.45)||undercut>.72)){
        c.pitState='ENTRY';radio(c,`Box this lap. ${c.strategy.reason.toLowerCase()}.`,'STRATEGY');event('STRATEGY_CALL',c,{reason:c.strategy.reason});
      }
      const battle=gapAhead<2.2||gapBehind<1.6;c.energyMode=(lapsLeft<=2||(battle&&c.ers>.35))?'PUSH':(c.ers<.18||c.fuel<.18?'SAVE':'BALANCED');
    }
  }

  function energyAndTraffic(c,dt){
    if(c.retired)return;
    const load=clamp(W.braking?.(c.s)||0,0,1),a=aheadOf(c),straight=1-load,hybrid=isHybrid(c.type);let slip=0,dirty=0;
    if(a.car){const lat=Math.abs((a.car.lane||0)-(c.lane||0));if(a.dist<32&&lat<2.4){slip=clamp((32-a.dist)/32,0,1)*straight;dirty=clamp((24-a.dist)/24,0,1)*load*(c.type==='formula'?1:['hyper','lmh','proto'].includes(c.type)?.65:.32);}}
    c.slipstream=slip;c.dirtyAir=dirty;
    const mode=c.energyMode==='PUSH'?1:c.energyMode==='SAVE'?-1:0;
    if(hybrid){const deploy=(.010+.010*Math.max(0,mode))*dt*(.35+.65*straight),regen=(.006+.017*load)*dt;c.ers=clamp(c.ers-deploy+regen,0,1);c.hybridCharge=c.ers;}
    c.liftCoast=c.energyMode==='SAVE'?clamp(.14+Math.max(0,.25-c.fuel),.14,.30):0;
    const accelGain=slip*.42+(hybrid?Math.min(c.ers,.35)*(mode>0?.48:.18):0),dragLoss=dirty*(c.type==='formula'?1.15:.55),saveLoss=c.liftCoast*.9;
    c.v=clamp(c.v+(accelGain-dragLoss-saveLoss)*dt,0,(c.classPerformance?.top||90)*(1+slip*.025));
  }

  function wheelPhysics(c,dt){
    const load=clamp(W.braking?.(c.s)||0,0,1),turn=Math.sign((c.laneTarget||0)-(c.lane||0)),brake=c.brakeVisual||0,wet=W.env?.wetness||0;
    for(let i=0;i<4;i++){
      const w=c.wheelState[i],front=i<2,left=i%2===0,isOuter=turn===0?false:(turn>0?left:!left),outer=turn===0?0:(isOuter?1:-1),target=(c.tyreTemp||86)+(front?brake*8:brake*3)+outer*4+load*4-wet*3;
      w.temp+=(target-w.temp)*(1-Math.exp(-.8*dt));w.brake+=((c.brakeTemp||320)+(front?80:25)*brake-w.brake)*(1-Math.exp(-1.1*dt));w.wear=clamp(Math.max(w.wear,c.wear||0)+(outer>0?load*.00008:0),0,1);
      if(c.spinState==='LOCKUP'&&front)w.flat=clamp(w.flat+dt*.08,0,1);if(c.flatSpot)w.flat=Math.max(w.flat,.25);if(w.puncture)c.v=Math.min(c.v,18);
    }
    let wear=0;for(const w of c.wheelState)wear+=w.wear;c.wear=Math.max(c.wear||0,wear/4);
  }

  function trackEvolution(c,dt){const s=W.surfaceState||{},wet=W.env?.wetness||0;R.trackEvolution.rubber=s.rubber??clamp(R.trackEvolution.rubber+dt*(wet<.2?.0004:.00005),0,1);R.trackEvolution.dryLine=s.dryLine??R.trackEvolution.rubber*(1-wet*.75);R.trackEvolution.marbles=clamp(R.trackEvolution.marbles+dt*.00018*(1-wet),0,.55);const off=clamp((Math.abs(c.lane||0)-2.2)/1.8,0,1),lineGain=R.trackEvolution.dryLine*.018*(1-off),marbleLoss=R.trackEvolution.marbles*.055*off;c.trackEvolutionGrip=1+lineGain-marbleLoss;c.v*=1+(c.trackEvolutionGrip-1)*dt*.55;}
  function driverDynamics(c,dt){const d=c.driverState;if(!d)return;d.fatigue=clamp((c.driverFatigue||0)+R.race.t/7200,0,1);const posGain=clamp((10-(c.position||10))/20,-.2,.35),a=aheadOf(c),b=behindOf(c);d.confidence=clamp(d.confidence+(posGain-d.pressure*.12)*dt*.002,0,1);d.pressure=clamp(.15+(c.position<=3?.20:0)+(a.dist<18?.28:0)+(b.dist<14?.30:0)+d.fatigue*.18,0,1);d.morale=clamp(d.morale+(d.confidence-.5)*dt*.0015,0,1);if(c.driver)c.driver.aggression=clamp((c.driver.aggression||.6)+((d.confidence-.5)-(d.pressure-.5))*.0008,.35,.96);}
  function addCase(type,car,other,severity=.5){const item={id:++caseId,type,carId:car?.id??null,otherId:other?.id??null,t:R.race.t,status:'NOTED',timer:2.5+severity*3,severity};stewardCases.push(item);if(stewardCases.length>30)stewardCases.shift();event('INCIDENT_NOTED',car,{caseId:item.id,type});return item;}
  function stewardUpdate(dt){for(const x of stewardCases){if(x.status==='CLOSED')continue;x.timer-=dt;if(x.status==='NOTED'&&x.timer<1.8){x.status='INVESTIGATING';event('UNDER_INVESTIGATION',R.cars[x.carId],{caseId:x.id,type:x.type});}if(x.timer<=0){const c=R.cars[x.carId];let sec=0;if(x.type==='CAUSING_COLLISION')sec=x.severity>.75?10:5;else if(x.type==='UNSAFE_RELEASE'||x.type==='YELLOW_OVERTAKE')sec=5;if(c&&sec){c.penaltySeconds=(c.penaltySeconds||0)+sec;radio(c,`${sec} second penalty. ${x.type.toLowerCase().replaceAll('_',' ')}.`,'PENALTY');event('PENALTY',c,{seconds:sec,reason:x.type});}x.status='CLOSED';}}}
  // v38: legacy lane/distance collision physics is intentionally retired. Physical OBB contact owns all car-to-car damage.
  function contactPhysics(){}
  function pitFailures(c,beforeState){if(beforeState!=='STOP'&&c.pitState==='STOP'&&!c._v24PitFailure){const chance=.025*Math.max(.3,Number(settings.failures??1));if(Math.random()<chance){const r=Math.random(),type=r<.45?'WHEEL NUT':r<.72?'JACK':r<.90?'TYRE DELAY':'RELEASE HOLD',delay=type==='WHEEL NUT'?2+Math.random()*3:type==='JACK'?1.5+Math.random()*2.5:type==='TYRE DELAY'?2.5+Math.random()*4:1+Math.random()*2;c._v24PitFailure={type,delay};c.pitTimer+=delay;if(type==='WHEEL NUT')c.wheelState[(Math.random()*4)|0].nutIssue=true;event('PIT_PROBLEM',c,{type,delay});radio(c,`${type.toLowerCase()} problem. Hold position.`,'URGENT');}}if(beforeState==='STOP'&&c.pitState!=='STOP'){const b=behindOf(c);if(b.car&&b.dist<18&&b.car.pitState==='NONE')addCase('UNSAFE_RELEASE',c,b.car,.55);c._v24PitFailure=null;for(const w of c.wheelState){w.nutIssue=false;w.puncture=false;w.wear=0;w.flat=0;w.temp=c.compound==='WET'?72:82;}}}
  function restartRules(dt){if(prevFlag!=='SC'&&R.flag==='SC')scOrder=(standingsCache.length?standingsCache:R.getStandings()).map(c=>c.id);if(prevFlag==='SC'&&R.flag==='GREEN'){restartLock=3.2;event('SC_RESTART_RULES',null,{seconds:restartLock});}if(restartLock>0)restartLock=Math.max(0,restartLock-dt);if((R.flag==='SC'||restartLock>0)&&scOrder){for(const c of R.cars){const target=scOrder.indexOf(c.id);if(target>=0&&c.position<target+1){c.v=Math.min(c.v,R.flag==='SC'?28:42);c.laneTarget*=.85;}}}prevFlag=R.flag;}
  function yellowOvertakes(prevPos){if(!['YELLOW','SC','VSC'].includes(R.flag))return;for(const c of R.cars){const p=prevPos[c.id];if(Number.isFinite(p)&&c.position<p&&!c.retired){const x=stewardCases.find(s=>s.type==='YELLOW_OVERTAKE'&&s.carId===c.id&&s.status!=='CLOSED');if(!x)addCase('YELLOW_OVERTAKE',c,null,.45);}}}
  function update(dt){const prevPos=Object.fromEntries(R.cars.map(c=>[c.id,c.position])),prevPit=R.cars.map(c=>c.pitState);baseUpdate(dt);refreshNeighbours();strategyClock+=dt;driverClock+=dt;if(strategyClock>=1.2){strategyClock=0;strategyUpdate();}for(let i=0;i<R.cars.length;i++){const c=R.cars[i];energyAndTraffic(c,dt);wheelPhysics(c,dt);trackEvolution(c,dt);pitFailures(c,prevPit[i]);if(driverClock>=.5)driverDynamics(c,.5);}if(driverClock>=.5)driverClock=0;contactPhysics();yellowOvertakes(prevPos);stewardUpdate(dt);restartRules(dt);}
  refreshNeighbours();
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='stewardCases')return stewardCases;if(prop==='trackEvolution')return R.trackEvolution;if(prop==='spatialNeighbours')return neighbourCache;if(prop==='standingsCache')return standingsCache;return Reflect.get(target,prop,target);}});
}
