import {createDirector as createV30Director} from './v30-director.js';

export function createDirector(R){
  const base=createV30Director(R);
  let focus=base.focus,shot=base.shot,reason=base.reason||'NORMAL';
  let holdUntil=0,lastAccepted=-999,lastKey='',manualUntil=0;
  const seenCritical=new Set();
  const now=()=>R.race?.t||0;
  const HOLD={NORMAL:12,BATTLE:14,PIT:12,SPIN:11,CONTACT:11,INCIDENT:11,RETIREMENT:12,SAFETY_CAR:12,RED_FLAG:14,LOCKUP:8};
  const PRI={NORMAL:10,BATTLE:24,PIT:36,LOCKUP:46,SPIN:62,CONTACT:68,INCIDENT:70,RETIREMENT:82,SAFETY_CAR:88,RED_FLAG:100};
  const priority=x=>PRI[x]||10;

  function eventKey(e){return e?.id??`${e?.type}:${e?.carId}:${e?.t}`;}
  function latestCritical(){
    let best=null;
    for(const e of R.events||[]){
      if(!['CONTACT','INCIDENT','RETIREMENT','SAFETY_CAR','RED_FLAG'].includes(e.type))continue;
      const k=eventKey(e);if(seenCritical.has(k))continue;seenCritical.add(k);
      if(!best||priority(e.type)>priority(best.type))best=e;
    }
    if(seenCritical.size>260){const live=new Set((R.events||[]).map(eventKey));for(const k of [...seenCritical])if(!live.has(k))seenCritical.delete(k);}
    return best;
  }
  function accept(nextFocus,nextShot,nextReason,seconds){
    const t=now();focus=Number.isFinite(nextFocus)?nextFocus:focus;shot=nextShot||shot;reason=nextReason||reason;
    holdUntil=t+(seconds??HOLD[reason]??HOLD.NORMAL);lastAccepted=t;lastKey=`${shot}:${focus}:${reason}`;
  }
  function update(dt){
    base.update(dt);const t=now();
    if(manualUntil>t){focus=base.focus;shot=base.shot;reason='MANUAL';return;}
    if(lastAccepted<0)accept(base.focus,base.shot,base.reason||'NORMAL');

    const critical=latestCritical();
    if(critical){
      const p=priority(critical.type),cur=priority(reason);
      // Only genuinely serious race-control events may interrupt an active shot.
      if(t>=holdUntil||p>=88||p>=cur+24){
        const id=critical.carId!=null?critical.carId:base.focus;
        const s=['CONTACT','INCIDENT'].includes(critical.type)?'HELI':'CHASE';
        accept(id,s,critical.type,HOLD[critical.type]);return;
      }
    }

    if(t<holdUntil)return;

    const nextReason=base.reason||'NORMAL',nextFocus=base.focus,nextShot=base.shot;
    const nextKey=`${nextShot}:${nextFocus}:${nextReason}`;
    if(nextKey===lastKey){holdUntil=t+(HOLD[nextReason]||HOLD.NORMAL);return;}

    // Avoid hopping between cars for minor differences. Once a shot expires, require the
    // incoming subject/reason to be meaningful; otherwise keep the current subject longer.
    const sameCar=Number(nextFocus)===Number(focus),sameShot=nextShot===shot;
    if(nextReason==='NORMAL'&&!sameCar&&t-lastAccepted<18){holdUntil=t+4;return;}
    if(nextReason==='BATTLE'&&reason==='BATTLE'&&!sameCar&&t-lastAccepted<20){holdUntil=t+5;return;}
    if(sameCar&&sameShot){reason=nextReason;holdUntil=t+(HOLD[nextReason]||HOLD.NORMAL);return;}
    accept(nextFocus,nextShot,nextReason,HOLD[nextReason]);
  }
  function userFocus(id){base.userFocus(id);focus=id;shot=base.shot||shot;reason='MANUAL';manualUntil=now()+18;holdUntil=manualUntil;lastAccepted=now();lastKey=`${shot}:${focus}:MANUAL`;}

  return{
    update,userFocus,
    get focus(){return focus},get shot(){return shot},get reason(){return reason},
    get banner(){return base.banner},get battles(){return base.battles||[]},
    get pipFocus(){return base.pipFocus},get pipActive(){return base.pipActive},
    get pitEventFocus(){return reason==='PIT'?focus:null},
    get holdRemaining(){return Math.max(0,holdUntil-now())}
  };
}
