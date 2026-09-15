import {createRace as createV28Race} from './v28-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV28Race(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,W.total||1),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),reservations=new Map(),rubs=[];
  const byId=new Map(R.cars.map(c=>[c.id,c])),pairKey=(a,b)=>a.id<b.id?`${a.id}-${b.id}`:`${b.id}-${a.id}`;
  function longGap(a,b){const d=Math.abs(((b.s-a.s)%total+total)%total);return Math.min(d,total-d);}
  function reserveSideBySide(){
    if(R.sessionPhase==='QUALIFYING'||R.sessionPhase==='FORMATION'||R.flag!=='GREEN')return;const now=R.race.t;for(const [k,x] of [...reservations])if(x.until<now)reservations.delete(k);
    for(let i=0;i<R.cars.length;i++)for(let j=i+1;j<R.cars.length;j++){
      const a=R.cars[i],b=R.cars[j];if(a.retired||b.retired||a.pitState!=='NONE'||b.pitState!=='NONE'||a.hazardAvoiding||b.hazardAvoiding)continue;const body=((a.length||5)+(b.length||5))*.5,lg=longGap(a,b);if(lg>body+5.5)continue;
      const desired=((a.width||2)+(b.width||2))*.5+.42,lat=Math.abs((a.lane||0)-(b.lane||0));if(lat>desired+1.4)continue;const key=pairKey(a,b),existing=reservations.get(key);let low,high;if(existing){low=existing.low;high=existing.high;}else{const aLow=(a.lane||0)<(b.lane||0)||((a.lane||0)===(b.lane||0)&&a.id<b.id);low=aLow?a.id:b.id;high=aLow?b.id:a.id;}reservations.set(key,{low,high,until:now+.75});
      const mid=clamp(((a.lane||0)+(b.lane||0))*.5,-3.72+desired*.5,3.72-desired*.5),lo=byId.get(low),hi=byId.get(high);if(lo&&hi){const blend=clamp(.18+Math.max(0,desired-lat)*.10,.18,.34);lo.laneTarget+=(mid-desired*.5-lo.laneTarget)*blend;hi.laneTarget+=(mid+desired*.5-hi.laneTarget)*blend;lo.avoid=Math.max(lo.avoid||0,.55);hi.avoid=Math.max(hi.avoid||0,.55);}
    }
  }
  function isSideRub(a,b,e){if(!a||!b)return false;const body=((a.length||5)+(b.length||5))*.5,lg=longGap(a,b),lat=Math.abs((a.lane||0)-(b.lane||0)),rel=Math.abs((a.v||0)-(b.v||0)),sideBySide=lg<body+1.8&&lat>((a.width||2)+(b.width||2))*.24,sev=Number(e?.data?.severity)||0;return sideBySide&&rel<6&&sev<.64;}
  function update(dt){reserveSideBySide();const events=R.events,originalPush=events?.push,caseBefore=R.stewardCases?.length||0,before=new Map(R.cars.map(c=>[c.id,{damage:c.damage||0,spinState:c.spinState,spinTimer:c.spinTimer,fault:c.fault,pitState:c.pitState,punctures:(c.wheelState||[]).map(w=>!!w.puncture)}])),rubbed=[];
    if(events&&originalPush)events.push=function(...items){const keep=[];for(const e of items){if(e?.type==='CONTACT'){const a=byId.get(e.carId),b=byId.get(e.data?.otherId);if(isSideRub(a,b,e)){rubbed.push({a:a?.id,b:b?.id,t:R.race.t,severity:Number(e.data?.severity)||0});keep.push({id:`rub-${Date.now()}-${Math.random()}`,type:'RUBBING',t:R.race.t,carId:a?.id??null,data:{otherId:b?.id??null,severity:Number(e.data?.severity)||0}});continue;}}keep.push(e);}return keep.length?originalPush.apply(this,keep):this.length;};
    try{baseUpdate(dt);}finally{if(events&&originalPush)events.push=originalPush;}
    if(rubbed.length){const touched=new Set(rubbed.flatMap(x=>[x.a,x.b]).filter(Number.isFinite));for(const id of touched){const c=byId.get(id),b=before.get(id);if(!c||!b)continue;c.damage=Math.min(c.damage||0,b.damage+.008);if(c.spinState==='SLIDE'&&b.spinState!=='SLIDE'){c.spinState='RECOVER';c.spinTimer=.18;c.spinSeverity=Math.min(c.spinSeverity||0,.18);c.slipAngle=0;c.counterSteer=0;}if(c.fault==='PUNCTURE'&&b.fault!=='PUNCTURE'){c.fault=b.fault;if(c.pitState==='ENTRY'&&b.pitState==='NONE')c.pitState='NONE';}for(let i=0;i<(c.wheelState||[]).length;i++)if(!b.punctures[i])c.wheelState[i].puncture=false;}const cases=R.stewardCases;if(Array.isArray(cases)&&cases.length>caseBefore)for(let i=cases.length-1;i>=caseBefore;i--){const x=cases[i];if(x?.type==='CAUSING_COLLISION'&&rubbed.some(r=>r.a===x.carId&&(r.b===x.otherId||r.b==null)))cases.splice(i,1);}for(const r of rubbed){rubs.push(r);while(rubs.length>40)rubs.shift();}}
  }
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='sideBySideControl')return{activeReservations:reservations.size,recentRubs:[...rubs]};return Reflect.get(target,prop,target);}});
}
