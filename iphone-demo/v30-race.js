import {createRace as createV29Race} from './v29-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV29Race(W,statusEl,settings),baseUpdate=R.update,total=W.total;
  const plans=new Map(),admissions=[];
  const PIT_CAPACITY=4,ADMIT_WINDOW=3,ADMIT_MAX=2,TEAM_GAP=7;

  function emergency(c){
    const wet=W.env?.wetness||0,puncture=c.fault==='PUNCTURE'||(c.wheelState||[]).some(w=>w.puncture);
    const tyreCritical=(c.wear||0)>.90,lowFuel=(c.fuel??1)<.075,heavyDamage=(c.damage||0)>.72;
    const wrongWet=wet>.64&&c.compound!=='WET',wrongDry=wet<.08&&c.compound==='WET';
    return puncture||tyreCritical||lowFuel||heavyDamage||wrongWet||wrongDry;
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
  function defer(c,eventStart,radioStart,why){
    const p=planFor(c);p.deferred++;p.holdReason=why;
    c.pitState='NONE';c.pitTimer=0;c.pitLaneStatus='TRACK';c.laneTarget*=.82;
    if(c.strategy){c.strategy.window='HOLD';c.strategy.reason=why;}
    removeNewPitMessages(c.id,eventStart,radioStart);
  }
  function admit(c){
    const p=planFor(c);admissions.push(R.race.t);p.admittedAt=R.race.t;p.holdReason='';
    if(c.strategy)c.strategy.reason=p.reason;
  }
  function canAdmit(c){
    if(emergency(c))return{ok:true,why:'EMERGENCY'};
    cleanAdmissions();const p=planFor(c);
    if(R.race.t<p.earliest)return{ok:false,why:'PIT WINDOW STAGGER'};
    if(c._v30LastPitLap!=null&&(c.lap||0)-c._v30LastPitLap<1.25)return{ok:false,why:'RECENT STOP'};
    if(teamBusy(c))return{ok:false,why:'TEAM BOX OCCUPIED'};
    const mateRecent=R.cars.some(o=>o!==c&&o.teamId===c.teamId&&Number.isFinite(o._v30PitAdmitAt)&&R.race.t-o._v30PitAdmitAt<TEAM_GAP);
    if(mateRecent)return{ok:false,why:'DOUBLE STACK AVOIDANCE'};
    if(activePitCars(c.id).length>=PIT_CAPACITY)return{ok:false,why:'PIT LANE TRAFFIC'};
    if(admissions.length>=ADMIT_MAX)return{ok:false,why:'PIT LANE TRAFFIC'};
    return{ok:true,why:'CLEAR'};
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
    if(prop==='pitTraffic')return{active:activePitCars().map(c=>c.id),recentAdmissions:[...admissions],plans:[...plans].map(([carId,p])=>({carId,...p}))};
    return Reflect.get(target,prop,target);
  }});
}
