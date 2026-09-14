import {createRace as createV7Race} from './v7-race.js';

export function createRace(W,statusEl){
  const base=createV7Race(W,statusEl);
  const T=W.THREE,total=W.total,wrap=v=>((v%total)+total)%total;
  const events=base.events;
  const extraRadio=[];
  const pointsTable=[25,18,15,12,10,8,6,4,2,1];
  const rounds=[
    {name:'SUZUKA GP',time:14.2,wet:.00,cloud:.15,rain:0},
    {name:'SUZUKA CLOUD',time:15.3,wet:.04,cloud:.62,rain:0},
    {name:'SUZUKA WET',time:13.4,wet:.54,cloud:.88,rain:.55},
    {name:'SUZUKA SUNSET',time:17.2,wet:.08,cloud:.35,rain:0},
    {name:'SUZUKA FINAL',time:14.7,wet:.18,cloud:.52,rain:.08}
  ];
  const teams=[
    {name:'APEX',color:0xe3312d,power:1.025,aero:1.018,brake:1.012,tyre:1.00,wet:1.00,reliability:.988},
    {name:'VORTEX',color:0x287de1,power:1.018,aero:1.025,brake:1.008,tyre:1.01,wet:1.01,reliability:.991},
    {name:'ORION',color:0xf2c52f,power:1.010,aero:1.010,brake:1.022,tyre:1.02,wet:.99,reliability:.993},
    {name:'SAKURA',color:0xf3f3f3,power:1.004,aero:1.018,brake:1.015,tyre:1.03,wet:1.02,reliability:.994},
    {name:'TITAN',color:0x20bd7b,power:1.022,aero:.998,brake:1.000,tyre:.99,wet:1.00,reliability:.986},
    {name:'NOVA',color:0x9362df,power:.997,aero:1.012,brake:1.006,tyre:1.02,wet:1.03,reliability:.992},
    {name:'FALCON',color:0xed7b27,power:1.008,aero:1.004,brake:.998,tyre:1.01,wet:.98,reliability:.989},
    {name:'HELIX',color:0x22aab8,power:.994,aero:1.008,brake:1.012,tyre:1.00,wet:1.02,reliability:.995},
    {name:'VECTOR',color:0xe04a90,power:1.002,aero:.996,brake:1.004,tyre:.99,wet:1.01,reliability:.990},
    {name:'PULSE',color:0xaeb6c1,power:.992,aero:1.002,brake:.997,tyre:1.02,wet:1.00,reliability:.996}
  ];
  const storageKey='racing_suzuka_championship_v2';
  function loadSeason(){try{const x=JSON.parse(localStorage.getItem(storageKey)||'null');if(x&&Array.isArray(x.driverPoints)&&x.driverPoints.length===20)return x;}catch{}return{round:0,driverPoints:Array(20).fill(0),teamPoints:Array(10).fill(0)};}
  function saveSeason(){try{localStorage.setItem(storageKey,JSON.stringify(season));}catch{}}
  const season=loadSeason();season.round=Math.max(0,Math.min(rounds.length-1,season.round|0));
  const round=rounds[season.round];
  if(W.env){W.env.timeOfDay=round.time;W.env.wetness=round.wet;W.env.cloud=round.cloud;W.env.rain=round.rain;}

  let radioId=0;
  function pushRadio(car,text,kind='INFO'){
    extraRadio.push({id:++radioId,t:base.race.t,carId:car?.id??null,name:car?.name||'RACE CONTROL',text,kind});
    while(extraRadio.length>12)extraRadio.shift();
  }
  function emit(type,car,data={}){
    events.push({id:`v8-${Date.now()}-${Math.random()}`,type,t:base.race.t,carId:car?.id??null,data});
    while(events.length>80)events.shift();
  }
  function recolorCar(c,color){
    c.mesh.traverse?.(o=>{const m=o.material;if(!m||Array.isArray(m))return;if(m.isMeshPhysicalMaterial&&!m.transparent&&m.clearcoat>.5){m.color.setHex(color);m.needsUpdate=true;}});
  }

  // 1) Championship + 3) teams + 4) machine performance.
  base.cars.forEach((c,i)=>{
    const teamId=Math.floor(i/2),team=teams[teamId];
    c.teamId=teamId;c.team=team.name;c.teamColor=team.color;
    c.machine={power:team.power,aero:team.aero,brake:team.brake,tyre:team.tyre,wet:team.wet,reliability:team.reliability};
    c.baseMaxNominal=c.baseMax*team.power*(.985+.015*team.aero);
    c.accelNominal=c.accel*team.power;
    c.brakeNominal=c.brake*team.brake;
    c.driver.tireCare=Math.max(.65,Math.min(.99,c.driver.tireCare*team.tyre));
    c.driver.wetSkill=Math.max(.65,Math.min(.99,c.driver.wetSkill*team.wet));
    c.fault=null;c.faultFactor=1;c.drsEligible=false;c.drsActive=false;c.battleState='CLEAR';
    c.lastSectors=[null,null,null];c.bestSectors=[Infinity,Infinity,Infinity];c.sectorIndex=0;c.sectorStart=0;
    c.radioWarnings={wear60:false,wear80:false,drs:false};
    recolorCar(c,team.color);
  });

  // 2) Qualifying: simulated session determines the actual starting grid.
  const qualifying=base.cars.map(c=>{
    const machine=(c.machine.power+c.machine.aero+c.machine.brake)/3;
    const wetPenalty=round.wet>.35?(1-c.driver.wetSkill)*2.4:0;
    const time=90.7-(c.driver.racecraft-.75)*4.0-(machine-1)*24+wetPenalty+Math.random()*.72;
    return{carId:c.id,time};
  }).sort((a,b)=>a.time-b.time);
  function poseGrid(){
    qualifying.forEach((q,pos)=>{
      const c=base.cars[q.carId],row=Math.floor(pos/2),col=pos%2;
      c.s=wrap(-row*12.4);c.lap=0;c.v=0;c.position=pos+1;c.prevPosition=pos+1;
      c.lane=(col?-1:1)*2.55+(row%2?.14:-.14);c.laneTarget=c.lane;
      const p=W.sample(c.s,c.lane);c.mesh.position.copy(p.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(p.t.x,p.t.z);
    });
  }
  poseGrid();
  let sessionPhase='QUALIFYING',qualifyingClock=0,raceStarted=false;
  pushRadio(base.cars[qualifying[0].carId],`POLE POSITION · ${qualifying[0].time.toFixed(3)}s`,'QUALI');

  // 5) DRS zones.
  const drsZones=[[.955,1],[0,.075],[.555,.635]];
  function inDRSZone(c){const f=c.s/total;return drsZones.some(([a,b])=>f>=a&&f<=b);}
  function nearestAhead(c){let car=null,dist=Infinity;for(const o of base.cars){if(o===c||o.retired)continue;const d=wrap(o.s-c.s);if(d>0&&d<dist){dist=d;car=o;}}return{car,dist};}
  function prepareDRSAndBattle(){
    const green=base.flag==='GREEN';
    for(const c of base.cars){
      if(c.retired)continue;
      const a=nearestAhead(c),gapTime=a.car?a.dist/Math.max(8,c.v):99;
      c.drsEligible=green&&c.lap>0&&c.pitState==='NONE'&&gapTime<1.15;
      c.drsActive=c.drsEligible&&inDRSZone(c);
      if(c.drsActive&&!c.radioWarnings.drs){c.radioWarnings.drs=true;pushRadio(c,'DRS AVAILABLE · ATTACK','DRS');}
      if(!c.drsActive&&c.s/total>.18)c.radioWarnings.drs=false;
      c.baseMax=c.baseMaxNominal*(c.drsActive?1.055:1)*c.faultFactor;
      c.accel=c.accelNominal*(c.fault==='ENGINE'?.92:1);
      c.brake=c.brakeNominal*(c.fault==='BRAKE'?.82:1);

      // 10) Battle AI: defend the inside, attack the opposite line, preserve side-by-side racing.
      c.battleState='CLEAR';
      if(!green||c.pitState!=='NONE'||c.incident>0)continue;
      let behind=null,behindDist=Infinity;
      for(const o of base.cars){if(o===c||o.retired)continue;const d=wrap(c.s-o.s);if(d>0&&d<behindDist){behindDist=d;behind=o;}}
      const q0=W.sample(c.s),q1=W.sample(c.s+34),cross=q0.t.x*q1.t.z-q0.t.z*q1.t.x,inside=(cross>=0?1:-1)*1.65;
      if(behind&&behindDist<17&&behind.v>c.v-1.5&&c.avoid<=0){c.laneTarget=T.MathUtils.lerp(c.laneTarget,inside,.22);c.battleState='DEFEND';}
      if(a.car&&a.dist<19&&c.v>a.car.v-.8&&c.avoid<=0){const attack=-inside*1.35;c.laneTarget=T.MathUtils.lerp(c.laneTarget,attack,.18+.10*c.driver.aggression);c.battleState='ATTACK';}
      if(a.car&&a.dist<9&&Math.abs(a.car.lane-c.lane)>1.7){c.laneTarget=T.MathUtils.lerp(c.laneTarget,c.lane,.32);c.battleState='SIDE-BY-SIDE';}
    }
  }

  // 6) Reliability / machine trouble.
  function maybeMechanical(c,dt){
    if(c.retired||c.fault||base.race.t<25||base.flag!=='GREEN')return;
    const hazard=(1-c.machine.reliability)*.0052;
    if(Math.random()>=hazard*dt)return;
    const r=Math.random();
    if(r<.12){c.fault='TERMINAL';c.retired=true;c.v=0;emit('RETIREMENT',c,{reason:'POWER UNIT'});pushRadio(c,'STOP THE CAR · POWER UNIT','URGENT');return;}
    if(r<.42){c.fault='ENGINE';c.faultFactor=.88;emit('MECHANICAL',c,{fault:'ENGINE'});pushRadio(c,'ENGINE POWER LOSS · MANAGE','FAULT');}
    else if(r<.67){c.fault='BRAKE';c.faultFactor=.96;emit('MECHANICAL',c,{fault:'BRAKE'});pushRadio(c,'BRAKE ISSUE · LONGER PEDAL','FAULT');}
    else if(r<.86){c.fault='PUNCTURE';c.faultFactor=.76;c.wear=.98;c.pitState='ENTRY';emit('MECHANICAL',c,{fault:'PUNCTURE'});pushRadio(c,'PUNCTURE · BOX THIS LAP','URGENT');}
    else {c.fault='ELECTRICAL';c.faultFactor=.93;emit('MECHANICAL',c,{fault:'ELECTRICAL'});pushRadio(c,'ELECTRICAL ISSUE · RESET MODE','FAULT');}
  }

  // 7) Race engineer radio from core events and tyre state.
  const seenEvents=new Set();
  function ingestEvents(){
    for(const e of events){
      if(seenEvents.has(e.id))continue;seenEvents.add(e.id);
      const c=e.carId!=null?base.cars[e.carId]:null;
      if(e.type==='PIT_CALL'&&c)pushRadio(c,'BOX THIS LAP · CONFIRM','STRATEGY');
      else if(e.type==='PIT_EXIT'&&c)pushRadio(c,`${e.data.compound} TYRES FITTED · PUSH`,'STRATEGY');
      else if(e.type==='INCIDENT'&&c)pushRadio(c,'CAR CHECK · REPORT DAMAGE','URGENT');
      else if(e.type==='YELLOW')pushRadio(null,'YELLOW FLAG · NO OVERTAKING','CONTROL');
      else if(e.type==='SAFETY_CAR')pushRadio(null,'SAFETY CAR DEPLOYED','CONTROL');
      else if(e.type==='GREEN_FLAG')pushRadio(null,'GREEN FLAG · RACING RESUMES','CONTROL');
      else if(e.type==='FASTEST_LAP'&&c)pushRadio(c,'FASTEST LAP · GOOD PACE','INFO');
    }
    if(seenEvents.size>200){const keep=new Set(events.map(e=>e.id));for(const id of [...seenEvents])if(!keep.has(id))seenEvents.delete(id);}
    for(const c of base.cars){
      if(c.retired)continue;
      if(c.wear>.60&&!c.radioWarnings.wear60){c.radioWarnings.wear60=true;pushRadio(c,'TYRE WEAR 60% · MANAGE ENTRY','TYRE');}
      if(c.wear>.80&&!c.radioWarnings.wear80){c.radioWarnings.wear80=true;pushRadio(c,'TYRES CRITICAL · BOX WINDOW OPEN','TYRE');}
    }
  }

  // 9) Sector timing.
  const globalBest=[Infinity,Infinity,Infinity];
  function sectorOf(c){const f=c.s/total;return f<1/3?0:f<2/3?1:2;}
  function updateSectors(){
    for(const c of base.cars){
      if(c.retired)continue;
      const s=sectorOf(c);
      if(!raceStarted){c.sectorIndex=s;c.sectorStart=base.race.t;continue;}
      if(s!==c.sectorIndex){
        const elapsed=Math.max(.001,base.race.t-c.sectorStart),old=c.sectorIndex;
        c.lastSectors[old]=elapsed;c.bestSectors[old]=Math.min(c.bestSectors[old],elapsed);globalBest[old]=Math.min(globalBest[old],elapsed);
        c.sectorIndex=s;c.sectorStart=base.race.t;
      }
    }
  }

  // 1) Championship points are stored across rounds in localStorage.
  let awardPendingAt=null,roundAwarded=false;
  function maybeAwardChampionship(){
    const st=base.getStandings(),leader=st[0];if(!leader)return;
    if(leader.lap>=base.race.lapsTarget&&awardPendingAt===null)awardPendingAt=base.race.t+2;
    if(roundAwarded||awardPendingAt===null||base.race.t<awardPendingAt)return;
    st.forEach((c,i)=>{const p=pointsTable[i]||0;season.driverPoints[c.id]+=p;season.teamPoints[c.teamId]+=p;});
    roundAwarded=true;saveSeason();pushRadio(null,`${round.name} COMPLETE · CHAMPIONSHIP UPDATED`,'CONTROL');
  }
  function driverChampionship(){return base.cars.map(c=>({id:c.id,name:c.name,team:c.team,points:season.driverPoints[c.id]})).sort((a,b)=>b.points-a.points);}
  function teamChampionship(){return teams.map((t,i)=>({id:i,name:t.name,color:t.color,points:season.teamPoints[i]})).sort((a,b)=>b.points-a.points);}
  function nextRound(){
    if(!roundAwarded)return false;
    if(season.round>=rounds.length-1){season.round=0;season.driverPoints=Array(20).fill(0);season.teamPoints=Array(10).fill(0);}
    else season.round++;
    saveSeason();location.reload();return true;
  }

  function update(dt){
    if(sessionPhase==='QUALIFYING'){
      qualifyingClock+=dt;
      const pole=base.cars[qualifying[0].carId];
      statusEl.textContent=`QUALIFYING · P1 ${pole.name} ${qualifying[0].time.toFixed(3)}`;
      if(qualifyingClock>=3.4){sessionPhase='RACE';raceStarted=true;base.cars.forEach(c=>{c.sectorIndex=sectorOf(c);c.sectorStart=0;});pushRadio(null,'GRID SET · PREPARE FOR START','CONTROL');}
      return;
    }
    prepareDRSAndBattle();
    base.update(dt);
    for(const c of base.cars)maybeMechanical(c,dt);
    updateSectors();ingestEvents();maybeAwardChampionship();
  }

  const api=new Proxy(base,{
    get(target,prop){
      if(prop==='update')return update;
      if(prop==='sessionPhase')return sessionPhase;
      if(prop==='qualifying')return qualifying;
      if(prop==='teams')return teams;
      if(prop==='radio')return extraRadio;
      if(prop==='globalBestSectors')return globalBest;
      if(prop==='championship')return{round:season.round,roundNumber:season.round+1,roundName:round.name,rounds:rounds.length,awarded:roundAwarded,isFinal:season.round===rounds.length-1,drivers:driverChampionship(),teams:teamChampionship()};
      if(prop==='nextRound')return nextRound;
      if(prop==='drsZones')return drsZones;
      return Reflect.get(target,prop,target);
    }
  });
  return api;
}
