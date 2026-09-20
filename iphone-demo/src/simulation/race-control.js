const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const CAUTION_RANK={GREEN:0,YELLOW:1,VSC:2,SAFETY_CAR:3,CHEQUERED:4};
const MIN_DURATION={YELLOW:7,VSC:10,SAFETY_CAR:14};

function signedDelta(track,a,b){
  let d=track.wrapS(b.s)-track.wrapS(a.s);
  if(d>track.total*.5)d-=track.total;
  if(d<-track.total*.5)d+=track.total;
  return d;
}
function cautionFacts(time,cars){
  const hazards=cars.filter(c=>!c.retired&&!c.finished&&c.pit.phase==='TRACK'&&c.lap>=0&&
    (c.incident.spinTimer>.8||(time>12&&c.v<3)));
  const stopped=hazards.filter(c=>time>12&&c.v<3);
  const severe=stopped.find(c=>(c.incident.damage||0)>=.55);
  let desired='GREEN',primary=null;
  if(severe||stopped.length>=2){desired='SAFETY_CAR';primary=severe||stopped[0];}
  else if(stopped.length){desired='VSC';primary=stopped[0];}
  else if(hazards.length){desired='YELLOW';primary=hazards[0];}
  return{desired,primary,hazards,stopped};
}
function flagMessage(flag){
  if(flag==='YELLOW')return ['YELLOW',`YELLOW FLAG — INCIDENT ON TRACK`];
  if(flag==='VSC')return ['VSC',`VIRTUAL SAFETY CAR — SLOW DOWN`];
  if(flag==='SAFETY_CAR')return ['SAFETY_CAR',`SAFETY CAR — FORM THE QUEUE`];
  return ['GREEN',`GREEN FLAG — TRACK CLEAR`];
}

export function createRaceControl(){
  return{
    flag:'GREEN',
    cautionUntil:0,
    incidentId:null,
    lastFlagChange:0,
    isCaution(){return ['YELLOW','VSC','SAFETY_CAR'].includes(this.flag);},
    transition(flag,time,hazard,emit){
      if(flag===this.flag){
        if(flag!=='GREEN'&&flag!=='CHEQUERED')this.cautionUntil=Math.max(this.cautionUntil,time+(MIN_DURATION[flag]||0));
        if(hazard)this.incidentId=hazard.id;
        return;
      }
      this.flag=flag;
      this.lastFlagChange=time;
      this.incidentId=hazard?.id??null;
      if(flag==='GREEN')this.cautionUntil=0;
      else if(flag!=='CHEQUERED')this.cautionUntil=Math.max(this.cautionUntil,time+(MIN_DURATION[flag]||0));
      const [type,text]=flagMessage(flag);
      emit?.(type,hazard,text,`FLAG:${flag}:${hazard?.id??'race'}:${Math.floor(time)}`);
    },
    update(time,cars,track,emit){
      if(this.flag==='CHEQUERED')return;
      const facts=cautionFacts(time,cars);
      const currentRank=CAUTION_RANK[this.flag]??0;
      const desiredRank=CAUTION_RANK[facts.desired]??0;

      if(facts.desired!=='GREEN'){
        if(this.flag==='GREEN'||desiredRank>currentRank||time>=this.cautionUntil){
          this.transition(facts.desired,time,facts.primary,emit);
        }else{
          this.cautionUntil=Math.max(this.cautionUntil,time+1.5);
          if(facts.primary)this.incidentId=facts.primary.id;
        }
      }else if(this.isCaution()&&time>=this.cautionUntil){
        this.transition('GREEN',time,null,emit);
      }

      for(const car of cars)car.blueFlag=false;
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
      return cars.filter(c=>!c.retired&&!c.finished&&c.id!==this.incidentId).sort((a,b)=>b.totalProgress-a.totalProgress);
    },
    targetFor(car,cars,track){
      const incident=car.id===this.incidentId;
      if(this.flag==='VSC')return incident?10:28;
      if(this.flag==='YELLOW'){
        if(incident)return 12;
        const live=this.queueCars(cars),i=live.indexOf(car);
        if(i<=0)return 30;
        const ahead=live[i-1];
        let gap=ahead.totalProgress-car.totalProgress;
        if(gap<0)gap+=track.total;
        const desired=14+car.v*.38;
        if(gap<desired*.72)return Math.max(8,ahead.v-2.5);
        if(gap>desired*1.7)return 31.5;
        return clamp(ahead.v+(gap-desired)*.10,12,30.5);
      }
      if(this.flag==='SAFETY_CAR'){
        if(incident)return 8;
        const live=this.queueCars(cars),i=live.indexOf(car);
        if(i<=0)return 24;
        const ahead=live[i-1];
        let gap=ahead.totalProgress-car.totalProgress;
        if(gap<0)gap+=track.total;
        const desired=11+car.v*.24;
        if(gap<desired*.70)return Math.max(7,ahead.v-2.2);
        if(gap>desired*1.65)return 27;
        return clamp(ahead.v+(gap-desired)*.13,9,26);
      }
      return Infinity;
    },
    chequered(time){this.flag='CHEQUERED';this.lastFlagChange=time;this.cautionUntil=0;}
  };
}
