import {createRace as createV16Race} from './v16-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV16Race(W,statusEl,settings),baseUpdate=R.update,T=W.THREE,total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=s=>((s%total)+total)%total;
  const profiles=[
    {name:'QUALIFYING ACE',quali:1.060,pace:1.018,consistency:.965,tyre:.975,wet:.985,braking:1.025,overtake:1.015,defense:.990,recovery:1.00,pressure:.98},
    {name:'TYRE WHISPERER',quali:.995,pace:1.005,consistency:1.035,tyre:1.080,wet:1.015,braking:1.015,overtake:.985,defense:1.010,recovery:1.02,pressure:1.03},
    {name:'RAIN MASTER',quali:1.005,pace:1.004,consistency:1.015,tyre:1.025,wet:1.090,braking:1.030,overtake:1.010,defense:1.005,recovery:1.06,pressure:1.04},
    {name:'ATTACKER',quali:1.020,pace:1.018,consistency:.945,tyre:.955,wet:.995,braking:.990,overtake:1.095,defense:.985,recovery:.98,pressure:.96},
    {name:'DEFENDER',quali:.995,pace:1.006,consistency:1.020,tyre:1.015,wet:1.000,braking:1.018,overtake:.975,defense:1.100,recovery:1.02,pressure:1.05},
    {name:'ALL ROUNDER',quali:1.010,pace:1.010,consistency:1.015,tyre:1.020,wet:1.020,braking:1.012,overtake:1.020,defense:1.020,recovery:1.02,pressure:1.02}
  ];
  const telemetry=new Map(),radioSeen=new Set(),dialogue=[];
  let telemetryClock=0;
  function pushRadio(car,text,kind,name){const a=R.radio;if(!a)return;const m={id:`v18r-${Date.now()}-${Math.random()}`,t:R.race.t,carId:car?.id??null,name:name||car?.activeDriver||car?.name||'ENGINEER',text,kind};a.push(m);while(a.length>34)a.shift();return m;}
  function event(type,car,data={}){R.events.push({id:`v18-${Date.now()}-${Math.random()}`,type,t:R.race.t,carId:car?.id??null,data});while(R.events.length>100)R.events.shift();}
  function progress(c){return c._v8Progress??((c.lap||0)*total+c.s);}
  function pose(c){const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);}

  for(const c of R.cars){
    const p={...profiles[c.id%profiles.length]};
    c.driverProfile=p;c.driverStyle=p.name;c.counterSteer=0;c.slipAngle=0;c.spinState='NONE';c.spinTimer=0;c.spinSeverity=0;c._spinDir=1;c._v18WearPrev=c.wear||0;
    c._v18BaseMax=c._v15BaseCoreMax||c._v10CoreMax||c.baseMaxNominal;
    c._v18BaseAccel=c._v15BaseCoreAccel||c._v10CoreAccel||c.accelNominal;
    c._v18BaseBrake=c._v15BaseCoreBrake||c._v10CoreBrake||c.brakeNominal;
    telemetry.set(c.id,[]);
  }

  // Re-score the simulated qualifying session using the expanded driver traits, then re-form the grid.
  if(Array.isArray(R.qualifying)&&R.qualifying.length){
    for(const q of R.qualifying){const c=R.cars[q.carId],p=c?.driverProfile;if(!p)continue;const deterministic=Math.sin((c.id+1)*9.713)*.065;q.time+=-(p.quali-1)*8.5+(1-p.consistency)*1.4+deterministic;}
    R.qualifying.sort((a,b)=>a.time-b.time);
    if(R.sessionPhase==='QUALIFYING')R.qualifying.forEach((q,pos)=>{const c=R.cars[q.carId],row=Math.floor(pos/2),col=pos%2;c._v8Progress=-row*12.4;c.s=wrap(-row*12.4);c.lap=row===0?0:-1;c.position=pos+1;c.prevPosition=pos+1;c.lane=(col?-1:1)*2.55+(row%2?.14:-.14);c.laneTarget=c.lane;c.v=0;pose(c);});
  }

  function preTraits(c){
    const p=c.driverProfile,wet=W.env?.wetness||0,pressure=(c.battleState==='ATTACK'||c.battleState==='DEFEND')?1:0;
    const jitter=Math.sin(R.race.t*.31+c.id*2.17)*(1-p.consistency)*.018;
    const wetGain=1+(p.wet-1)*wet;
    const pressureGain=1-(1-p.pressure)*pressure*.025;
    c._v15BaseCoreMax=c._v18BaseMax*p.pace*wetGain*pressureGain*(1+jitter);
    c._v15BaseCoreAccel=c._v18BaseAccel*(.985+.015*p.pace)*wetGain;
    c._v15BaseCoreBrake=c._v18BaseBrake*p.braking;
  }
  function postTraits(c,wearBefore){
    const p=c.driverProfile,delta=Math.max(0,(c.wear||0)-wearBefore);c.wear=clamp(wearBefore+delta*(2-p.tyre),0,1);
    if(c.battleState==='ATTACK'&&p.overtake>1)c.laneTarget=T.MathUtils.lerp(c.laneTarget,-Math.sign(c.lane||1)*2.35,clamp((p.overtake-1)*.55,0,.07));
    if(c.battleState==='DEFEND'&&p.defense>1)c.laneTarget=T.MathUtils.lerp(c.laneTarget,Math.sign(c.laneTarget||1)*2.6,clamp((p.defense-1)*.48,0,.065));
  }

  function beginLockup(c,severity){c.spinState='LOCKUP';c.spinTimer=.34+severity*.22;c.spinSeverity=severity;c._spinDir=Math.random()<.5?-1:1;c.counterSteer=0;c.flatSpot=severity>.52||c.flatSpot;event('LOCKUP',c,{severity});}
  function beginSpin(c){c.spinState='SLIDE';c.spinTimer=.75+(1-c.driverProfile.recovery)*.8+c.spinSeverity*.8;c._spinDir=Math.random()<.5?-1:1;event('SPIN',c,{severity:c.spinSeverity});pushRadio(c,'I lost the rear. I am recovering the car.','DRIVER',c.activeDriver||c.name);}
  function updateSpin(c,dt){
    if(c.retired||c.pitState!=='NONE'||['SC','VSC','RED','YELLOW'].includes(R.flag)||R.sessionPhase==='QUALIFYING'){c.spinState='NONE';c.slipAngle=0;c.counterSteer=0;return;}
    const p=c.driverProfile,wet=W.env?.wetness||0,badTyre=(c.wear||0)*.75+(c.graining||0)*.35+(c.blistering||0)*.45,pressure=(c.battleState==='ATTACK'||c.battleState==='DEFEND')?.35:0;
    if(c.spinState==='NONE'&&c.v>23){
      const brake=Math.max(0,(c.brakeVisual||0)-.70),risk=(brake*1.8+wet*.42+badTyre*.55+pressure)*(2-p.consistency)*(2-p.braking);
      if((c.brakeVisual||0)>.78&&Math.random()<dt*(.006+risk*.030))beginLockup(c,clamp(.32+risk+Math.random()*.28,.25,.98));
      else if((c.hydroplaning||c.aeroRear<c.aeroFront-.16)&&Math.random()<dt*(.002+risk*.012)){c.spinSeverity=clamp(.48+risk,.45,.95);beginSpin(c);}
    }
    if(c.spinState==='LOCKUP'){
      c.spinTimer-=dt;c.v=Math.max(7,c.v-dt*(7+11*c.spinSeverity));c.slipAngle=T.MathUtils.lerp(c.slipAngle,c._spinDir*.10*c.spinSeverity,1-Math.exp(-8*dt));c.counterSteer=-c._spinDir*.18;
      if(c.spinTimer<=0){if(c.spinSeverity>.61&&Math.random()>(p.recovery-.92)*4)beginSpin(c);else{c.spinState='RECOVER';c.spinTimer=.45;}}
    }else if(c.spinState==='SLIDE'){
      c.spinTimer-=dt;c.v=Math.max(5,c.v*(1-dt*(.32+c.spinSeverity*.28)));c.slipAngle+=c._spinDir*dt*(.72+c.spinSeverity*1.15);c.slipAngle=clamp(c.slipAngle,-1.55,1.55);c.counterSteer=-Math.sign(c.slipAngle)*clamp(Math.abs(c.slipAngle)*.72,0,1);c.laneTarget=clamp(c.laneTarget+c._spinDir*dt*1.6,-4.1,4.1);
      if(Math.abs(c.lane)>3.65&&c.spinSeverity>.72)c.damage=clamp((c.damage||0)+dt*.08,0,1);
      if(c.spinTimer<=0){c.spinState='RECOVER';c.spinTimer=.55/Math.max(.72,p.recovery);}
    }else if(c.spinState==='RECOVER'){
      c.spinTimer-=dt;c.slipAngle=T.MathUtils.lerp(c.slipAngle,0,1-Math.exp(-6.8*p.recovery*dt));c.counterSteer=-Math.sign(c.slipAngle)*Math.min(.6,Math.abs(c.slipAngle));c.laneTarget=T.MathUtils.lerp(c.laneTarget,0,.05);
      if(c.spinTimer<=0||Math.abs(c.slipAngle)<.015){c.spinState='NONE';c.slipAngle=0;c.counterSteer=0;}
    }
    if(c.mesh&&Math.abs(c.slipAngle)>.001)c.mesh.rotation.y+=c.slipAngle;
  }

  function driverReply(msg,c){const t=String(msg.text||'').toLowerCase(),style=c.driverProfile.name;if(t.includes('box'))return style==='ATTACKER'?'Copy. Boxing. Give me the gap on exit.':'Copy. Box this lap.';if(t.includes('temperature')||t.includes('temps')||t.includes('cool'))return 'Copy. I will get out of the tow and cool it.';if(t.includes('rain')||t.includes('wet tyre'))return c.driverProfile.wet>1.05?'Copy. I can stay out one more if needed. Grip is okay.':'Understood. Grip is dropping quickly.';if(t.includes('blue flag'))return 'Copy. I will let them through on the next straight.';if(t.includes('graining'))return 'Copy. I will clean the front tyres up.';if(t.includes('blister'))return 'Understood. I will protect traction.';if(t.includes('gap ahead')||t.includes('push'))return style==='TYRE WHISPERER'?'Copy. I have pace, but I am managing the tyres.':'Copy. Pushing now.';return 'Copy. Understood.';}
  function engineerFollow(c,driverText){const st=R.getStandings(),i=st.indexOf(c),behind=i>=0&&i<st.length-1?st[i+1]:null;if(driverText.includes('gap')&&behind){const gap=Math.max(0,(progress(c)-progress(behind))/Math.max(1,c.v));return `Gap behind ${gap.toFixed(1)} seconds. You are clear to box.`;}if(driverText.includes('stay out'))return 'Understood. Stay out. We will reassess at sector three.';return 'Copy. Keep it tidy and stay on plan.';}
  function queueDialogue(){
    const a=R.radio||[];for(const m of a){if(radioSeen.has(m.id))continue;radioSeen.add(m.id);if(m.carId==null||m.kind==='CONTROL'||m.kind==='DRIVER'||m.kind==='ENGINEER_REPLY')continue;const c=R.cars[m.carId];if(!c||c.retired)continue;if((c._v18DialogueAt||-99)>R.race.t-9)continue;c._v18DialogueAt=R.race.t;const reply=driverReply(m,c);dialogue.push({at:R.race.t+.85+Math.random()*.45,car:c,kind:'DRIVER',text:reply,name:c.activeDriver||c.name,follow:true});}
    for(let i=dialogue.length-1;i>=0;i--){const d=dialogue[i];if(R.race.t<d.at)continue;dialogue.splice(i,1);pushRadio(d.car,d.text,d.kind,d.name);if(d.follow&&Math.random()<.72)dialogue.push({at:R.race.t+.95+Math.random()*.55,car:d.car,kind:'ENGINEER_REPLY',text:engineerFollow(d.car,d.text),name:`${d.car.team} ENGINEER`,follow:false});}
  }

  function recordTelemetry(c,before,dt){const a=telemetry.get(c.id);if(!a)return;const dv=c.v-before.v,gear=Math.max(1,Math.min(8,Math.floor(c.v*3.6/38)+1)),brake=clamp(c.brakeVisual||0,0,1),throttle=brake>.12?0:clamp(.28+dv/Math.max(.01,dt)/7.5,0,1),steer=clamp((c.counterSteer||0)+(c.laneTarget-c.lane)*.22,-1,1),gLong=clamp(dv/Math.max(.01,dt)/9.81,-3.5,2.5),gLat=clamp((c.lane-before.lane)/Math.max(.01,dt)/9.81*1.8,-3.5,3.5);a.push({t:R.race.t,speed:c.v*3.6,throttle,brake,gear,tyre:c.tyreTemp||0,engine:c.engineTemp||0,gLong,gLat,steer,drs:!!c.drsActive,spin:c.spinState});if(a.length>300)a.splice(0,a.length-300);}

  function update(dt){
    const before=R.cars.map(c=>({v:c.v,lane:c.lane,wear:c.wear||0}));for(const c of R.cars)preTraits(c);baseUpdate(dt);
    for(let i=0;i<R.cars.length;i++){const c=R.cars[i];postTraits(c,before[i].wear);updateSpin(c,dt);}
    queueDialogue();telemetryClock+=dt;if(telemetryClock>=.10){const step=telemetryClock;telemetryClock=0;for(let i=0;i<R.cars.length;i++)recordTelemetry(R.cars[i],before[i],step);}
  }
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='telemetryFor')return id=>[...(telemetry.get(Number(id))||[])];if(prop==='driverProfiles')return R.cars.map(c=>({carId:c.id,name:c.name,style:c.driverStyle,...c.driverProfile}));return Reflect.get(target,prop,target);}});
}
