import {createDirector as createV22Director} from './v22-director.js';

export function createDirector(R){
  const base=createV22Director(R),seen=new Set(),pitPrev=new Map();
  let focus=base.focus,shot=base.shot,holdUntil=0,reason='NORMAL',manualUntil=0,lastCut=-999,pitFocus=null;
  const mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760;
  const HOLD={NORMAL:7,BATTLE:10,SPIN:7,LOCKUP:4.5,CONTACT:7,INCIDENT:7,RETIREMENT:8,SAFETY_CAR:8,RED_FLAG:8,PIT:9};

  const now=()=>R.race?.t||0;
  function priority(type){return({RED_FLAG:100,SAFETY_CAR:90,RETIREMENT:82,CONTACT:76,INCIDENT:74,SPIN:72,LOCKUP:55,PIT:48,BATTLE:32,NORMAL:10})[type]||10;}
  function cut(id,nextShot,kind,extra=0){
    if(Number.isFinite(id))focus=id;
    shot=nextShot||shot;reason=kind;lastCut=now();holdUntil=lastCut+(HOLD[kind]||HOLD.NORMAL)+extra;
  }
  function latestEvent(){
    let best=null;
    for(const e of R.events||[]){
      if(seen.has(e.id))continue;seen.add(e.id);
      if(!['SPIN','LOCKUP','CONTACT','INCIDENT','RETIREMENT','SAFETY_CAR','RED_FLAG'].includes(e.type))continue;
      if(!best||priority(e.type)>priority(best.type))best=e;
    }
    if(seen.size>360){const keep=new Set((R.events||[]).map(e=>e.id));for(const id of [...seen])if(!keep.has(id))seen.delete(id);}
    return best;
  }
  function pitCandidate(){
    const st=R.getStandings?.()||[];let picked=null;
    for(const c of st){
      const prev=pitPrev.get(c.id)||'NONE',entered=prev==='NONE'&&c.pitState!=='NONE',stopping=c.pitState==='STOP';
      pitPrev.set(c.id,c.pitState||'NONE');
      if(c.retired||c.pitState==='NONE')continue;
      const important=(c.position||99)<=6||c.id===focus;
      if((entered||stopping)&&important&&!picked)picked=c;
    }
    return picked;
  }
  function activeBattle(){return(base.battles||[]).find(b=>b.lead===focus||b.chaser===focus)||null;}

  function update(dt){
    base.update(dt);const t=now();
    if(manualUntil>t){focus=base.focus;shot=base.shot;return;}

    if(pitFocus!=null){
      const pc=R.cars[pitFocus];
      if(pc&&!pc.retired&&pc.pitState!=='NONE'){
        focus=pc.id;shot='PIT';reason='PIT';
        if(pc.pitState==='STOP')holdUntil=Math.max(holdUntil,t+2.4);
        else if(pc.pitState==='EXIT')holdUntil=Math.max(holdUntil,t+1.4);
        if(t<holdUntil)return;
      }
      if(!pc||pc.pitState==='NONE'||t>=holdUntil)pitFocus=null;
    }

    const ev=latestEvent();
    if(ev){
      const currentPriority=priority(reason),nextPriority=priority(ev.type);
      if(t>=holdUntil||nextPriority>currentPriority+8){
        const id=ev.carId!=null?ev.carId:base.focus;
        cut(id,ev.type==='SPIN'||ev.type==='CONTACT'||ev.type==='INCIDENT'?'HELI':'CHASE',ev.type);
        return;
      }
    }

    const pc=pitCandidate();
    if(pc&&t>=holdUntil){pitFocus=pc.id;cut(pc.id,'PIT','PIT');return;}

    if(t<holdUntil)return;
    const b=activeBattle();
    if(b&&b.score>2){reason='BATTLE';holdUntil=t+HOLD.BATTLE;focus=(b.chaser??focus);shot=b.distance<10?'CHASE':'TV';lastCut=t;return;}

    const changed=base.focus!==focus||base.shot!==shot;
    if(changed&&t-lastCut>=HOLD.NORMAL){focus=base.focus;shot=base.shot;reason='NORMAL';lastCut=t;holdUntil=t+HOLD.NORMAL;}
  }

  function userFocus(id){base.userFocus(id);focus=id;shot=base.shot||shot;manualUntil=now()+12;lastCut=now();holdUntil=manualUntil;reason='MANUAL';pitFocus=null;}

  return{
    update,userFocus,
    get focus(){return focus},get shot(){return shot},get reason(){return reason},
    get banner(){return base.banner},get battles(){return base.battles||[]},
    get pipFocus(){return mobile?null:base.pipFocus},get pipActive(){return mobile?false:base.pipActive},
    get holdRemaining(){return Math.max(0,holdUntil-now())},get pitFocus(){return pitFocus}
  };
}
