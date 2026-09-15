import {createDirector as createV18Director} from './v18-director.js';

export function createDirector(R){
  const base=createV18Director(R);
  let focus=0,shot='TV',lastCut=-999,manualUntil=0,initialized=false;
  const criticalSeen=new Set();
  const NORMAL_HOLD=8.0,CRITICAL_HOLD=3.5;
  const mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760;

  function latestCritical(){
    let picked=null;
    for(const e of R.events||[]){
      if(criticalSeen.has(e.id))continue;
      if(['SPIN','LOCKUP','INCIDENT','RETIREMENT','SAFETY_CAR','RED_FLAG'].includes(e.type))picked=e;
    }
    if(picked)criticalSeen.add(picked.id);
    if(criticalSeen.size>220){const keep=new Set((R.events||[]).map(e=>e.id));for(const id of [...criticalSeen])if(!keep.has(id))criticalSeen.delete(id);}
    return picked;
  }

  function accept(nextFocus,nextShot,now){
    focus=Number.isFinite(nextFocus)?nextFocus:focus;
    shot=nextShot||shot;
    lastCut=now;
  }

  function update(dt){
    base.update(dt);
    const now=R.race?.t||0;
    if(!initialized){accept(base.focus,base.shot,now);initialized=true;return;}
    if(manualUntil>now)return;
    const current=R.cars?.[focus],critical=latestCritical();
    if(!current||current.retired){accept(base.focus,base.shot,now);return;}
    if(critical&&critical.carId!=null&&now-lastCut>=CRITICAL_HOLD){
      accept(critical.carId,critical.type==='SPIN'||critical.type==='INCIDENT'?'HELI':'CHASE',now);return;
    }
    const candidateChanged=base.focus!==focus||base.shot!==shot;
    if(candidateChanged&&now-lastCut>=NORMAL_HOLD)accept(base.focus,base.shot,now);
  }

  function userFocus(id){base.userFocus(id);focus=id;shot=base.shot||shot;lastCut=R.race?.t||0;manualUntil=lastCut+12;}

  return{
    update,userFocus,
    get focus(){return focus},
    get shot(){return shot},
    get banner(){return base.banner},
    get pipFocus(){return mobile?null:base.pipFocus},
    get pipActive(){return mobile?false:base.pipActive},
    get battles(){return base.battles||[]},
    get cutHoldRemaining(){return Math.max(0,NORMAL_HOLD-((R.race?.t||0)-lastCut))}
  };
}
