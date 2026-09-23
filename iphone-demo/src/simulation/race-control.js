const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const CAUTION_RANK={GREEN:0,YELLOW:1,VSC:2,SAFETY_CAR:3,RED:4,CHEQUERED:5};
const MIN_DURATION={YELLOW:7,VSC:10,SAFETY_CAR:14,RED:8};
const RESTART_SC_MIN=10;

function signedDelta(track,a,b){
  let d=track.wrapS(b.s)-track.wrapS(a.s);
  if(d>track.total*.5)d-=track.total;
  if(d<-track.total*.5)d+=track.total;
  return d;
}
function blockedTrack(stopped,track){
  if(stopped.length<3)return false;
  for(const anchor of stopped){
    const cluster=stopped.filter(car=>Math.abs(signedDelta(track,anchor,car))<32);
    if(cluster.length<3)continue;
    const lanes=cluster.map(car=>car.lane);
    if(Math.max(...lanes)-Math.min(...lanes)>=4.2)return true;
  }
  return false;
}
function physicallyUnstableIncident(car){
  if((car.incident?.spinTimer||0)<=0)return false;
  const yawRate=Math.abs(car.yawRate||0);
  const slipAngle=Math.abs(car.tyre?.slipAngle||0);
  const lateralSpeed=Math.abs(car.laneV||0);
  return yawRate>.55||slipAngle>.16||lateralSpeed>2.2;
}
function cautionFacts(time,cars,track,environment=null){
  const hazards=cars.filter(c=>{
    if(c.retired||c.finished||c.pit.phase!=='TRACK'||c.lap<0)return false;
    const movingIncident=physicallyUnstableIncident(c);
    const stoppedCause=(c.incident.damage||0)>.05||c.systems?.failed||movingIncident;
    return movingIncident||(time>12&&c.v<3&&stoppedCause);
  });
  const stopped=hazards.filter(c=>time>12&&c.v<3);
  const blockedCars=stopped.filter(c=>c.v<1.2);
  const severe=stopped.find(c=>(c.incident.damage||0)>=.55||c.systems?.failed);
  const lowVisibility=(environment?.visibility??1)<.42;
  const blocked=blockedTrack(blockedCars,track);
  let desired='GREEN',primary=null;
  if(blocked||lowVisibility){desired='RED';primary=severe||blockedCars[0]||stopped[0]||hazards[0]||null;}
  else if(severe||stopped.length>=2){desired='SAFETY_CAR';primary=severe||stopped[0];}
  else if(stopped.length){desired='VSC';primary=stopped[0];}
  else if(hazards.length){desired='YELLOW';primary=hazards[0];}
  return{desired,primary,hazards,stopped,blocked,lowVisibility};
}
function flagMessage(flag){
  if(flag==='YELLOW')return ['YELLOW',`YELLOW FLAG — INCIDENT ON TRACK`];
  if(flag==='VSC')return ['VSC',`VIRTUAL SAFETY CAR — SLOW DOWN`];
  if(flag==='SAFETY_CAR')return ['SAFETY_CAR',`SAFETY CAR — FORM THE QUEUE`];
  if(flag==='RED')return ['RED',`RED FLAG — STOP UNDER CONTROL`];
  return ['GREEN',`GREEN FLAG — TRACK CLEAR`];
}
function allRunningCarsStopped(cars,excludedIds){
  const running=cars.filter(c=>!c.retired&&!c.finished&&!excludedIds.has(c.id)&&c.pit.phase!=='SERVICE');
  return running.length===0||running.every(c=>c.v<1.2);
}
function queueFormed(cars,excludedIds){
  // Cars physically in the pit sequence are not part of the on-track safety-car
  // train. They rejoin under the pit/merge authority and must not deadlock the
  // restart of a correctly formed track queue.
  const live=cars.filter(c=>!c.retired&&!c.finished&&!excludedIds.has(c.id)&&c.pit.phase==='TRACK').sort((a,b)=>b.totalProgress-a.totalProgress);
  if(live.length<2)return true;
  for(let i=1;i<live.length;i++){
    const ahead=live[i-1],behind=live[i];
    const gap=ahead.totalProgress-behind.totalProgress;
    const minGap=(ahead.length+behind.length)*.5+2.5;
    if(gap<minGap||gap>42)return false;
  }
  return true;
}
function safeQueueSpeed(car,ahead,gap,cap){
  const clearance=(ahead.length+car.length)*.5+3.0;
  if(gap<=clearance)return Math.max(0,ahead.v-2.2);
  const brakeAuthority=Math.max(3.2,(car.spec?.brake||8)*.55);
  const usable=Math.max(0,gap-clearance);
  const stoppingLimited=Math.sqrt(Math.max(0,ahead.v*ahead.v+2*brakeAuthority*usable));
  return Math.min(cap,stoppingLimited);
}

export function createRaceControl(){
  return{
    flag:'GREEN',
    cautionUntil:0,
    incidentId:null,
    incidentIds:[],
    lastFlagChange:0,
    restartPhase:'NONE',
    restartStartedAt:0,
    isCaution(){return ['YELLOW','VSC','SAFETY_CAR','RED'].includes(this.flag);},
    fieldControlled(cars){
      return this.flag==='RED'&&allRunningCarsStopped(cars,new Set(this.incidentIds));
    },
    transition(flag,time,hazard,emit,incidentIds=null){
      if(flag===this.flag){
        if(flag!=='GREEN'&&flag!=='CHEQUERED')this.cautionUntil=Math.max(this.cautionUntil,time+(MIN_DURATION[flag]||0));
        if(hazard)this.incidentId=hazard.id;
        if(incidentIds)this.incidentIds=[...new Set(incidentIds)];
        return;
      }
      this.flag=flag;
      this.lastFlagChange=time;
      this.incidentId=hazard?.id??null;
      if(incidentIds)this.incidentIds=[...new Set(incidentIds)];
      else if(flag==='GREEN')this.incidentIds=[];
      else if(hazard&&!this.incidentIds.includes(hazard.id))this.incidentIds=[hazard.id];
      if(flag==='GREEN')this.cautionUntil=0;
      else if(flag!=='CHEQUERED')this.cautionUntil=time+(MIN_DURATION[flag]||0);
      const [type,text]=flagMessage(flag);
      emit?.(type,hazard,text,`FLAG:${flag}:${hazard?.id??'race'}:${Math.floor(time)}`);
    },
    update(time,cars,track,emit,environment=null){
      if(this.flag==='CHEQUERED')return;
      const facts=cautionFacts(time,cars,track,environment);
      const excludedIds=new Set(this.incidentIds);

      if(this.flag==='RED'){
        if(facts.desired==='RED'){
          this.cautionUntil=Math.max(this.cautionUntil,time+1.5);
          this.incidentIds=[...new Set([...this.incidentIds,...facts.hazards.map(c=>c.id)])];
          if(facts.primary)this.incidentId=facts.primary.id;
        }else if(time>=this.cautionUntil&&allRunningCarsStopped(cars,excludedIds)){
          this.restartPhase='SC_FORMATION';
          this.restartStartedAt=time;
          this.transition('SAFETY_CAR',time,facts.primary||cars.find(c=>this.incidentIds.includes(c.id))||null,emit,this.incidentIds);
          this.cautionUntil=Math.max(this.cautionUntil,time+RESTART_SC_MIN);
          emit?.('RESTART',null,'RESTART PROCEDURE — SAFETY CAR FORMATION',`RESTART:${Math.floor(time)}`);
        }
        this.updateBlueFlags(cars,track);
        return;
      }

      if(this.restartPhase==='SC_FORMATION'&&this.flag==='SAFETY_CAR'){
        if(facts.desired==='RED'){
          this.restartPhase='RED_STOP';
          this.restartStartedAt=time;
          this.transition('RED',time,facts.primary,emit,facts.hazards.map(c=>c.id));
        }else if(time>=this.cautionUntil&&facts.desired==='GREEN'&&queueFormed(cars,new Set(this.incidentIds))){
          this.restartPhase='NONE';
          this.restartStartedAt=0;
          this.transition('GREEN',time,null,emit,[]);
        }
        this.updateBlueFlags(cars,track);
        return;
      }

      const currentRank=CAUTION_RANK[this.flag]??0;
      const desiredRank=CAUTION_RANK[facts.desired]??0;
      if(facts.desired==='RED'){
        this.restartPhase='RED_STOP';
        this.restartStartedAt=time;
        this.transition('RED',time,facts.primary,emit,facts.hazards.map(c=>c.id));
      }else if(facts.desired!=='GREEN'){
        if(this.flag==='GREEN'||desiredRank>currentRank||time>=this.cautionUntil){
          this.transition(facts.desired,time,facts.primary,emit,facts.hazards.map(c=>c.id));
        }else{
          this.cautionUntil=Math.max(this.cautionUntil,time+1.5);
          if(facts.primary)this.incidentId=facts.primary.id;
        }
      }else if(this.isCaution()&&time>=this.cautionUntil){
        if(this.flag!=='SAFETY_CAR'||queueFormed(cars,new Set(this.incidentIds)))this.transition('GREEN',time,null,emit,[]);
      }
      this.updateBlueFlags(cars,track);
    },
    updateBlueFlags(cars,track){
      // Race control publishes the sporting restriction; racecraft remains the
      // sole owner of tactical lane intent. Hazard evasion is allowed to
      // override this rule inside racecraft, but attacks/defence are not.
      const noPassing=this.isCaution();
      for(const car of cars){car.blueFlag=false;car.cautionNoPass=noPassing;}
      if(this.flag!=='GREEN')return;
      for(const slow of cars){
        if(slow.retired||slow.finished||slow.pit.phase!=='TRACK')continue;
        let threat=null,best=Infinity;
        for(const fast of cars){
          if(fast===slow||fast.retired||fast.finished||fast.pit.phase!=='TRACK')continue;
          const advantage=(fast.spec.pace-slow.spec.pace);
          if(advantage<.075)continue;
          const d=signedDelta(track,slow,fast);
          if(d<0&&d>-65&&-d<best){best=-d;threat=fast;}
        }
        if(threat){slow.blueFlag=true;slow.blueFlagFrom=threat.id;}
      }
    },
    queueCars(cars){
      const excluded=new Set(this.incidentIds.length?this.incidentIds:[this.incidentId]);
      return cars.filter(c=>!c.retired&&!c.finished&&!excluded.has(c.id)&&c.pit.phase==='TRACK').sort((a,b)=>b.totalProgress-a.totalProgress);
    },
    targetFor(car,cars,track){
      const incident=this.incidentIds.includes(car.id)||car.id===this.incidentId;
      if(this.flag==='RED')return 0;
      if(this.flag==='VSC')return incident?10:28;
      if(this.flag==='YELLOW'){
        if(incident)return 12;
        const live=this.queueCars(cars),i=live.indexOf(car);
        if(i<=0)return 30;
        const ahead=live[i-1];
        let gap=ahead.totalProgress-car.totalProgress;
        if(gap<0)gap+=track.total;
        const desired=14+car.v*.38;
        if(gap<desired*.72)return Math.min(safeQueueSpeed(car,ahead,gap,30.5),Math.max(0,ahead.v-2.5));
        if(gap>desired*1.7)return safeQueueSpeed(car,ahead,gap,31.5);
        return Math.min(safeQueueSpeed(car,ahead,gap,30.5),clamp(ahead.v+(gap-desired)*.10,0,30.5));
      }
      if(this.flag==='SAFETY_CAR'){
        if(incident)return 8;
        const live=this.queueCars(cars),i=live.indexOf(car);
        if(i<=0)return 24;
        const ahead=live[i-1];
        let gap=ahead.totalProgress-car.totalProgress;
        if(gap<0)gap+=track.total;
        const desired=11+car.v*.24;
        if(gap<desired*.70)return Math.min(safeQueueSpeed(car,ahead,gap,26),Math.max(0,ahead.v-2.2));
        if(gap>desired*1.65)return safeQueueSpeed(car,ahead,gap,27);
        return Math.min(safeQueueSpeed(car,ahead,gap,26),clamp(ahead.v+(gap-desired)*.13,0,26));
      }
      return Infinity;
    },
    chequered(time){this.flag='CHEQUERED';this.lastFlagChange=time;this.cautionUntil=0;this.restartPhase='NONE';}
  };
}