import {createRace as createV31Race} from './v31-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV31Race(W,statusEl,settings),baseUpdate=R.update;
  const spins=new Map(),contactLatch=new Set(),barrierCooldown=new Map(),history=[];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const emit=(type,c,data={})=>{R.events?.push({id:`v33-${Date.now()}-${Math.random()}`,type,t:R.race.t,carId:c?.id??null,data});while(R.events?.length>160)R.events.shift();};
  const radio=(c,text,kind='URGENT')=>{if(!R.radio||!c)return;R.radio.push({id:`v33r-${Date.now()}-${Math.random()}`,t:R.race.t,carId:c.id,name:c.name,text,kind});while(R.radio.length>36)R.radio.shift();};
  const massOf=c=>c.massKg||c.classPerformance?.massKg||({formula:800,hyper:1030,lmh:1030,proto:950,gt:1300,supercar:1450,touring:1320}[c.type]||1100);
  const spinKind=s=>s<.46?'LIGHT':s<.74?'MAJOR':'VIOLENT';

  function beginSpin(c){
    const severity=clamp(Number(c.spinSeverity)||.5,.2,1),kind=spinKind(severity),dir=Math.sign(c._spinDir||1);
    const s={kind,severity,dir,extra:0,latVel:kind==='LIGHT'?.8+severity:kind==='MAJOR'?2.4+severity*2.2:4.2+severity*3.0,startedAt:R.race.t,barrierHits:0};
    spins.set(c.id,s);c.spinClass=kind;c.crashState='NONE';
    if(kind==='LIGHT')c.spinTimer=Math.min(c.spinTimer||.75,.78);
    if(kind==='MAJOR')c.spinTimer=Math.max(c.spinTimer||0,1.18);
    if(kind==='VIOLENT')c.spinTimer=Math.max(c.spinTimer||0,1.65);
    emit('SPIN_CLASS',c,{kind,severity,entryKmh:Math.round((c.v||0)*3.6)});
    return s;
  }

  function damageBand(kmh){
    if(kmh<15)return{label:'SCRAPE',damage:.018,speed:.90};
    if(kmh<38)return{label:'LIGHT',damage:.055,speed:.78};
    if(kmh<72)return{label:'MODERATE',damage:.15,speed:.58};
    if(kmh<115)return{label:'HEAVY',damage:.32,speed:.34};
    if(kmh<160)return{label:'SEVERE',damage:.55,speed:.16};
    return{label:'DESTROYED',damage:.88,speed:0};
  }
  function retireIfNeeded(c,cause,impactKmh,forced=false){
    if(c.retired)return true;
    if(forced||(c.damage||0)>=.90){
      c.damage=1;c.v=0;c.retired=true;c.fault='CRASH';c.spinState='NONE';c.crashState='DESTROYED';
      W.spawnDebris?.(c,10);W.spawnRecovery?.(c,'CRASH');emit('RETIREMENT',c,{reason:cause,impactKmh:Math.round(impactKmh)});radio(c,'Big impact. Stop the car. Stop the car.','FAULT');return true;
    }
    if((c.damage||0)>=.68){
      c.fault='SUSPENSION DAMAGE';c.v=Math.min(c.v,18);c.pitState=c.pitState==='NONE'?'ENTRY':c.pitState;c.crashState='HEAVY';radio(c,'Suspension damage. Box if you can.','FAULT');
    }else if((c.damage||0)>=.38){c.fault='CRASH DAMAGE';c.v=Math.min(c.v,32);c.crashState='MODERATE';}
    return false;
  }
  function applyDamage(c,amount,cause,impactKmh,forced=false){
    c.damage=clamp((c.damage||0)+Math.max(0,amount),0,1);W.updateCarDamage?.(c);return retireIfNeeded(c,cause,impactKmh,forced);
  }

  function updateSpinMotion(c,dt,before){
    let s=spins.get(c.id);
    if(c.spinState==='SLIDE'&&before!=='SLIDE'&&!s)s=beginSpin(c);
    if(!s||c.retired)return;
    const q=W.sample(c.s,c.lane);
    if(c.spinState==='SLIDE'){
      const slip=Math.max(.16,Math.abs(Math.sin(c.slipAngle||0))),speedFactor=clamp((c.v||0)/45,.25,1.35);
      if(s.kind==='LIGHT')s.extra+=s.dir*s.latVel*slip*dt*.28;
      else s.extra+=s.dir*s.latVel*slip*speedFactor*dt;
      s.extra=clamp(s.extra,-6.6,6.6);
      c.mesh.position.addScaledVector(q.side,s.extra);
      if(Math.abs((c.lane||0)+s.extra)>4.6){c.offTrack=true;c.v=Math.max(0,c.v-dt*(s.kind==='VIOLENT'?18:11));}
    }else if(c.spinState==='RECOVER'){
      s.extra*=Math.exp(-dt*(s.kind==='LIGHT'?3.5:1.25));c.mesh.position.addScaledVector(q.side,s.extra);
    }else if(c.spinState==='NONE'){
      s.extra*=Math.exp(-dt*2.2);if(Math.abs(s.extra)>.04)c.mesh.position.addScaledVector(q.side,s.extra);else{spins.delete(c.id);c.offTrack=false;}
    }
  }

  function barrierPhysics(c){
    if(!c?.mesh||c.retired||!W.barrierContact)return;
    const hit=W.barrierContact(c);if(!hit)return;
    const last=barrierCooldown.get(c.id)||-99;if(R.race.t-last<.42)return;barrierCooldown.set(c.id,R.race.t);
    const yaw=c.mesh.rotation.y||0,forward={x:Math.sin(yaw),z:Math.cos(yaw)},normal=hit.inward;
    const normalMs=Math.abs((forward.x*normal.x+forward.z*normal.z)*(c.v||0)),impactKmh=normalMs*3.6;
    const band=damageBand(impactKmh),s=spins.get(c.id),q=W.sample(c.s,c.lane);
    c.mesh.position.addScaledVector(hit.inward,hit.penetration+.10);
    if(s){s.extra+=hit.inward.dot(q.side)*(hit.penetration+.18);s.barrierHits++;}
    c.v*=band.speed;c.laneTarget=clamp((c.laneTarget||0)+hit.inward.dot(q.side)*1.1,-4.2,4.2);c.crashState=band.label;
    applyDamage(c,band.damage*(1+(s?.severity||0)*.30),'BARRIER',impactKmh,band.label==='DESTROYED');
    W.spawnDebris?.(c,band.label==='SCRAPE'?1:band.label==='LIGHT'?2:band.label==='MODERATE'?4:band.label==='HEAVY'?7:10);
    emit('BARRIER_IMPACT',c,{physical:true,impactKmh:Math.round(impactKmh),damageBand:band.label,barrierIndex:hit.collider.index,side:hit.collider.sideSign});
    if(impactKmh>=38)emit('INCIDENT',c,{physical:true,kind:'BARRIER',impactKmh:Math.round(impactKmh),severity:clamp(impactKmh/170,0,1)});
    history.push({type:'BARRIER',carId:c.id,t:R.race.t,impactKmh,band:band.label});while(history.length>50)history.shift();
  }

  function rect(c){
    const yaw=c.mesh?.rotation?.y||0,f={x:Math.sin(yaw),z:Math.cos(yaw)},r={x:Math.cos(yaw),z:-Math.sin(yaw)},L=(c.length||c.mesh?.userData?.dims?.length||6.8)*.5,Wd=(c.width||c.mesh?.userData?.dims?.width||3)*.5,p={x:c.mesh.position.x,z:c.mesh.position.z};
    return{f,r,L,W:Wd,p};
  }
  const dot=(a,b)=>a.x*b.x+a.z*b.z;
  function obbContact(a,b){
    if(!a?.mesh||!b?.mesh||a.mesh.visible===false||b.mesh.visible===false)return null;
    const A=rect(a),B=rect(b),d={x:B.p.x-A.p.x,z:B.p.z-A.p.z},axes=[A.f,A.r,B.f,B.r];let min=Infinity,best=null;
    for(const axis0 of axes){const len=Math.hypot(axis0.x,axis0.z)||1,axis={x:axis0.x/len,z:axis0.z/len};const ra=A.L*Math.abs(dot(A.f,axis))+A.W*Math.abs(dot(A.r,axis)),rb=B.L*Math.abs(dot(B.f,axis))+B.W*Math.abs(dot(B.r,axis)),over=ra+rb-Math.abs(dot(d,axis));if(over<=0)return null;if(over<min){min=over;best=axis;}}
    if(dot(d,best)<0)best={x:-best.x,z:-best.z};return{normal:best,penetration:min,A,B};
  }
  function velocity(c,shape){const v=c.retired?0:(c.v||0);return{x:shape.f.x*v,z:shape.f.z*v};}
  function carCrash(a,b,contact){
    const key=a.id<b.id?`${a.id}-${b.id}`:`${b.id}-${a.id}`;if(contactLatch.has(key))return;contactLatch.add(key);
    const va=velocity(a,contact.A),vb=velocity(b,contact.B),rv={x:va.x-vb.x,z:va.z-vb.z};let impactKmh=Math.abs(dot(rv,contact.normal))*3.6;
    // A stationary or broadside spinning car is particularly severe even if the SAT normal
    // chooses a lateral axis. Include part of total closing speed for those hazards.
    const hazardA=a.spinState==='SLIDE'||a.spinState==='RECOVER'||a.v<8,hazardB=b.spinState==='SLIDE'||b.spinState==='RECOVER'||b.v<8;
    const totalRel=Math.hypot(rv.x,rv.z)*3.6;if(hazardA||hazardB)impactKmh=Math.max(impactKmh,totalRel*.62);
    const sev=clamp((impactKmh-8)/150,0,1),base=.015+Math.pow(sev,1.35)*.72,ma=massOf(a),mb=massOf(b),sum=ma+mb;
    const da=base*(mb/sum)*2,db=base*(ma/sum)*2;
    a.v*=clamp(1-sev*.54,.22,.97);b.v*=clamp(1-sev*.54,.22,.97);
    const n3={x:contact.normal.x,z:contact.normal.z};a.mesh.position.x-=n3.x*contact.penetration*.52;a.mesh.position.z-=n3.z*contact.penetration*.52;b.mesh.position.x+=n3.x*contact.penetration*.52;b.mesh.position.z+=n3.z*contact.penetration*.52;
    applyDamage(a,da,'CAR COLLISION',impactKmh,impactKmh>168&&da>.48);applyDamage(b,db,'CAR COLLISION',impactKmh,impactKmh>168&&db>.48);
    if(impactKmh>48){if(!a.retired&&a.spinState==='NONE'){a.spinState='SLIDE';a.spinSeverity=Math.max(a.spinSeverity||0,clamp(sev*.85,.35,.92));}if(!b.retired&&b.spinState==='NONE'){b.spinState='SLIDE';b.spinSeverity=Math.max(b.spinSeverity||0,clamp(sev*.85,.35,.92));}}
    const primary=(va.x*contact.normal.x+va.z*contact.normal.z)>(vb.x*contact.normal.x+vb.z*contact.normal.z)?a:b,other=primary===a?b:a;
    W.spawnDebris?.(primary,impactKmh>110?8:impactKmh>65?4:2);
    emit('CONTACT',primary,{otherId:other.id,physical:true,impactKmh:Math.round(impactKmh),severity:sev,damageA:da,damageB:db});
    if(impactKmh>42)emit('INCIDENT',primary,{otherId:other.id,physical:true,kind:'CAR_CAR',impactKmh:Math.round(impactKmh),severity:sev});
    history.push({type:'CAR_CAR',a:a.id,b:b.id,t:R.race.t,impactKmh,damageA:da,damageB:db});while(history.length>50)history.shift();
  }
  function carContacts(){
    const still=new Set();
    for(let i=0;i<R.cars.length;i++)for(let j=i+1;j<R.cars.length;j++){
      const a=R.cars[i],b=R.cars[j];if(!a.mesh||!b.mesh||a.mesh.visible===false||b.mesh.visible===false)continue;
      const hazard=a.spinState!=='NONE'||b.spinState!=='NONE'||a.v<8||b.v<8||a.retired||b.retired;if(!hazard)continue;
      const c=obbContact(a,b),key=a.id<b.id?`${a.id}-${b.id}`:`${b.id}-${a.id}`;
      if(c){still.add(key);carCrash(a,b,c);}
    }
    for(const key of [...contactLatch])if(!still.has(key))contactLatch.delete(key);
  }

  function update(dt){
    const before=R.cars.map(c=>c.spinState);baseUpdate(dt);
    for(let i=0;i<R.cars.length;i++)updateSpinMotion(R.cars[i],dt,before[i]);
    for(const c of R.cars)barrierPhysics(c);
    carContacts();
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='physicalCrashHistory')return[...history];
    if(prop==='physicalSpinStates')return[...spins].map(([carId,s])=>({carId,...s}));
    return Reflect.get(target,prop,target);
  }});
}
