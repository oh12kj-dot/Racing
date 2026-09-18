import {createRace as createV29Race} from './v29-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV29Race(W,statusEl,settings),baseUpdate=R.update,total=W.total;
  const plans=new Map(),admissions=[];
  const PIT_CAPACITY=4,ADMIT_WINDOW=3,ADMIT_MAX=2,TEAM_GAP=7;
  const shortRace=(R.race?.lapsTarget||0)<=10;

  const faultText=c=>String(c?.fault||'').toUpperCase();
  function hasPuncture(c){return faultText(c)==='PUNCTURE'||(c.wheelState||[]).some(w=>w?.puncture);}
  function hasIncidentDamage(c){
    const f=faultText(c),zones=c.damageZones||{};
    return (c.damage||0)>=.28||(zones.suspension||0)>=.38||f.includes('CRASH DAMAGE')||f.includes('SUSPENSION DAMAGE')||f==='CRASH';
  }
  function hasServiceableMechanicalFault(c){
    const f=faultText(c);if(!f||hasPuncture(c)||f.includes('CRASH')||f.includes('SUSPENSION'))return false;
    return ['ENGINE','BRAKE','ELECTRICAL','GEARBOX','HYDRAULIC','POWER','COOLING','MECHANICAL'].some(x=>f.includes(x));
  }
  function urgentWeather(c){
    const wet=Number(W.env?.wetness)||0,compound=String(c.compound||c.tyreCompound||'').toUpperCase();
    return (wet>.68&&compound!=='WET')||(wet<.06&&compound==='WET');
  }
  function firstLapCause(c){
    if(c._driveThroughServing)return'DRIVE THROUGH';
    if(hasPuncture(c))return'PUNCTURE';
    if(hasIncidentDamage(c))return'DAMAGE';
    if(hasServiceableMechanicalFault(c))return'MECHANICAL';
    if(urgentWeather(c))return'WEATHER';
    return'';
  }
  function hardEmergency(c){
    return !!firstLapCause(c)||(c.wear||0)>.94||(c.fuel??1)<.055||(c.damage||0)>.82;
  }
  function activePitCars(exceptId=-1){return R.cars.filter(c=>c.id!==exceptId&&!c.retired&&c.pitState!=='NONE');}
  function teamBusy(c){return R.cars.some(o=>o!==c&&!o.retired&&o.teamId===c.teamId&&o.pitState!=='NONE');}
  function cleanAdmissions(){while(admissions.length&&R.race.t-admissions[0]>ADMIT_WINDOW)admissions.shift();}
  function reasonFor(c){
    const first=firstLapCause(c);if(first)return first;
    const wet=W.env?.wetness||0;if(hasPuncture(c))return'PUNCTURE';
    if(hasIncidentDamage(c))return'DAMAGE';if(hasServiceableMechanicalFault(c))return'MECHANICAL';
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
    c.pitState='NONE';c.pitTimer=0;c.pitLaneStatus='TRACK';if(W.runtimeRacecraftAuthority!=='runtime-racecraft-v2')c.laneTarget*=.82;
    if(c.strategy){c.strategy.window='HOLD';c.strategy.reason=why;}
    removeNewPitMessages(c.id,eventStart,radioStart);
  }
  function admit(c){
    const p=planFor(c);admissions.push(R.race.t);p.admittedAt=R.race.t;p.holdReason='';
    if(c.strategy)c.strategy.reason=p.reason;
  }
  function canAdmit(c){
    cleanAdmissions();const p=planFor(c),first=firstLapCause(c),hard=hardEmergency(c),weather=urgentWeather(c),runtimeTraffic=!!W.runtimePitStateMachineOwner,clustered=weather||['SC','VSC'].includes(R.flag);
    // Real-race rule: a lap-one/launch stop is legal only when an actual event
    // justifies it. Do not use a blanket time ban: contact damage, punctures,
    // serviceable mechanical faults, drive-throughs and genuine weather mismatch
    // can all require an immediate stop in real motorsport.
    if((c.lap||0)<1){
      if(!first)return{ok:false,why:'NO FIRST-LAP PIT CAUSE'};
      return{ok:true,why:`FIRST-LAP ${first}`};
    }
    if(hard)return{ok:true,why:'EMERGENCY'};
    if(!routineStopMakesSense(c))return{ok:false,why:'STAY OUT · SHORT RACE'};
    if(!clustered&&R.race.t<p.earliest)return{ok:false,why:'PIT WINDOW STAGGER'};
    if(c._v30LastPitLap!=null&&(c.lap||0)-c._v30LastPitLap<1.5)return{ok:false,why:'RECENT STOP'};

    // When the stable runtime pit controller is present, this legacy layer owns
    // only strategy intent/admission timing. Team-box occupancy, double-stack
    // queuing, total pit traffic and safe release are exclusively handled by
    // runtime/pit-state.js. Keeping the old gates here would prevent the runtime
    // state machine from ever seeing realistic clustered pit stops.
    if(runtimeTraffic)return{ok:true,why:clustered?'RUNTIME CLUSTERED PIT':'RUNTIME PIT CONTROL'};

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
    if(prop==='pitTraffic')return{active:activePitCars().map(c=>c.id),recentAdmissions:[...admissions],plans:[...plans].map(([carId,p])=>({carId,...p})),shortRace,runtimeOwner:W.runtimePitStateMachineOwner||null};
    return Reflect.get(target,prop,target);
  }});
}
