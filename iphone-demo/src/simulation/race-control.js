const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function signedDelta(track,a,b){
  let d=track.wrapS(b.s)-track.wrapS(a.s);
  if(d>track.total*.5)d-=track.total;
  if(d<-track.total*.5)d+=track.total;
  return d;
}

export function createRaceControl(){
  return{
    flag:'GREEN',
    yellowUntil:0,
    incidentId:null,
    lastFlagChange:0,
    update(time,cars,track,emit){
      if(this.flag==='CHEQUERED')return;
      const hazard=cars.find(c=>!c.retired&&!c.finished&&c.pit.phase==='TRACK'&&
        (c.incident.spinTimer>.8||(time>12&&c.v<3&&c.lap>=0)));
      if(hazard){
        this.yellowUntil=Math.max(this.yellowUntil,time+7);
        this.incidentId=hazard.id;
        if(this.flag==='GREEN'){
          this.flag='YELLOW';this.lastFlagChange=time;
          emit?.('YELLOW',hazard,'YELLOW FLAG — INCIDENT ON TRACK','FLAG:YELLOW');
        }
      }else if(this.flag==='YELLOW'&&time>=this.yellowUntil){
        this.flag='GREEN';this.incidentId=null;this.lastFlagChange=time;
        emit?.('GREEN',null,'GREEN FLAG — TRACK CLEAR','FLAG:GREEN:'+Math.floor(time));
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
    targetFor(car,cars,track){
      if(this.flag!=='YELLOW')return Infinity;
      const live=cars.filter(c=>!c.retired&&!c.finished).sort((a,b)=>b.totalProgress-a.totalProgress);
      const i=live.indexOf(car);
      if(i<=0)return 30;
      const ahead=live[i-1];
      let gap=ahead.totalProgress-car.totalProgress;
      if(gap<0)gap+=track.total;
      const desired=14+car.v*.38;
      if(gap<desired*.72)return Math.max(8,ahead.v-2.5);
      if(gap>desired*1.7)return 31.5;
      return clamp(ahead.v+(gap-desired)*.10,12,30.5);
    },
    chequered(time){this.flag='CHEQUERED';this.lastFlagChange=time;}
  };
}
