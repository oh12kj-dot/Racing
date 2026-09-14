import {createRace as createV13Race} from './v13-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV13Race(W,statusEl,settings),baseUpdate=R.update,T=W.THREE,total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=x=>((x%total)+total)%total;
  const classPerf={formula:[1.035,1.04,1.03],gt:[.985,.99,1],proto:[1.01,1.015,1.01],hyper:[1.02,1.01,.995],touring:[.955,.97,1.02],supercar:[.995,.985,.98],lmh:[1.018,1.025,1.015]};
  const classColors={formula:'#53b9ff',gt:'#ff8c42',proto:'#b08cff',hyper:'#ff4f75',touring:'#53d68b',supercar:'#ffd84d',lmh:'#e8edf2'};
  const endurance=new Set(['gt','proto','hyper','lmh']);
  const selected=String(settings.raceClass||'MIXED').toLowerCase();
  const emit=(type,car,data={})=>{R.events.push({id:`v15-${Date.now()}-${Math.random()}`,type,t:R.race.t,carId:car?.id??null,data});while(R.events.length>80)R.events.shift();};
  const radio=(car,text,kind='INFO')=>{const a=R.radio;if(!a)return;a.push({id:`v15r-${Date.now()}-${Math.random()}`,t:R.race.t,carId:car?.id??null,name:car?.name||'RACE CONTROL',text,kind});while(a.length>24)a.shift();};

  if(selected!=='mixed'&&classPerf[selected]){
    for(const c of R.cars){
      const oldType=c.type,[os,oa,ob]=classPerf[oldType]||[1,1,1],[ns,na,nb]=classPerf[selected];
      c._v10CoreMax=(c._v10CoreMax||c.baseMaxNominal)/os*ns;
      c._v10CoreAccel=(c._v10CoreAccel||c.accelNominal)/oa*na;
      c._v10CoreBrake=(c._v10CoreBrake||c.brakeNominal)/ob*nb;
      const old=c.mesh,mesh=W.makeCar(c.teamColor||0xffffff,selected),q=W.sample(c.s,c.lane);old?.parent?.remove(old);W.scene.add(mesh);mesh.position.copy(q.p);mesh.position.y+=.12;mesh.rotation.y=Math.atan2(q.t.x,q.t.z);c.mesh=mesh;c.type=selected;c.length=mesh.userData.dims.length;c.width=mesh.userData.dims.width;
    }
  }

  for(const c of R.cars){
    c.className=c.type.toUpperCase();c.classColor=classColors[c.type]||'#fff';
    c.engineTemp=94;c.oilTemp=101;c.coolingMode=false;c.graining=0;c.blistering=0;c.tyreCondition='NORMAL';
    c.aeroFront=1;c.aeroRear=1;c.driverFatigue=0;c.driverStintLaps=0;c.lastSwapLap=0;c.activeDriver=c.name;
    c.driverRoster=[c.name,`${c.name.slice(0,Math.max(2,c.name.length-1))} II`];c.driverIndex=0;
    c._v15BaseCoreMax=c._v10CoreMax||c.baseMaxNominal;c._v15BaseCoreAccel=c._v10CoreAccel||c.accelNominal;c._v15BaseCoreBrake=c._v10CoreBrake||c.brakeNominal;
  }

  let vscTimer=0,vscTotal=0,vscReason='',scElapsed=0,scSeen=false,scInThisLap=false,lastFlag='GREEN',gridIntroSent=false;
  const seenEvents=new Set();
  function processEvents(){
    for(const e of R.events){
      if(seenEvents.has(e.id))continue;seenEvents.add(e.id);
      const c=e.carId!=null?R.cars[e.carId]:null;
      if(e.type==='INCIDENT'&&R.flag!=='SC'){
        const damage=c?.damage||0;
        if(damage<.38){vscTotal=vscTimer=7.5;vscReason=c?`${c.name} OFF TRACK`:'INCIDENT';emit('VSC',null,{reason:vscReason});radio(null,`VSC DEPLOYED · ${vscReason}`,'CONTROL');}
        if(c){if(Math.random()<.55)c.aeroFront=clamp(c.aeroFront-(.06+damage*.28),.55,1);else c.aeroRear=clamp(c.aeroRear-(.06+damage*.28),.55,1);}
      }
      if(e.type==='SAFETY_CAR'){scElapsed=0;scSeen=true;scInThisLap=false;vscTimer=0;}
      if(e.type==='GREEN_FLAG'&&scSeen){emit('RESTART',null,{});radio(null,'GREEN FLAG · RACING RESUMES','CONTROL');scSeen=false;scElapsed=0;scInThisLap=false;}
    }
    if(seenEvents.size>260){const keep=new Set(R.events.map(e=>e.id));for(const id of [...seenEvents])if(!keep.has(id))seenEvents.delete(id);}
  }

  function updateVSC(dt){
    if(vscTimer<=0)return;vscTimer=Math.max(0,vscTimer-dt);const st=R.getStandings();
    for(let i=0;i<st.length;i++){const c=st[i];if(c.retired||c.pitState==='STOP')continue;const base=37.5,phase=.92+.05*Math.sin((c.id+1)*1.73);const target=base*phase;c.v=Math.min(c.v,target);c.laneTarget=T.MathUtils.lerp(c.laneTarget,0,.05);}
    if(vscTimer===0){emit('VSC_ENDING',null,{});radio(null,'VSC ENDING · GREEN FLAG','CONTROL');}
  }

  function updateSC(dt){
    if(R.flag!=='SC'){if(lastFlag==='SC')scElapsed=0;return;}scElapsed+=dt;const st=R.getStandings();if(!st.length)return;
    for(let i=0;i<st.length;i++){
      const c=st[i];if(c.retired||c.pitState==='STOP')continue;
      if(i===0){c.v=Math.min(c.v,24.5);continue;}
      const a=st[i-1],gap=Math.max(0,(a._v8Progress??a.lap*total+a.s)-(c._v8Progress??c.lap*total+c.s));
      let target=gap>42?29:gap>28?26:gap>18?23:gap<11?17:21.5;
      const lapped=(st[0]._v8Progress??0)-(c._v8Progress??0)>total*.82&&scElapsed>4&&scElapsed<13;
      if(lapped){target=30.5;c.v=Math.min(target,c.v+7*dt);}else if(gap>28)c.v=Math.min(target,c.v+4*dt);else c.v=Math.min(c.v,target);
      c.laneTarget=T.MathUtils.lerp(c.laneTarget,0,.08);
    }
    if(scElapsed>8.5&&!scInThisLap){scInThisLap=true;emit('SC_IN_THIS_LAP',null,{});radio(null,'SAFETY CAR IN THIS LAP','CONTROL');}
  }

  function driverStints(dt){
    for(const c of R.cars){if(c.retired)continue;if(endurance.has(c.type)){c.driverFatigue=clamp(c.driverFatigue+dt*.00048*(.9+c.driver.aggression*.2),0,1);const completed=Math.max(0,c.lap-c.lastSwapLap);c.driverStintLaps=completed;if(c.pitState==='STOP'&&completed>=3&&!c._v15SwapThisStop){c._v15SwapThisStop=true;c.pitTimer+=1.8;c._pitStopInitial=(c._pitStopInitial||c.pitTimer)+1.8;c.driverIndex=1-c.driverIndex;c.activeDriver=c.driverRoster[c.driverIndex];c.driverFatigue=.12;c.lastSwapLap=c.lap;radio(c,`DRIVER CHANGE · ${c.activeDriver}`,'PIT');emit('DRIVER_SWAP',c,{driver:c.activeDriver});}if(c.pitState==='NONE')c._v15SwapThisStop=false;}else{c.driverFatigue=clamp(c.driverFatigue+dt*.00014,0,.35);c.activeDriver=c.name;}}
  }

  function vehiclePhysics(dt){
    for(const c of R.cars){
      if(c.retired)continue;let nearest=999;
      for(const o of R.cars){if(o===c||o.retired)continue;const d=wrap(o.s-c.s);if(d>0&&d<nearest)nearest=d;}
      const draft=nearest<14?1:0,load=clamp(c.v/Math.max(35,c._v15BaseCoreMax||70),0,1.25),cool=(c.coolingMode?1.25:1)*(1-draft*.38);
      const engineTarget=91+load*24+draft*7-(W.env?.rain||0)*5;c.engineTemp=T.MathUtils.lerp(c.engineTemp,engineTarget,1-Math.exp(-.11*cool*dt));c.oilTemp=T.MathUtils.lerp(c.oilTemp,c.engineTemp+7,1-Math.exp(-.07*dt));c.coolingMode=c.engineTemp>112||(c.coolingMode&&c.engineTemp>104);
      if(c.coolingMode&&c.pitState==='NONE'){const side=((c.id%2)*2-1)*2.45;c.laneTarget=T.MathUtils.lerp(c.laneTarget,side,.025);}
      const tt=c.tyreTemp||90;c.graining=clamp(c.graining+dt*(tt<76?.012:-.010),0,1);c.blistering=clamp(c.blistering+dt*(tt>108?.013:-.008),0,1);c.tyreCondition=c.blistering>.35?'BLISTERING':c.graining>.35?'GRAINING':'NORMAL';if(c.tyreCondition!=='NORMAL')c.wear=clamp(c.wear+dt*.00030*(1+c.graining+c.blistering),0,1);
      const aero=Math.min(c.aeroFront,c.aeroRear),balance=clamp(1-Math.abs(c.aeroFront-c.aeroRear)*.16,.86,1),thermal=c.engineTemp>116?.91:c.engineTemp>110?.96:1,tyres=1-c.graining*.035-c.blistering*.055,fatigue=1-c.driverFatigue*.018;
      c._v10CoreMax=c._v15BaseCoreMax*thermal*tyres*fatigue*(.93+.07*aero);c._v10CoreAccel=c._v15BaseCoreAccel*thermal*fatigue;c._v10CoreBrake=c._v15BaseCoreBrake*balance;
      if(c.aeroRear<c.aeroFront-.12&&c.v>35)c.laneTarget=clamp(c.laneTarget+Math.sin(R.race.t*3.1+c.id)*.010*(1-c.aeroRear)*c.v,-3.6,3.6);
    }
  }

  function classStandings(){const groups={};for(const c of R.getStandings()){const k=c.type.toUpperCase();(groups[k]??=[]).push(c);}for(const a of Object.values(groups))a.forEach((c,i)=>c.classPosition=i+1);return groups;}
  let lastLap=-99,lastLeader=null;
  function broadcast(){const lead=R.getStandings()[0];if(!lead)return;if(lead.lap!==lastLap&&lead.lap>=0){lastLap=lead.lap;if(lead.lap===R.race.lapsTarget-1)emit('FINAL_LAP',lead,{});else if(lead.lap>0)emit('LAP_START',lead,{lap:lead.lap+1});}if(lastLeader!==null&&lastLeader!==lead.id)emit('LEAD_CHANGE',lead,{from:lastLeader});lastLeader=lead.id;}

  function update(dt){
    processEvents();vehiclePhysics(dt);const phaseBefore=R.sessionPhase;baseUpdate(dt);
    if(R.sessionPhase==='FORMATION')baseUpdate(18.2);
    if(!gridIntroSent&&phaseBefore==='QUALIFYING'&&R.sessionPhase!=='QUALIFYING'&&R.sessionPhase!=='FORMATION'){gridIntroSent=true;const pole=R.cars[R.qualifying?.[0]?.carId];emit('GRID_INTRO',pole,{pole:pole?.name});emit('POLE_POSITION',pole,{time:R.qualifying?.[0]?.time});}
    processEvents();driverStints(dt);updateVSC(dt);updateSC(dt);classStandings();broadcast();W.updateTrackside?.(R.flag==='SC'?'SC':vscTimer>0?'VSC':R.flag,R.race,R.getStandings());lastFlag=R.flag;
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='flag')return vscTimer>0&&R.flag!=='SC'?'VSC':Reflect.get(target,prop,target);
    if(prop==='vsc')return{active:vscTimer>0,remaining:vscTimer,total:vscTotal,reason:vscReason};
    if(prop==='scControl')return{elapsed:scElapsed,inThisLap:scInThisLap};
    if(prop==='classStandings')return classStandings();
    if(prop==='raceClass')return selected.toUpperCase();
    return Reflect.get(target,prop,target);
  }});
}
