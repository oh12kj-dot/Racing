import {createDirector as createV22Director} from './v22-director.js';

export function createDirector(R){
  const base=createV22Director(R),seen=new Set();
  let focus=base.focus,shot=base.shot,lock=null,manualUntil=0;
  const priority={RED_FLAG:100,SAFETY_CAR:94,RETIREMENT:90,CONTACT:88,SPIN:86,INCIDENT:84,PIT_STOP:72,PIT_CALL:58,PIT_EXIT:56,OVERTAKE:48};
  const duration={RED_FLAG:10,SAFETY_CAR:8,RETIREMENT:9,CONTACT:7,SPIN:7,INCIDENT:7,PIT_STOP:12,PIT_CALL:6,PIT_EXIT:5,OVERTAKE:4.5};

  function candidate(e){
    if(!e||!priority[e.type])return null;
    let carId=e.carId;
    if(carId==null&&e.type==='SAFETY_CAR')carId=R.getStandings?.()[0]?.id;
    if(carId==null)return null;
    return{type:e.type,carId,priority:priority[e.type],until:(R.race?.t||0)+duration[e.type],startedAt:R.race?.t||0,static:e.type==='PIT_STOP',shot:['SPIN','CONTACT','INCIDENT','RETIREMENT'].includes(e.type)?'HELI':'TV'};
  }
  function scanEvents(){
    let best=null;
    for(const e of R.events||[]){
      if(seen.has(e.id))continue;seen.add(e.id);const x=candidate(e);if(x&&(!best||x.priority>best.priority))best=x;
    }
    if(seen.size>320){const keep=new Set((R.events||[]).map(e=>e.id));for(const id of [...seen])if(!keep.has(id))seen.delete(id);}
    return best;
  }
  function keepPitLock(now){
    if(!lock||lock.type!=='PIT_STOP')return;
    const c=R.cars?.[lock.carId];
    if(c?.pitState==='STOP')lock.until=Math.max(lock.until,now+2.2);
  }
  function update(dt){
    base.update(dt);const now=R.race?.t||0;if(manualUntil>now){focus=base.focus;shot=base.shot;return;}
    keepPitLock(now);const next=scanEvents();
    if(next&&(!lock||now>=lock.until||next.priority>lock.priority+5||next.carId===lock.carId&&next.priority>=lock.priority))lock=next;
    if(lock&&now<lock.until){const c=R.cars?.[lock.carId];if(c&&!c.retired||lock.type==='RETIREMENT'){focus=lock.carId;shot=lock.shot;return;}}
    lock=null;focus=base.focus;shot=base.shot;
  }
  function userFocus(id){base.userFocus(id);focus=id;shot=base.shot;lock=null;manualUntil=(R.race?.t||0)+12;}
  return{
    update,userFocus,
    get focus(){return focus},get shot(){return shot},get banner(){return base.banner},
    get pipFocus(){return base.pipFocus},get pipActive(){return base.pipActive},get battles(){return base.battles||[]},
    get eventLock(){return lock?{...lock,remaining:Math.max(0,lock.until-(R.race?.t||0))}:null},
    get cutHoldRemaining(){return lock?Math.max(0,lock.until-(R.race?.t||0)):base.cutHoldRemaining||0;}
  };
}
