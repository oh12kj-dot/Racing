import {createRace as createV15Race} from './v15-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV15Race(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,W.total||1),finishers=[],finishSet=new Set();
  let winnerFinishAt=null,podiumSent=false,complete=false;
  const progress=c=>c?._v8Progress??((c?.lap||0)*total+(c?.s||0));
  function emit(type,car,data={}){R.events.push({id:`finish-${Date.now()}-${Math.random()}`,type,t:R.race.t,carId:car?.id??null,data});while(R.events.length>110)R.events.shift();}
  function markFinished(c){if(!c||c.retired||finishSet.has(c.id))return;finishSet.add(c.id);c.finished=true;c.finishTime=R.race.t;c.finishPosition=finishers.length+1;c.finishProgress=progress(c);finishers.push(c);emit('CAR_FINISH',c,{position:c.finishPosition,time:c.finishTime});if(winnerFinishAt===null){winnerFinishAt=R.race.t;emit('FINISH',c,{winner:true});}}
  function crossedLine(before,c){if(!before||c.retired)return false;if((c.lap||0)>(before.lap||0))return true;return before.s>total*.82&&c.s<total*.18;}
  function classificationOrder(){const retired=R.cars.filter(c=>c.retired&&!finishSet.has(c.id)).sort((a,b)=>progress(b)-progress(a));const running=R.cars.filter(c=>!c.retired&&!finishSet.has(c.id)).sort((a,b)=>progress(b)-progress(a));return[...finishers,...running,...retired];}
  function update(dt){const before=R.cars.map(c=>({s:c.s,lap:c.lap,progress:progress(c)}));baseUpdate(dt);if(winnerFinishAt===null){const leader=R.getStandings()[0];if(leader&&!leader.retired&&(leader.lap||0)>=R.race.lapsTarget)markFinished(leader);}if(winnerFinishAt!==null){for(let i=0;i<R.cars.length;i++){const c=R.cars[i];if(c.retired||finishSet.has(c.id))continue;if((c.lap||0)>=R.race.lapsTarget||crossedLine(before[i],c))markFinished(c);}}complete=winnerFinishAt!==null&&R.cars.every(c=>c.retired||finishSet.has(c.id));if(complete&&!podiumSent){podiumSent=true;const top=classificationOrder().slice(0,3);emit('PODIUM',top[0],{top3:top.map(c=>c.name)});}}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='classification')return{complete,winnerFinishAt,finishers:[...finishers],order:classificationOrder()};if(prop==='getStandings'&&complete)return()=>classificationOrder();if(prop==='leader'&&complete)return()=>classificationOrder()[0]?.id??0;return Reflect.get(target,prop,target);}});
}
