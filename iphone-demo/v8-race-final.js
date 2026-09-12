import {createRace as createV8Race} from './v8-race.js';

export function createRace(W,statusEl){
  const base=createV8Race(W,statusEl),total=W.total;
  const q=base.qualifying||[];
  q.forEach((r,pos)=>{const c=base.cars[r.carId];c._v8Progress=-Math.floor(pos/2)*12.4;c._v8PrevS=c.s;});
  for(const c of base.cars){if(!Number.isFinite(c._v8Progress)){c._v8Progress=0;c._v8PrevS=c.s;}}
  const originalUpdate=base.update;
  function standings(){
    const s=[...base.cars].filter(c=>!c.retired).sort((a,b)=>(b._v8Progress??0)-(a._v8Progress??0));
    s.forEach((c,i)=>c.position=i+1);return s;
  }
  function update(dt){
    const prev=base.cars.map(c=>c.s);
    originalUpdate(dt);
    if(base.sessionPhase!=='QUALIFYING'){
      base.cars.forEach((c,i)=>{
        let d=c.s-prev[i];if(d>total*.5)d-=total;if(d<-total*.5)d+=total;
        if(Number.isFinite(d)&&Math.abs(d)<total*.25)c._v8Progress=(c._v8Progress??0)+d;
        c._v8PrevS=c.s;
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
