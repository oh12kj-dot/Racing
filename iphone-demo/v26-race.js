import {createRace as createV25Race} from './v25-race.js';

export function createRace(W,statusEl,settings={}){
  // Disable the legacy random SC path. v26 owns caution deployment from physical events.
  const physicalSCEnabled=settings.safetyCar!==false;
  const R=createV25Race(W,statusEl,{...settings,safetyCar:false}),baseUpdate=R.update,total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%total)+total)%total;
  const targets={formula:[91,98],hyper:[105,115],lmh:[105,115],proto:[103,114],gt:[118,128],supercar:[120,132],touring:[128,145]};
  const baseCorner={formula:.63,hyper:.69,lmh:.69,proto:.71,gt:.77,supercar:.80,touring:.84};
  const seen=new Set(),reviews=[],localYellows=[],monitors=new Map(),sector=new Map(),calibration=new Map();
  const globalBest=[Infinity,Infinity,Infinity];
  let reviewId=0,scCount=0,scCooldownUntil=0;
  const caution={type:'GREEN',reason:'',carId:null,startedAt:0,minUntil:0,severity:0};

  const emit=(type,car,data={})=>{R.events?.push({id:`v26-${Date.now()}-${Math.random()}`,type,t:R.race.t,carId:car?.id??null,data});while(R.events?.length>120)R.events.shift();};
  const radio=(car,text,kind='CONTROL')=>{if(!R.radio)return;R.radio.push({id:`v26r-${Date.now()}-${Math.random()}`,t:R.race.t,carId:car?.id??null,name:car?.name||'RACE CONTROL',text,kind});while(R.radio.length>38)R.radio.shift();};
  const progress=c=>c?._v8Progress??((c?.lap||0)*total+(c?.s||0));
  const trackDist=(a,b)=>{const d=Math.abs(wrap(a-b));return Math.min(d,total-d);};
  const sectorOf=c=>Math.min(2,Math.floor(clamp((c?.s||0)/Math.max(1,total),0,.999999)*3));

  for(const c of R.cars){
    sector.set(c.id,{current:sectorOf(c),start:R.race.t,last:[null,null,null],best:[Infinity,Infinity,Infinity],deltaPersonal:[null,null,null],deltaOverall:[null,null,null],status:['--','--','--']});
    calibration.set(c.id,{samples:[],factor:1,average:null,target:targets[c.type]||targets.gt,lastLapSeen:null});
    c.radarForecast={now:0,in60:0,in180:0};
  }

  function addLocalYellow(car,reason='INCIDENT',duration=6,radius=145){
    if(!car)return;const z={id:`ly-${Date.now()}-${Math.random()}`,s:car.s,carId:car.id,reason,expires:R.race.t+duration,radius};localYellows.push(z);emit('LOCAL_YELLOW',car,{reason,radius});
  }

  function startRecovery(car,reason){if(!car||W.recoveryActive?.(car.id))return;W.spawnRecovery?.(car,reason);emit('RECOVERY_STARTED',car,{reason});}
  function activeRecovery(){return (W.activeRecoveries?.()||[]).length>0;}

  function deploy(type,reason,car,severity=.5){
    if(type==='SC'&&!physicalSCEnabled){addLocalYellow(car,reason,8,180);return 'LOCAL YELLOW';}
    if(type==='VSC'&&!physicalSCEnabled){addLocalYellow(car,reason,7,170);return 'LOCAL YELLOW';}
    if(type==='SC'&&R.race.t<scCooldownUntil&&severity<.88)type='VSC';
    const rank={GREEN:0,VSC:1,SC:2},now=R.race.t;
    if(rank[type]<rank[caution.type]){caution.minUntil=Math.max(caution.minUntil,now+5);return caution.type;}
    const changed=type!==caution.type;
    caution.type=type;caution.reason=reason;caution.carId=car?.id??null;caution.severity=Math.max(caution.severity,severity);caution.startedAt=changed?now:caution.startedAt;caution.minUntil=Math.max(caution.minUntil,now+(type==='SC'?16:10));
    if(changed){
      if(type==='SC'){scCount++;emit('SAFETY_CAR',null,{reason,physical:true});radio(null,`SAFETY CAR DEPLOYED · ${reason}`,'CONTROL');}
      else {emit('VSC',null,{reason,physical:true});radio(null,`VSC DEPLOYED · ${reason}`,'CONTROL');}
    }
    return type;
  }

  function closeCaution(){
    if(caution.type==='GREEN')return;
    const old=caution.type;if(old==='SC')scCooldownUntil=R.race.t+70;
    caution.type='GREEN';caution.reason='';caution.carId=null;caution.severity=0;caution.minUntil=0;
    emit('GREEN_FLAG',null,{from:old,physical:true});radio(null,'GREEN FLAG · TRACK CLEAR','CONTROL');
  }

  function reviewEvent(type,a,b,severity,cautionResult,data={}){
    const sa=Math.round((a?.v||0)*3.6),sb=Math.round((b?.v||0)*3.6),delta=Math.abs(sa-sb),culprit=a?.name||'N/A';
    const r={id:++reviewId,type,t:R.race.t,carA:a?.id??null,carB:b?.id??null,speedA:sa,speedB:sb,deltaV:delta,severity,location:a?.s??b?.s??0,sector:(sectorOf(a||b)+1),responsibility:type==='CONTACT'?`${culprit} predominantly at fault`:'RACING INCIDENT',caution:cautionResult,data};
    reviews.push(r);if(reviews.length>32)reviews.shift();emit('INCIDENT_REVIEW',a,{reviewId:r.id,type,caution:cautionResult,severity});return r;
  }

  function classifyContact(e){
    const a=R.cars[e.carId],b=R.cars[e.data?.otherId],sev=clamp(Number(e.data?.severity)||0,0,1);if(!a)return;
    const stopped=[a,b].some(c=>c&&(c.retired||c.v<5)),onLine=[a,b].some(c=>c&&Math.abs(c.lane||0)<3.0),recentSerious=reviews.filter(x=>R.race.t-x.t<5&&x.severity>.5).length;
    const debris=Math.ceil(sev*8);if(sev>.34)W.spawnDebris?.(a,Math.max(2,debris));
    let result='LOCAL YELLOW';
    if(sev>=.78||recentSerious>=1||(stopped&&onLine&&sev>.52)){result=deploy('SC',`CONTACT · CAR ${a.number}${b?` / CAR ${b.number}`:''}`,a,sev);startRecovery(stopped?(a.v<5||a.retired?a:b):null,'CONTACT');}
    else if(sev>=.52||stopped){result=deploy('VSC',`CONTACT · CAR ${a.number}`,a,sev);if(stopped)startRecovery(a.v<5||a.retired?a:b,'CONTACT');}
    else addLocalYellow(a,'CONTACT',5+sev*5,130+sev*80);
    reviewEvent('CONTACT',a,b,sev,result,{debris});monitors.set(e.id,{carId:a.id,otherId:b?.id??null,expires:R.race.t+4,severity:sev});
  }

  function classifySpin(e){
    const c=R.cars[e.carId];if(!c)return;const sev=clamp(Number(e.data?.severity)||c.spinSeverity||.4,0,1),stopped=c.v<5,onLine=Math.abs(c.lane||0)<3.1;
    let result='LOCAL YELLOW';if(stopped&&onLine){result=deploy('VSC',`STOPPED CAR · ${c.name}`,c,sev);startRecovery(c,'SPIN');}else addLocalYellow(c,'SPIN',5+sev*3,140);
    reviewEvent('SPIN',c,null,sev,result);
  }

  function classifyRetirement(e){
    const c=R.cars[e.carId];if(!c)return;const onLine=Math.abs(c.lane||0)<3.2,result=deploy(onLine?'SC':'VSC',`STOPPED CAR · ${c.name}`,c,onLine?.82:.62);startRecovery(c,'RETIREMENT');reviewEvent('RETIREMENT',c,null,onLine?.82:.62,result);
  }

  function processEvents(){
    for(const e of R.events||[]){
      if(seen.has(e.id))continue;seen.add(e.id);
      if(e.type==='CONTACT')classifyContact(e);else if(e.type==='SPIN')classifySpin(e);else if(e.type==='RETIREMENT')classifyRetirement(e);
    }
    if(seen.size>420){const keep=new Set((R.events||[]).map(e=>e.id));for(const id of [...seen])if(!keep.has(id))seen.delete(id);}
  }

  function updateMonitors(){
    for(const [id,m] of [...monitors]){
      if(R.race.t>m.expires){monitors.delete(id);continue;}
      const cars=[R.cars[m.carId],R.cars[m.otherId]].filter(Boolean),stopped=cars.find(c=>c.retired||c.v<4);
      if(stopped&&!W.recoveryActive?.(stopped.id)&&m.severity>.45){startRecovery(stopped,'POST CONTACT');if(Math.abs(stopped.lane||0)<3.0)deploy(m.severity>.72?'SC':'VSC',`CAR STOPPED · ${stopped.name}`,stopped,m.severity);}
    }
  }

  function applyCaution(dt){
    for(let i=localYellows.length-1;i>=0;i--)if(localYellows[i].expires<=R.race.t)localYellows.splice(i,1);
    for(const c of R.cars){
      if(c.retired)continue;const local=localYellows.some(z=>trackDist(c.s,z.s)<z.radius);
      if(local){c.v=Math.min(c.v,42);c.drsActive=false;c.drsEligible=false;c.overtake=0;c.localYellow=true;}else c.localYellow=false;
    }
    if(caution.type==='VSC')for(const c of R.cars){if(c.retired||c.pitState==='STOP')continue;const target=37.5*(.92+.05*Math.sin((c.id+1)*1.73));c.v=Math.min(c.v,target);c.drsActive=false;c.drsEligible=false;c.overtake=0;}
    if(caution.type==='SC'){
      const st=R.getStandings();for(let i=0;i<st.length;i++){const c=st[i];if(c.retired||c.pitState==='STOP')continue;if(i===0){c.v=Math.min(c.v,24.5);continue;}const a=st[i-1],gap=Math.max(0,progress(a)-progress(c));const target=gap>42?29:gap>28?26:gap>18?23:gap<11?17:21.5;c.v=Math.min(c.v,target);c.drsActive=false;c.drsEligible=false;c.overtake=0;}
    }
    if(caution.type!=='GREEN'&&R.race.t>=caution.minUntil&&!activeRecovery()&&monitors.size===0)closeCaution();
    for(const t of W.recoveryHistory?.()||[]){if(t.done){const c=R.cars[t.carId];if(c?.retired&&!c.recovered){c.recovered=true;c.mesh.visible=false;emit('RECOVERY_COMPLETE',c,{reason:t.reason});}}}
  }

  function updateSectors(){
    for(const c of R.cars){
      const s=sector.get(c.id);if(!s||c.retired)continue;const cur=sectorOf(c);if(cur===s.current)continue;
      const old=s.current,elapsed=R.race.t-s.start;s.current=cur;s.start=R.race.t;if(elapsed<3||elapsed>120)continue;
      s.last[old]=elapsed;const green=effectiveFlag()==='GREEN'&&c.pitState==='NONE';const oldPB=s.best[old],oldGB=globalBest[old];
      if(green){s.best[old]=Math.min(s.best[old],elapsed);globalBest[old]=Math.min(globalBest[old],elapsed);}s.deltaPersonal[old]=Number.isFinite(oldPB)?elapsed-oldPB:null;s.deltaOverall[old]=Number.isFinite(oldGB)?elapsed-oldGB:null;
      s.status[old]=green&&elapsed<=globalBest[old]+.0005?'PURPLE':green&&elapsed<=s.best[old]+.0005?'GREEN':'YELLOW';
    }
  }

  function updateCalibration(c,dt){
    const x=calibration.get(c.id);if(!x||c.retired)return;
    if(Number.isFinite(c.lastLap)&&c.lastLap!==x.lastLapSeen){
      x.lastLapSeen=c.lastLap;if(effectiveFlag()==='GREEN'&&c.pitState==='NONE'&&c.lastLap>50&&c.lastLap<220){x.samples.push(c.lastLap);if(x.samples.length>3)x.samples.shift();if(x.samples.length===3){x.average=x.samples.reduce((a,b)=>a+b,0)/3;const mid=(x.target[0]+x.target[1])/2,err=clamp((x.average-mid)/mid,-.14,.14);x.factor=clamp(x.factor+err*.32,.88,1.12);}}
    }
    const load=clamp(W.braking?.(c.s)||0,0,1),base=baseCorner[c.type]||.77,top=c.classPerformance?.top||75,coeff=base/Math.max(.88,x.factor),floor=top*clamp(1-coeff*Math.pow(load,1.18),.24,1);
    if(x.factor>=1&&c.v<floor)c.v+=Math.min(floor-c.v,(floor-c.v)*(1-Math.exp(-5.2*dt)));else if(x.factor<.995&&load>.12)c.v*=1-dt*(1-x.factor)*.75;
  }

  function radarStrategy(c){
    if(c.retired||!W.env?.rainAt)return;const now=W.env.rainAt(c.s,0),m1=W.env.rainAt(c.s,60),m3=W.env.rainAt(c.s,180);c.radarForecast={now,in60:m1,in180:m3};
    const wet=W.env.wetness||0,needWet=c.compound!=='WET'&&(now>.48||(W.env.rain>.16&&m1>.62)),needDry=c.compound==='WET'&&now<.12&&m1<.18&&wet<.24;
    if((needWet||needDry)&&c.pitState==='NONE'&&c.lap>0&&c.s>total*.72){c.strategy&&(c.strategy.reason='RAIN RADAR');c.pitState='ENTRY';radio(c,needWet?'Rain arriving on radar. Box for wets.':'Radar is clear. Box for slicks.','STRATEGY');emit('RADAR_STRATEGY',c,{now,m1,m3,needWet,needDry});}
  }

  function effectiveFlag(){const f=R.flag;if(f==='RED')return'RED';return caution.type!=='GREEN'?caution.type:f;}

  function update(dt){
    baseUpdate(dt);processEvents();updateMonitors();updateSectors();
    for(const c of R.cars){updateCalibration(c,dt);radarStrategy(c);}
    applyCaution(dt);
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='flag')return effectiveFlag();
    if(prop==='physicalCaution')return{...caution,scCount,cooldownRemaining:Math.max(0,scCooldownUntil-R.race.t),localYellows:localYellows.map(x=>({...x})),recoveries:W.activeRecoveries?.()||[]};
    if(prop==='incidentReviews')return reviews.map(x=>({...x}));
    if(prop==='sectorTimingFor')return id=>{const s=sector.get(Number(id));return s?{...s,last:[...s.last],best:[...s.best],deltaPersonal:[...s.deltaPersonal],deltaOverall:[...s.deltaOverall],status:[...s.status]}:null;};
    if(prop==='globalSectorBest')return[...globalBest];
    if(prop==='paceCalibrationFor')return id=>{const x=calibration.get(Number(id));return x?{...x,samples:[...x.samples],target:[...x.target]}:null;};
    if(prop==='paceCalibration')return R.cars.map(c=>({carId:c.id,...(calibration.get(c.id)||{})}));
    return Reflect.get(target,prop,target);
  }});
}
