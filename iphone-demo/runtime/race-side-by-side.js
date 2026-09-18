import {createRace as createV28Race} from './v28-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV28Race(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,W.total||1),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),reservations=new Map(),rubs=[];
  const byId=new Map(R.cars.map(c=>[c.id,c])),pairKey=(a,b)=>a.id<b.id?`${a.id}-${b.id}`:`${b.id}-${a.id}`;
  const frameRateAlpha=(per60,dt)=>{const a=clamp(Number(per60)||0,0,.999),frames=Math.max(0,Number(dt)||0)*60;return 1-Math.pow(1-a,frames);};
  function longGap(a,b){const d=Math.abs(((b.s-a.s)%total+total)%total);return Math.min(d,total-d);}
  function reserveSideBySide(dt){
    if(R.sessionPhase==='QUALIFYING'||R.sessionPhase==='FORMATION'||R.flag!=='GREEN')return;const now=R.race.t;for(const [k,x] of [...reservations])if(x.until<now)reservations.delete(k);
    for(let i=0;i<R.cars.length;i++)for(let j=i+1;j<R.cars.length;j++){
      const a=R.cars[i],b=R.cars[j];if(a.retired||b.retired||a.pitState!=='NONE'||b.pitState!=='NONE'||a.hazardAvoiding||b.hazardAvoiding)continue;const body=((a.length||5)+(b.length||5))*.5,lg=longGap(a,b);if(lg>body+5.5)continue;
      // Keep established side-by-side cars outside the predictive follow envelope.
      // The previous .42 m body clearance sat inside the .48-.52 m safety margins,
      // so a car that already had a valid lane could still be treated as following
      // traffic and lift instead of simply completing the pass.
      const desired=((a.width||2)+(b.width||2))*.5+.62,lat=Math.abs((a.lane||0)-(b.lane||0));if(lat>desired+1.4)continue;const key=pairKey(a,b),existing=reservations.get(key);let low,high;if(existing){low=existing.low;high=existing.high;}else{const aLow=(a.lane||0)<(b.lane||0)||((a.lane||0)===(b.lane||0)&&a.id<b.id);low=aLow?a.id:b.id;high=aLow?b.id:a.id;}reservations.set(key,{low,high,until:now+.75});
      const mid=clamp(((a.lane||0)+(b.lane||0))*.5,-3.72+desired*.5,3.72-desired*.5),lo=byId.get(low),hi=byId.get(high);if(lo&&hi){const blendPer60=clamp(.18+Math.max(0,desired-lat)*.10,.18,.34),blend=frameRateAlpha(blendPer60,dt);lo.laneTarget+=(mid-desired*.5-lo.laneTarget)*blend;hi.laneTarget+=(mid+desired*.5-hi.laneTarget)*blend;lo.avoid=Math.max(lo.avoid||0,.55);hi.avoid=Math.max(hi.avoid||0,.55);}
    }
  }
  function isSideRub(a,b,e){if(!a||!b)return false;const body=((a.length||5)+(b.length||5))*.5,lg=longGap(a,b),lat=Math.abs((a.lane||0)-(b.lane||0)),rel=Math.abs((a.v||0)-(b.v||0)),sideBySide=lg<body+1.8&&lat>((a.width||2)+(b.width||2))*.24,sev=Number(e?.data?.severity)||0;return sideBySide&&rel<6&&sev<.64;}
  function update(dt){
    reserveSideBySide(dt);const eventStart=R.events?.length||0;baseUpdate(dt);
    for(const e of (R.events||[]).slice(eventStart)){
      if(e?.type!=='CONTACT')continue;const a=byId.get(e.carId),b=byId.get(e.data?.otherId);if(!isSideRub(a,b,e))continue;
      rubs.push({a:a?.id,b:b?.id,t:R.race.t,severity:Number(e.data?.severity)||0});while(rubs.length>40)rubs.shift();
    }
  }
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='sideBySideControl')return{activeReservations:reservations.size,recentRubs:[...rubs],contactPolicy:'physical-contact-authoritative',frameRateInvariant:true};return Reflect.get(target,prop,target);}});
}
