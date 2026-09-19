import {createRace as createV8Race} from './race-championship-core.js';

export function createRace(W,statusEl){
  const base=createV8Race(W,statusEl),total=W.total;
  const q=base.qualifying||[];
  q.forEach((r,pos)=>{
    const c=base.cars[r.carId],row=Math.floor(pos/2);
    c._v8Progress=-row*12.4;c._v8PrevS=c.s;
    // Cars physically behind the start line are conceptually still on lap -1.
    // Crossing the line advances them to lap 0, matching the front row.
    c.lap=row===0?0:-1;
  });
  for(const c of base.cars){if(!Number.isFinite(c._v8Progress)){c._v8Progress=0;c._v8PrevS=c.s;}}
  const originalUpdate=base.update;
  function standings(){
    const s=[...base.cars].filter(c=>!c.retired).sort((a,b)=>(b._v8Progress??0)-(a._v8Progress??0));
    s.forEach((c,i)=>c.position=i+1);return s;
  }
  function update(dt){
    const prev=base.cars.map(c=>({s:c.s,lap:c.lap}));
    originalUpdate(dt);
    if(base.sessionPhase!=='QUALIFYING'){
      base.cars.forEach((c,i)=>{
        let d=c.s-prev[i].s;if(d>total*.5)d-=total;if(d<-total*.5)d+=total;
        if(Number.isFinite(d)&&Math.abs(d)<total*.25)c._v8Progress=(c._v8Progress??0)+d;
        c._v8PrevS=c.s;
        // The first crossing by a car that started behind the line is only its race start,
        // not a completed timed lap.
        if(prev[i].lap===-1&&c.lap===0){c.lastLap=null;c.bestLap=Infinity;c.lastLapStart=base.race.t;c.sectorStart=base.race.t;}
      });
      standings();
    }
  }
  return new Proxy(base,{
    get(target,prop){
      if(prop==='update')return update;
      if(prop==='getStandings')return standings;
      if(prop==='leader')return()=>standings()[0]?.id??0;
      return Reflect.get(target,prop,target);
    }
  });
}
