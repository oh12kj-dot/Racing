import {createRace as createV41Race} from './v41-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV41Race(W,statusEl,settings),baseUpdate=R.update,prevDamage=[];
  const bandDamage=kmh=>kmh<15?.018:kmh<38?.055:kmh<72?.15:kmh<115?.32:kmh<160?.55:.88;
  let histSeen=(R.physicalCrashHistory||[]).length;
  function update(dt){
    for(const c of R.cars)prevDamage[c.id]=c.damage||0;
    baseUpdate(dt);
    const h=R.physicalCrashHistory||[];
    for(let i=histSeen;i<h.length;i++){
      const x=h[i];if(x?.type!=='BARRIER')continue;const c=R.cars[x.carId];if(!c)continue;const material=W.barrierMaterialAt?.(c.s)||'GUARDRAIL';x.material=material;
      if(material==='TYRE'&&!c.retired){const refund=bandDamage(x.impactKmh||0)*.32,newDamage=Math.max(prevDamage[c.id]||0,(c.damage||0)-refund);c.damage=newDamage;const z=c.damageZones;if(z&&x.zone&&z[x.zone]!=null)z[x.zone]=Math.max(0,z[x.zone]-refund*1.1);if(z?.suspension!=null&&['left','right'].includes(x.zone))z.suspension=Math.max(0,z.suspension-refund*.35);W.updateCarDamage?.(c);}
    }
    histSeen=h.length;
  }
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;return Reflect.get(target,prop,target);}});
}
