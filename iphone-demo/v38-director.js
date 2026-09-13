import {createDirector as createV22Director} from './v22-director.js';

export function createDirector(R){
  const base=createV22Director(R),pitPrev=new Map(),seenCritical=new Set();
  let focus=base.focus,shot=base.shot,reason='NORMAL',holdUntil=0,lastAccepted=-999,lastKey='',manualUntil=0,pitEventFocus=null;
  const mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760,now=()=>R.race?.t||0;
  const HOLD={NORMAL:12,BATTLE:14,PIT:12,SPIN:11,CONTACT:11,INCIDENT:11,RETIREMENT:12,SAFETY_CAR:12,RED_FLAG:14,LOCKUP:8},PRI={NORMAL:10,BATTLE:24,PIT:36,LOCKUP:46,SPIN:62,CONTACT:68,INCIDENT:70,RETIREMENT:82,SAFETY_CAR:88,RED_FLAG:100},priority=x=>PRI[x]||10;
  const eventKey=e=>e?.id??`${e?.type}:${e?.carId}:${e?.t}`;
  function latestCritical(){let best=null;for(const e of R.events||[]){if(!['CONTACT','INCIDENT','RETIREMENT','SAFETY_CAR','RED_FLAG'].includes(e.type))continue;const k=eventKey(e);if(seenCritical.has(k))continue;seenCritical.add(k);if(!best||priority(e.type)>priority(best.type))best=e;}if(seenCritical.size>260){const live=new Set((R.events||[]).map(eventKey));for(const k of seenCritical)if(!live.has(k))seenCritical.delete(k);}return best;}
  function pitCandidate(){const st=R.getStandings?.()||[];let picked=null;for(const c of st){const prev=pitPrev.get(c.id)||'NONE',entered=prev==='NONE'&&c.pitState!=='NONE',stopping=c.pitState==='STOP';pitPrev.set(c.id,c.pitState||'NONE');if(c.retired||c.pitState==='NONE')continue;const important=(c.position||99)<=6||c.id===focus;if((entered||stopping)&&important&&!picked)picked=c;}return picked;}
  function activeBattle(){return(base.battles||[]).find(b=>b.lead===focus||b.chaser===focus)||null;}
  function accept(nextFocus,nextShot,nextReason,seconds){const t=now();focus=Number.isFinite(nextFocus)?nextFocus:focus;shot=nextShot||shot;reason=nextReason||reason;holdUntil=t+(seconds??HOLD[reason]??HOLD.NORMAL);lastAccepted=t;lastKey=`${shot}:${focus}:${reason}`;}
  function update(dt){base.update(dt);const t=now();if(manualUntil>t){focus=base.focus;shot=base.shot;reason='MANUAL';return;}if(lastAccepted<0)accept(base.focus,base.shot,'NORMAL');const critical=latestCritical();
    if(pitEventFocus!=null){const pc=R.cars[pitEventFocus];if(critical&&priority(critical.type)>=88){pitEventFocus=null;accept(critical.carId!=null?critical.carId:base.focus,['CONTACT','INCIDENT'].includes(critical.type)?'HELI':'CHASE',critical.type,HOLD[critical.type]);return;}if(pc&&!pc.retired&&pc.pitState!=='NONE'){focus=pc.id;shot='PIT';reason='PIT';holdUntil=Math.max(holdUntil,t+(pc.pitState==='STOP'?3:1.8));return;}pitEventFocus=null;}
    if(critical){const p=priority(critical.type),cur=priority(reason);if(t>=holdUntil||p>=88||p>=cur+24){accept(critical.carId!=null?critical.carId:base.focus,['CONTACT','INCIDENT'].includes(critical.type)?'HELI':'CHASE',critical.type,HOLD[critical.type]);return;}}
    if(t<holdUntil)return;const pc=pitCandidate();if(pc){pitEventFocus=pc.id;accept(pc.id,'PIT','PIT',HOLD.PIT);return;}const battle=activeBattle();if(battle&&battle.score>2){accept(battle.chaser??focus,battle.distance<10?'CHASE':'TV','BATTLE',HOLD.BATTLE);return;}
    const nextReason='NORMAL',nextFocus=base.focus,nextShot=base.shot,nextKey=`${nextShot}:${nextFocus}:${nextReason}`;if(nextKey===lastKey){holdUntil=t+HOLD.NORMAL;return;}const sameCar=Number(nextFocus)===Number(focus),sameShot=nextShot===shot;if(!sameCar&&t-lastAccepted<18){holdUntil=t+4;return;}if(sameCar&&sameShot){reason='NORMAL';holdUntil=t+HOLD.NORMAL;return;}accept(nextFocus,nextShot,'NORMAL',HOLD.NORMAL);
  }
  function userFocus(id){base.userFocus(id);focus=id;shot=base.shot||shot;reason='MANUAL';manualUntil=now()+18;holdUntil=manualUntil;lastAccepted=now();lastKey=`${shot}:${focus}:MANUAL`;pitEventFocus=null;}
  return{update,userFocus,get focus(){return focus},get shot(){return shot},get reason(){return reason},get banner(){return base.banner},get battles(){return base.battles||[]},get pipFocus(){return mobile?null:base.pipFocus},get pipActive(){return mobile?false:base.pipActive},get pitEventFocus(){return pitEventFocus},get holdRemaining(){return Math.max(0,holdUntil-now())}};
}
