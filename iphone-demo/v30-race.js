import {createRace as createV29Race} from './v29-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV29Race(W,statusEl,settings),baseUpdate=R.update,total=W.total;
  const plans=new Map(),admissions=[];
  const PIT_CAPACITY=4,ADMIT_WINDOW=3,ADMIT_MAX=2,TEAM_GAP=7;
  const shortRace=(R.race?.lapsTarget||0)<=10;

  function hardEmergency(c){
    const puncture=c.fault==='PUNCTURE'||(c.wheelState||[]).some(w=>w.puncture);
    return puncture||(c.wear||0)>.94||(c.fuel??1)<.055||(c.damage||0)>.82;
  }
  function urgentWeather(c){
    const wet=W.env?.wetness||0;
    return (wet>.68&&c.compound!=='WET')||(wet<.06&&c.compound==='WET');
  }
  function activePitCars(exceptId=-1){return R.cars.filter(c=>c.id!==exceptId&&!c.retired&&c.pitState!=='NONE');}
  function teamBusy(c){return R.cars.some(o=>o!==c&&!o.retired&&o.teamId===c.teamId&&o.pitState!=='NONE');}
  function cleanAdmissions(){while(admissions.length&&R.race.t-admissions[0]>ADMIT_WINDOW)admissions.shift();}
  function reasonFor(c){
    const wet=W.env?.wetness||0;if(c.fault==='PUNCTURE'||(c.wheelState||[]).some(w=>w.puncture))return'PUNCTURE';
    if(wet>.45&&c.compound!=='WET')return'RAIN';if(wet<.18&&c.compound==='WET')return'DRY';
    if((c.wear||0)>.70)return'TYRE LIFE';if(['SC','VSC'].includes(R.flag))return'SAFETY CAR WINDOW';
    return c.strategy?.reason||'STRATEGY';
  }
  function planFor(c){
    let p=plans.get(c.id);if(p)return p;
    const jitter=((c.id*37)%17)*.31,teamOffset=(c.id%2)*2.4;
    p={requestedAt:R.race.t,earliest:R.race.t+1.3+jitter+teamOffset,reason:reasonFor(c),deferred:0};plans.set(c.id,p);return p;
  }
  function removeNewPitMessages(carId,eventStart,radioStart){
    if(Array.isArray(R.events))for(let i=R.events.length-1;i>=eventStart;i--){const e=R.events[i];if(e?.carId===carId&&['PIT_CALL','STRATEGY_CALL','RADAR_STRATEGY'].includes(e.type))R.events.splice(i,1);}
    if(Array.isArray(R.radio))for(let i=R.radio.length-1;i>=radioStart;i--){const m=R.radio[i],t=String(m?.text||'').toLowerCase();if(m?.carId===carId&&(t.includes('box')||m.kind==='STRATEGY'))R.radio.splice(i,1);}
  }
  function routineStopMakesSense(c){
    if(hardEmergency(c)||urgentWeather(c))return true;
    const lapsLeft=Math.max(0,(R.race?.lapsTarget||0)-Math.max(0,c.lap||0)),wear=c.wear||0,reason=reasonFor(c);
    if((c.lap||0)<1)return false;
    if(shortRace){
      if(lapsLeft<=2&&wear<.88)return false;
      if(reason==='SAFETY CAR WINDOW'&&wear<.64)return false;
      if(reason==='TYRE LIFE'&&wear<.76)return false;
      if(reason==='STRATEGY'&&wear<.72)return false;
    }
    return true;
  }
  function defer(c,eventStart,radioStart,why){
    const p=planFor(c);p.deferred++;p.holdReason=why;p.earliest=Math.max(p.earliest,R.race.t+(why==='STAY OUT · SHORT RACE'?7:2.8));
    c.pitState='NONE';c.pitTimer=0;c.pitLaneStatus='TRACK';c.laneTarget*=.82;
    if(c.strategy){c.strategy.window='HOLD';c.strategy.reason=why;}
    removeNewPitMessages(c.id,eventStart,radioStart);
  }
  function admit(c){
    const p=planFor(c);admissions.push(R.race.t);p.admittedAt=R.race.t;p.holdReason='';
    if(c.strategy)c.strategy.reason=p.reason;
  }
  function canAdmit(c){
    cleanAdmissions();const p=planFor(c),hard=hardEmergency(c),weather=urgentWeather(c);
    if(hard)return{ok:true,why:'EMERGENCY'};
    if(!routineStopMakesSense(c))return{ok:false,why:'STAY OUT · SHORT RACE'};
    if(!weather&&R.race.t<p.earliest)return{ok:false,why:'PIT WINDOW STAGGER'};
    if(c._v30LastPitLap!=null&&(c.lap||0)-c._v30LastPitLap<1.5)return{ok:false,why:'RECENT STOP'};
    if(!weather&&teamBusy(c))return{ok:false,why:'TEAM BOX OCCUPIED'};
    const mateRecent=R.cars.some(o=>o!==c&&o.teamId===c.teamId&&Number.isFinite(o._v30PitAdmitAt)&&R.race.t-o._v30PitAdmitAt<TEAM_GAP);
    if(!weather&&mateRecent)return{ok:false,why:'DOUBLE STACK AVOIDANCE'};
    const capacity=weather?PIT_CAPACITY+1:PIT_CAPACITY,rate=weather?ADMIT_MAX+1:ADMIT_MAX;
    if(activePitCars(c.id).length>=capacity)return{ok:false,why:'PIT LANE TRAFFIC'};
    if(admissions.length>=rate)return{ok:false,why:'PIT LANE TRAFFIC'};
    return{ok:true,why:weather?'WEATHER PRIORITY':'CLEAR'};
  }

  function update(dt){
    const prev=R.cars.map(c=>c.pitState),eventStart=R.events?.length||0,radioStart=R.radio?.length||0;
    baseUpdate(dt);cleanAdmissions();
    for(let i=0;i<R.cars.length;i++){
      const c=R.cars[i];if(c.retired)continue;
      if(prev[i]==='EXIT'&&c.pitState==='NONE'){c._v30LastPitLap=c.lap||0;c._v30LastPitAt=R.race.t;plans.delete(c.id);}
      if(prev[i]==='NONE'&&c.pitState==='ENTRY'){
        const gate=canAdmit(c);
        if(gate.ok){admit(c);c._v30PitAdmitAt=R.race.t;}
        else defer(c,eventStart,radioStart,gate.why);
      }
      const p=plans.get(c.id);if(p&&c.pitState==='NONE'&&c.strategy&&p.holdReason){c.strategy.window='HOLD';c.strategy.reason=p.holdReason;}
    }
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='pitTraffic')return{active:activePitCars().map(c=>c.id),recentAdmissions:[...admissions],plans:[...plans].map(([carId,p])=>({carId,...p})),shortRace};
    return Reflect.get(target,prop,target);
  }});
}
