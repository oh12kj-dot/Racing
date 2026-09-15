import {createRace as createRealismRace} from './race-realism.js';

export function createRace(W,statusEl,settings={}){
  const R=createRealismRace(W,statusEl,settings),baseUpdate=R.update;
  const total=Math.max(1,Number(W.total)||1),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  const entryUF=Number(W.pitCoordinateAudit?.entryUF??W.realisticPitLayout?.entryUF??W.pitEntryFraction??.962);
  const entryS=((entryUF%1)+1)%1*total;
  const approachMeters=150;
  const roadHalf=Math.max(2.5,(Number(W.roadWidth)||14.4)*.5-.72);
  const mergeOffset=clamp(Number(W.pitOffsetAtS?.(entryS))||Number(W.realisticPitLayout?.mergeTrackOffset)||5.55,-roadHalf,roadHalf);
  const genericAck=/^(?:okay|ok|understood|copy(?: that)?|received|roger|yep)(?:\s*[,.:;!\-]\s*|\s+|$)/i;
  const radioSeen=new Set();
  const diagnostics={owner:'runtime-road-radio-damage-v1',pitRoadFrames:0,preEntrySpeedRepairs:0,falseSuspensionRepairs:0,radioRewrites:0,lastRadio:[],slowCars:[]};

  const wrapS=s=>((Number(s)||0)%total+total)%total;
  const forwardDistance=(from,to)=>((wrapS(to)-wrapS(from)+total)%total);
  function entryDistance(c){
    if(W.inPitWindow?.(c.s))return 0;
    const d=forwardDistance(c.s,entryS);
    return d>total*.5?Infinity:d;
  }
  function roadOffset(c){
    const d=entryDistance(c);if(!Number.isFinite(d)||d>approachMeters)return null;
    if(!Number.isFinite(Number(c._runtimeRoadStartLane)))c._runtimeRoadStartLane=Number.isFinite(Number(c.lane))?Number(c.lane):0;
    const alpha=smooth(1-d/approachMeters);
    return c._runtimeRoadStartLane+(mergeOffset-c._runtimeRoadStartLane)*alpha;
  }
  function poseOnRoad(c){
    if(!c?.mesh||c.retired||c.pitState!=='ENTRY'){
      if(c){c._runtimeRoadStartLane=null;c._runtimePitRoadOffset=null;}
      return;
    }
    if(W.inPitWindow?.(c.s)){
      const q=W.pitPose?.(c.s,c.teamId,'ENTRY');
      if(!q?.p)return;
      c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Number(q.rotationY)||Math.atan2(q.t.x,q.t.z);
      c._runtimePitRoadOffset=Number(q.offset)||mergeOffset;diagnostics.pitRoadFrames++;return;
    }
    const offset=roadOffset(c);if(offset==null)return;
    const q=W.sample(c.s,offset);if(!q?.p)return;
    c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
    c._runtimePitRoadOffset=offset;diagnostics.pitRoadFrames++;
  }

  function isTrueSuspensionDamage(c){return Number(c?.damageZones?.suspension||0)>=.72;}
  function normalTarget(c){
    const load=clamp(Number(W.braking?.(c.s))||0,0,1),max=Math.max(18,Number(c.max)||Number(c.baseMax)||45);
    return Math.max(18,max*(1-.70*load));
  }
  function repairLimpLogic(c,beforeV,dt){
    if(!c||c.retired)return;
    const falseSuspension=c.fault==='SUSPENSION DAMAGE'&&!isTrueSuspensionDamage(c)&&(Number(c.damage)||0)>=.68;
    if(falseSuspension){
      c.fault='HEAVY BODY DAMAGE';c._runtimeFalseSuspensionRepair=true;diagnostics.falseSuspensionRepairs++;
    }
    const outsidePit=c.pitState==='ENTRY'&&!W.inPitWindow?.(c.s);
    const heavyBody=(Number(c.damage)||0)>=.68&&!isTrueSuspensionDamage(c);
    if(!outsidePit&&!heavyBody)return;
    if(isTrueSuspensionDamage(c))return;
    const target=Math.min(heavyBody?32:Infinity,normalTarget(c));
    const accel=Math.max(3.2,Number(c.accel)||6),brake=Math.max(8,Number(c.brake)||16),step=clamp(Number(dt)||.016,.001,.05),start=Math.max(0,Number(beforeV)||0);
    const recovered=start<target?Math.min(target,start+accel*step):Math.max(target,start-brake*step);
    if(recovered>c.v+.01){c.v=recovered;diagnostics.preEntrySpeedRepairs++;}
  }

  function classifyTopic(text=''){
    const t=String(text).toLowerCase();
    if(/box|pit|come in/.test(t))return'BOX';
    if(/push|attack|pace|energy/.test(t))return'PUSH';
    if(/tyre|tire|temperature|temps|grain|blister/.test(t))return'TYRE';
    if(/fuel|save|lift|coast/.test(t))return'FUEL';
    if(/rain|wet|grip|crossover|standing water/.test(t))return'WEATHER';
    if(/gap|traffic|car behind|car ahead/.test(t))return'GAP';
    if(/safety car|virtual safety|vsc|delta|yellow/.test(t))return'SAFETY';
    if(/damage|puncture|wheel|brake|engine|problem|issue/.test(t))return'DAMAGE';
    return'GENERAL';
  }
  function contextualReply(kind,topic){
    const driver=String(kind||'').toUpperCase()==='DRIVER';
    if(driver){
      if(topic==='BOX')return"I'm boxing this lap and will hit the pit-entry marks.";
      if(topic==='PUSH')return"I'm pushing this lap and using the available energy.";
      if(topic==='TYRE')return"I'll protect the tyres and reduce the sliding.";
      if(topic==='FUEL')return"I'll lift and coast into the heavy braking zones.";
      if(topic==='WEATHER')return"Grip is changing, and I'll keep reporting the surface.";
      if(topic==='GAP')return"Keep me updated on the gap and traffic before the next decision.";
      if(topic==='SAFETY')return"I'll stay on the required delta until race control releases us.";
      if(topic==='DAMAGE')return"I'll manage the car and report if the damage gets worse.";
      return"The target is clear, and I'll keep the car on plan.";
    }
    if(topic==='BOX')return'Pit call confirmed. We will guide you to the box and update exit traffic.';
    if(topic==='PUSH')return'The pace target is confirmed. Use the available performance without overheating the tyres.';
    if(topic==='TYRE')return'Tyre management remains the priority. We will keep monitoring temperatures and wear.';
    if(topic==='FUEL')return'Fuel target is confirmed. We will update you if the saving requirement changes.';
    if(topic==='WEATHER')return'Weather picture is updated. We are monitoring grip and the crossover point.';
    if(topic==='GAP')return'Traffic picture is updated. We will keep feeding you the relevant gaps.';
    if(topic==='SAFETY')return'Race-control instruction is confirmed. Maintain the required delta and position.';
    if(topic==='DAMAGE')return'We are monitoring the damage and will call you in if the car becomes unsafe.';
    return'The current target remains valid. We will update you when the situation changes.';
  }
  function nearestContext(index,message){
    for(let j=index-1;j>=0;j--){
      const p=R.radio[j];if(!p||p.carId!==message.carId)continue;
      const text=String(p.text||'').trim();if(!text)continue;
      let probe=text;for(let k=0;k<4&&genericAck.test(probe);k++)probe=probe.replace(genericAck,'').trim();
      if(probe)return probe;
    }
    return'';
  }
  function makeStandalone(rest,kind,topic){
    let x=String(rest||'').trim();
    for(let i=0;i<4&&genericAck.test(x);i++)x=x.replace(genericAck,'').trim();
    if(!x)return contextualReply(kind,topic);
    if(/^boxing\b/i.test(x))x=`I'm ${x[0].toLowerCase()+x.slice(1)}`;
    else if(/^pushing\b/i.test(x))x=`I'm ${x[0].toLowerCase()+x.slice(1)}`;
    else if(/^saving\b/i.test(x))x=`I'm ${x[0].toLowerCase()+x.slice(1)}`;
    if(!/[.!?]$/.test(x))x+='.';
    return x[0].toUpperCase()+x.slice(1);
  }
  function normalizeRadio(){
    const a=R.radio||[];
    for(let i=0;i<a.length;i++){
      const m=a[i];if(!m?.id||radioSeen.has(m.id))continue;radioSeen.add(m.id);
      const before=String(m.text||'').replace(/\s+/g,' ').trim();if(!before)continue;
      if(!genericAck.test(before))continue;
      const context=nearestContext(i,m),topic=classifyTopic(context||before),after=makeStandalone(before.replace(genericAck,'').trim(),m.kind,topic);
      m.originalConversationText=m.originalConversationText||before;m.text=after;diagnostics.radioRewrites++;
      diagnostics.lastRadio.push({id:m.id,carId:m.carId??null,kind:m.kind||'',topic,before,after});while(diagnostics.lastRadio.length>30)diagnostics.lastRadio.shift();
    }
    if(radioSeen.size>600){const live=new Set(a.map(x=>x?.id).filter(Boolean));for(const id of radioSeen)if(!live.has(id))radioSeen.delete(id);}
  }

  function update(dt){
    const before=R.cars.map(c=>Number(c.v)||0);
    baseUpdate(dt);
    if(R.replay)return;
    for(let i=0;i<R.cars.length;i++){const c=R.cars[i];repairLimpLogic(c,before[i],dt);poseOnRoad(c);}
    normalizeRadio();
    diagnostics.slowCars=R.cars.filter(c=>!c.retired&&c.v<20).map(c=>({id:c.id,lap:c.lap,v:c.v,pitState:c.pitState,fault:c.fault||'',damage:c.damage||0,suspension:c.damageZones?.suspension||0,inPit:!!W.inPitWindow?.(c.s)})).slice(0,20);
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='runtimeRoadPolicy')return{owner:'runtime-pit-road-v1',approachMeters,entryUF,mergeOffset,roadHalf,offsetFor:(s,startLane=0)=>{const fake={s,lane:startLane,_runtimeRoadStartLane:startLane};return roadOffset(fake);}};
    if(prop==='runtimeConversationPolicy')return{owner:'runtime-radio-conversation-v1',genericAckSource:genericAck.source,diagnostics:{radioRewrites:diagnostics.radioRewrites,lastRadio:diagnostics.lastRadio.map(x=>({...x}))}};
    if(prop==='runtimeDamageLimpPolicy')return{owner:'runtime-damage-limp-v1',falseSuspensionRepairs:diagnostics.falseSuspensionRepairs,preEntrySpeedRepairs:diagnostics.preEntrySpeedRepairs,slowCars:diagnostics.slowCars.map(x=>({...x}))};
    return Reflect.get(target,prop,target);
  }});
}
