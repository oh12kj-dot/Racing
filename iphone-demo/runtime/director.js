export function createDirector(R){
  let focus=R.getStandings?.()[0]?.id??0,shot='TV',reason='NORMAL',banner='',bannerUntil=0,holdUntil=0,manualUntil=0,pitEventFocus=null,lastNormalPick=-999,eventSerial=0;
  const seen=new Set(),pending=[],pitPrev=new Map(),cuts=[],coverage=new Map();
  const mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760,now=()=>R.race?.t||0;
  const HOLD={NORMAL:12,BATTLE:9,ATTACK_WINDOW:8,STRATEGY_CALL:8,PIT:11,PIT_STOP:9,OVERTAKE:10,FASTEST_LAP:7,YELLOW:10,GREEN_FLAG:7,SPIN:12,LOCKUP:9,CONTACT:12,INCIDENT:12,RETIREMENT:14,SAFETY_CAR:15,RED_FLAG:18,MECHANICAL:12,FINISH:16},PRI={NORMAL:10,BATTLE:26,ATTACK_WINDOW:32,FASTEST_LAP:34,GREEN_FLAG:36,STRATEGY_CALL:37,PIT:38,PIT_STOP:42,LOCKUP:48,OVERTAKE:54,YELLOW:58,SPIN:64,CONTACT:70,INCIDENT:72,MECHANICAL:78,RETIREMENT:84,SAFETY_CAR:90,FINISH:92,RED_FLAG:100};
  const priority=x=>PRI[x]||10,eventKey=e=>e?.id??`${e?.type}:${e?.carId}:${e?.t}`;
  function progress(c){return c?._v8Progress??((c?.lap||0)*1e6+(c?.s||0));}
  function shownAgo(id){const t=coverage.get(id);return t==null?999:Math.max(0,now()-t);}
  function passProbability(a,b,gap,distance){
    const tele=b?.racecraftTelemetry||{},draft=Number(b?.slipstream)||0,closing=Math.max(-8,Math.min(8,(b?.v||0)-(a?.v||0))),phase=String(b?.racecraftIntent||tele.phase||'');
    const phaseBoost=phase==='ATTACK'?.28:phase==='FEINT'?.19:phase==='SWITCHBACK'?.24:phase==='PRESSURE'?.12:0;
    return Math.max(0,Math.min(1,.08+Math.max(0,1.8-gap)*.30+Math.max(0,22-distance)/22*.24+Math.max(0,closing)*.028+draft*.20+phaseBoost));
  }
  function battleList(){
    const st=R.getStandings?.()||[],out=[];
    for(let i=1;i<st.length;i++){
      const a=st[i-1],b=st[i];if(!a||!b||a.retired||b.retired||a.pitState!=='NONE'||b.pitState!=='NONE')continue;
      const d=Math.max(0,progress(a)-progress(b)),gap=d/Math.max(8,b.v||0),lat=Math.abs((a.lane||0)-(b.lane||0)),prob=passProbability(a,b,gap,d);
      const titleWeight=i<=3?2.3:i<=6?1.4:.4,novelty=Math.min(2.4,shownAgo(b.id)/16),strategy=Math.max(Number(a.strategyInsight?.undercut)||0,Number(b.strategyInsight?.undercut)||0)*1.6;
      const narrative=(b.racecraftIntent==='FEINT'||b.racecraftIntent==='SWITCHBACK'?1.8:0)+(a.battleState==='DEFEND'?1.1:0);
      const score=Math.max(0,3.2-gap)*2.3+(d<18?1.8:0)+(lat>1.1&&d<13?1.8:0)+prob*4.5+titleWeight+novelty+strategy+narrative;
      if(score>1.8)out.push({lead:a.id,chaser:b.id,gap,distance:d,score,passProbability:prob,phase:b.racecraftIntent||b.battleState||'HUNT',position:i+1,shownAgo:shownAgo(b.id)});
    }
    return out.sort((x,y)=>y.score-x.score);
  }
  function strategyList(){
    const st=R.getStandings?.()||[],out=[];
    for(const c of st){if(c.retired)continue;const s=c.strategyInsight;if(!s)continue;const tactical=Math.max(Number(s.undercut)||0,Number(s.overcut)||0),mode=String(s.mode||'NORMAL');if(tactical<.42&&!['BOX','COVER'].includes(mode))continue;
      const importance=Math.max(0,7-(c.position||9))*.45,novelty=Math.min(1.8,shownAgo(c.id)/18),score=tactical*5+importance+novelty+(mode==='BOX'?1.2:0);out.push({carId:c.id,score,mode,tactical,projectedAfterPit:s.projectedAfterPit,position:c.position||99});}
    return out.sort((a,b)=>b.score-a.score);
  }
  function label(e){const c=e?.carId!=null?R.cars[e.carId]:null;switch(e?.type){case'RETIREMENT':return`${c?.name||'CAR'} RETIRED`;case'MECHANICAL':return`${c?.name||'CAR'} ${e.data?.fault||'MECHANICAL'}`;case'INCIDENT':return`${c?.name||'CAR'} INCIDENT`;case'CONTACT':return`${c?.name||'CAR'} CONTACT`;case'SPIN':return`${c?.name||'CAR'} SPIN`;case'SAFETY_CAR':return'SAFETY CAR DEPLOYED';case'RED_FLAG':return'RED FLAG';case'YELLOW':return'YELLOW FLAG';case'GREEN_FLAG':return'GREEN FLAG';case'OVERTAKE':return`${c?.name||'CAR'} OVERTAKE`;case'PIT_STOP':return`${c?.name||'CAR'} PIT STOP`;case'STRATEGY_CALL':return`${c?.name||'CAR'} ${e.data?.mode||'STRATEGY'}`;case'FASTEST_LAP':return`${c?.name||'CAR'} FASTEST LAP`;case'FINISH':return`${c?.name||'CAR'} WINS`;default:return e?.type?.replaceAll('_',' ')||'';}}
  function expirySeconds(e){const p=priority(e?.type);return p>=84?30:p>=64?18:10;}
  function ingestEvents(){
    const t=now();for(const e of R.events||[]){const k=eventKey(e);if(seen.has(k))continue;seen.add(k);pending.push({event:e,key:k,seq:++eventSerial,queuedAt:t});}
    for(let i=pending.length-1;i>=0;i--){const x=pending[i],et=Number.isFinite(Number(x.event?.t))?Number(x.event.t):x.queuedAt;if(t-et>expirySeconds(x.event))pending.splice(i,1);}
    if(pending.length>48){pending.sort((a,b)=>priority(b.event?.type)-priority(a.event?.type)||b.queuedAt-a.queuedAt||a.seq-b.seq);pending.length=48;}
    if(seen.size>360){const live=new Set((R.events||[]).map(eventKey));for(const x of pending)live.add(x.key);for(const k of seen)if(!live.has(k))seen.delete(k);}
  }
  function consumeEvent(){ingestEvents();if(!pending.length)return null;pending.sort((a,b)=>priority(b.event?.type)-priority(a.event?.type)||(Number(a.event?.t)||a.queuedAt)-(Number(b.event?.t)||b.queuedAt)||a.seq-b.seq);return pending.shift().event;}
  function recordCut(nextFocus,nextShot,nextReason){const t=now(),changed=nextFocus!==focus||nextShot!==shot;if(changed){cuts.push({t,from:focus,to:nextFocus,shot:nextShot,reason:nextReason});while(cuts.length&&t-cuts[0].t>120)cuts.shift();coverage.set(nextFocus,t);}focus=Number.isFinite(nextFocus)?nextFocus:focus;shot=nextShot||shot;reason=nextReason||reason;holdUntil=t+(HOLD[reason]||HOLD.NORMAL);}
  function pitCandidate(){const st=R.getStandings?.()||[];let pick=null;for(const c of st){const prev=pitPrev.get(c.id)||'NONE',entered=prev==='NONE'&&c.pitState!=='NONE',stopping=c.pitState==='STOP';pitPrev.set(c.id,c.pitState||'NONE');if(c.retired||c.pitState==='NONE')continue;if((entered||stopping)&&((c.position||99)<=6||c.id===focus)){pick=c;break;}}return pick;}
  function predictivePick(){const battles=battleList(),best=battles[0];if(best&&best.score>7.2)return{focus:best.chaser,shot:best.distance<11?'CHASE':'TV',reason:'ATTACK_WINDOW',banner:best.passProbability>.65?'OVERTAKE THREAT':best.phase==='FEINT'?'ATTACK FEINT':'BATTLE BUILDING',score:best.score};const s=strategyList()[0];if(s&&s.score>5.0)return{focus:s.carId,shot:'TV',reason:'STRATEGY_CALL',banner:`${s.mode} · PROJECTED P${s.projectedAfterPit??'?'}`,score:s.score};return null;}
  function update(){
    const t=now();if(bannerUntil<t)banner='';ingestEvents();if(R.sessionPhase==='QUALIFYING'){const q=R.qualifying?.[0],c=q?R.cars[q.carId]:null;if(c&&focus!==c.id)recordCut(c.id,'TV','NORMAL');banner='QUALIFYING';bannerUntil=t+.4;return;}if(manualUntil>t)return;
    const e=consumeEvent();if(e){const p=priority(e.type),cur=priority(reason);banner=label(e);bannerUntil=t+3;if(e.carId!=null&&(t>=holdUntil||p>=88||p>=cur+24)){recordCut(e.carId,['CONTACT','INCIDENT','SPIN'].includes(e.type)?'HELI':['OVERTAKE','RETIREMENT','MECHANICAL'].includes(e.type)?'CHASE':e.type==='PIT_STOP'?'PIT':'TV',e.type);pitEventFocus=null;return;}}
    if(pitEventFocus!=null){const c=R.cars[pitEventFocus];if(c&&!c.retired&&c.pitState!=='NONE'){focus=c.id;shot='PIT';reason='PIT';holdUntil=Math.max(holdUntil,t+2);return;}pitEventFocus=null;}
    const predictive=predictivePick();if(predictive&&(t>=holdUntil||(reason==='NORMAL'&&predictive.score>9.3))){banner=predictive.banner;bannerUntil=t+2.4;recordCut(predictive.focus,predictive.shot,predictive.reason);return;}
    if(t<holdUntil)return;const pc=pitCandidate();if(pc){pitEventFocus=pc.id;recordCut(pc.id,'PIT','PIT');return;}
    const battles=battleList(),active=battles.find(b=>b.lead===focus||b.chaser===focus),best=battles[0];if(active&&active.score>3.2){recordCut(active.chaser,active.distance<10?'CHASE':'TV','BATTLE');return;}if(best&&best.score>4.2){recordCut(best.chaser,best.distance<10?'CHASE':'TV','BATTLE');return;}
    const st=R.getStandings?.()||[],current=R.cars[focus];if(!current||current.retired||t-lastNormalPick>25){const pool=st.slice(0,Math.min(8,st.length)).sort((a,b)=>shownAgo(b.id)-shownAgo(a.id));const n=pool[0]||st[0];if(n){recordCut(n.id,'TV','NORMAL');lastNormalPick=t;}else holdUntil=t+HOLD.NORMAL;}else holdUntil=t+HOLD.NORMAL;
  }
  function userFocus(id){const next=Number(id)||0;manualUntil=now()+20;pitEventFocus=null;recordCut(next,'TV','MANUAL');holdUntil=manualUntil;}
  return{update,userFocus,get focus(){return focus},get shot(){return shot},get reason(){return reason},get banner(){return bannerUntil>now()?banner:''},get battles(){return battleList().slice(0,5)},get viewerInterest(){return{battles:battleList().slice(0,6),strategy:strategyList().slice(0,4)}},get pipFocus(){if(mobile)return null;const b=battleList().find(x=>x.lead!==focus&&x.chaser!==focus&&x.score>4.2);return b?.chaser??null},get pipActive(){return !mobile&&this.pipFocus!=null},get pitEventFocus(){return pitEventFocus},get pendingEventCount(){ingestEvents();return pending.length},get pendingEvents(){ingestEvents();return pending.map(x=>({id:x.event?.id,type:x.event?.type,carId:x.event?.carId,t:x.event?.t,priority:priority(x.event?.type)}));},get holdRemaining(){return Math.max(0,holdUntil-now())},get cutHistory(){return cuts.slice()},get cutsPerMinute(){const t=now();return cuts.filter(c=>t-c.t<=60).length}};
}
