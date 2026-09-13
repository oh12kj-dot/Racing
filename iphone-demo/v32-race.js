import {createRace as createV31Race} from './v31-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV31Race(W,statusEl,settings),baseUpdate=R.update;
  const active=new Map(),history=[];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const emit=(type,c,data={})=>{R.events?.push({id:`v32-${Date.now()}-${Math.random()}`,type,t:R.race.t,carId:c?.id??null,data});while(R.events?.length>140)R.events.shift();};

  function spinClass(sev){return sev<.46?'LIGHT':sev<.74?'MAJOR':'VIOLENT';}
  function begin(c){
    const severity=clamp(Number(c.spinSeverity)||.5,.2,1),kind=spinClass(severity),entry=Math.max(0,c.v||0);
    const s={kind,severity,entry,startedAt:R.race.t,offTrack:false,impact:false,impactKmh:0,damage:'NONE'};
    active.set(c.id,s);c.spinClass=kind;c.crashState='NONE';
    if(kind==='LIGHT')c.spinTimer=Math.min(c.spinTimer||.75,.72);
    else if(kind==='MAJOR'){c.spinTimer=Math.max(c.spinTimer||0,1.15);c.laneTarget=clamp((c.laneTarget||0)+Math.sign(c._spinDir||1)*1.0,-4.1,4.1);}
    else{c.spinTimer=Math.max(c.spinTimer||0,1.55);c.laneTarget=clamp((c.laneTarget||0)+Math.sign(c._spinDir||1)*1.7,-4.2,4.2);}
    emit('SPIN_CLASS',c,{kind,severity,entryKmh:Math.round(entry*3.6)});
    return s;
  }

  function impact(c,s){
    if(s.impact||c.retired)return;
    const slip=Math.max(.15,Math.abs(Math.sin(c.slipAngle||0))),normalSpeed=(c.v||0)*slip;
    const impactKmh=normalSpeed*3.6+s.severity*18;s.impact=true;s.impactKmh=impactKmh;
    let crash='MINOR',add=.06,speedFactor=.72;
    if(impactKmh>=55){crash='MODERATE';add=.16;speedFactor=.48;}
    if(impactKmh>=105){crash='MAJOR';add=.34;speedFactor=.24;}
    if(impactKmh>=165){crash='DESTROYED';add=.72;speedFactor=0;}
    c.damage=clamp((c.damage||0)+add,0,1);c.crashState=crash;s.damage=crash;c.v*=speedFactor;
    W.spawnDebris?.(c,crash==='MINOR'?2:crash==='MODERATE'?4:crash==='MAJOR'?7:10);
    emit('BARRIER_IMPACT',c,{impactKmh:Math.round(impactKmh),crash,severity:s.severity});
    if(crash==='DESTROYED'||(crash==='MAJOR'&&c.damage>.86)){
      c.v=0;c.retired=true;c.fault='CRASH';c.spinState='NONE';c.damage=1;
      emit('RETIREMENT',c,{reason:'CRASH',impactKmh:Math.round(impactKmh),crash});
    }else if(crash==='MAJOR'){
      c.fault='CRASH DAMAGE';c.pitState='ENTRY';
    }
    history.push({carId:c.id,t:R.race.t,impactKmh,crash});while(history.length>32)history.shift();
  }

  function updateSpinPhysics(c,dt,before){
    if(c.retired){active.delete(c.id);return;}
    let s=active.get(c.id);
    if(c.spinState==='SLIDE'&&before!=='SLIDE'&&!s)s=begin(c);
    if(!s)return;
    if(c.spinState==='SLIDE'){
      const edge=Math.abs(c.lane||0),off=Math.max(0,edge-3.45);
      if(off>0&&!s.offTrack){s.offTrack=true;c.spinClass=s.kind==='LIGHT'?'MAJOR':s.kind;emit('OFF_TRACK',c,{spinClass:c.spinClass,speedKmh:Math.round(c.v*3.6)});}
      if(s.offTrack){const gravelDrag=(10+26*s.severity+off*8)*dt;c.v=Math.max(0,c.v-gravelDrag);c.overtake=0;c.drsActive=false;c.drsEligible=false;}
      if(s.kind==='LIGHT'){
        c.laneTarget=clamp(c.laneTarget*.985,-3.65,3.65);
      }else{
        const dir=Math.sign(c.lane||c._spinDir||1);c.laneTarget=clamp(c.laneTarget+dir*dt*(s.kind==='VIOLENT'?.9:.48),-4.2,4.2);
      }
      // Track-edge contact is a stand-in for armco/tyre barrier geometry. Impact energy
      // is based on the velocity component normal to the barrier, not just total speed.
      if(edge>3.96&&s.offTrack&&(s.kind!=='LIGHT'||Math.abs(c.slipAngle||0)>.45))impact(c,s);
    }
    if(c.spinState==='RECOVER'&&s.impact&&s.damage!=='NONE')c.v=Math.min(c.v,s.damage==='MAJOR'?16:s.damage==='MODERATE'?24:32);
    if(c.spinState==='NONE'&&R.race.t-s.startedAt>3.5)active.delete(c.id);
  }

  function update(dt){
    const before=R.cars.map(c=>c.spinState);
    baseUpdate(dt);
    for(let i=0;i<R.cars.length;i++)updateSpinPhysics(R.cars[i],dt,before[i]);
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='spinIncidents')return{active:[...active].map(([carId,s])=>({carId,...s})),history:[...history]};
    return Reflect.get(target,prop,target);
  }});
}
