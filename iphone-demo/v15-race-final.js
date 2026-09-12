import {createRace as createV15Race} from './v15-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV15Race(W,statusEl,settings),baseUpdate=R.update,seen=new Set();
  W.setupGridTheatre?.(R.cars);
  let finishAt=null,podiumSent=false;
  function emit(type,car,data={}){R.events.push({id:`v15f-${Date.now()}-${Math.random()}`,type,t:R.race.t,carId:car?.id??null,data});while(R.events.length>80)R.events.shift();}
  function update(dt){
    baseUpdate(dt);
    if(R.flag==='VSC')for(const c of R.cars){if(c.retired)continue;c.drsActive=false;c.drsEligible=false;c.overtake=0;}
    for(const e of R.events){if(seen.has(e.id))continue;seen.add(e.id);if(e.type==='FINISH'&&finishAt===null)finishAt=R.race.t;}
    if(finishAt!==null&&!podiumSent&&R.race.t-finishAt>2.3){podiumSent=true;const top=R.getStandings().slice(0,3);emit('PODIUM',top[0],{top3:top.map(c=>c.name)});}
    if(seen.size>240){const keep=new Set(R.events.map(e=>e.id));for(const id of [...seen])if(!keep.has(id))seen.delete(id);}
  }
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;return Reflect.get(target,prop,target);}});
}
