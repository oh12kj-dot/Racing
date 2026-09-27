function fmtTime(sec){
  if(sec==null||!Number.isFinite(sec))return '--:--.-';
  const m=Math.floor(sec/60),s=Math.max(0,sec-m*60);
  return `${m}:${s.toFixed(1).padStart(4,'0')}`;
}
function fmtDelta(row,metersKey,secondsKey,leader=false){
  if(leader)return 'LEAD';
  const seconds=row?.[secondsKey];
  if(Number.isFinite(seconds))return `+${seconds.toFixed(1)}s`;
  const meters=row?.[metersKey];
  if(Number.isFinite(meters))return `+${Math.round(meters)}m`;
  return '--';
}
function fmtCompound(compound){return compound==='INTERMEDIATE'?'INT':compound||'SLICK';}
function fmtEnergy(sys){
  const capacity=Math.max(0,sys?.energyCapacityMJ||0);
  if(capacity<=0)return '';
  const soc=Math.max(0,Math.min(1,(sys.energyMJ||0)/capacity));
  const reserve=Math.max(0,Math.min(1,sys.energyReserveTarget||0));
  const deploy=Math.max(0,Math.min(1,sys.energyDeploy||0));
  const harvest=Math.max(0,Math.min(1,sys.energyHarvest||0));
  let activity='READY';
  if(harvest>.02)activity=`HARVEST ${Math.round(harvest*100)}%`;
  else if(deploy>.02)activity=`DEPLOY ${Math.round(deploy*100)}%`;
  else if(sys.energyMode==='RESERVE')activity='RESERVE';
  return `ERS ${Math.round(soc*100)}% · ${sys.energyStrategy||'BALANCED'} · ${activity} · RSV ${Math.round(reserve*100)}%`;
}
function setText(node,value){const next=String(value);if(node.textContent!==next)node.textContent=next;}
function makeDiv(className=''){const node=document.createElement('div');if(className)node.className=className;return node;}

export function createUI(root,callbacks={}){
  root.innerHTML=`
  <div class="hud">
    <div class="topbar">
      <div class="chip race-state"><span class="flag" id="flag">GREEN</span><span id="procedure" hidden></span><span id="lap">LAP 0/8</span><span id="clock">0:00.0</span><span id="weather">DRY</span></div>
      <div class="chip camera-label" id="cameraLabel">AUTO</div>
    </div>
    <div class="leaderboard" id="leaderboard"></div>
    <div class="radio" id="radio"></div>
    <div class="telemetry" id="telemetry"></div>
    <div class="bottombar">
      <button data-cam="AUTO">AUTO</button>
      <button data-cam="TV">TV</button>
      <button data-cam="FOLLOW">FOLLOW</button>
      <button data-cam="ONBOARD">ONBOARD</button>
      <button data-cam="PIT">PIT</button>
      <button data-act="prev">◀ CAR</button>
      <button data-act="next">CAR ▶</button>
      <button data-act="audio">AUDIO</button>
    </div>
  </div>`;
  const els={
    flag:root.querySelector('#flag'),procedure:root.querySelector('#procedure'),lap:root.querySelector('#lap'),clock:root.querySelector('#clock'),weather:root.querySelector('#weather'),
    camera:root.querySelector('#cameraLabel'),board:root.querySelector('#leaderboard'),radio:root.querySelector('#radio'),tele:root.querySelector('#telemetry')
  };
  root.querySelectorAll('[data-cam]').forEach(b=>b.addEventListener('click',()=>callbacks.onCamera?.(b.dataset.cam)));
  root.querySelector('[data-act="prev"]').addEventListener('click',()=>callbacks.onPrev?.());
  root.querySelector('[data-act="next"]').addEventListener('click',()=>callbacks.onNext?.());
  root.querySelector('[data-act="audio"]').addEventListener('click',()=>callbacks.onAudio?.());

  const rowNodes=new Map();
  els.board.addEventListener('click',event=>{
    const row=event.target.closest?.('.lb-row[data-id]');
    if(row&&els.board.contains(row))callbacks.onSelect?.(Number(row.dataset.id));
  });

  function ensureRow(car){
    let item=rowNodes.get(car.id);
    if(item)return item;
    const node=document.createElement('div');
    node.className='lb-row';node.dataset.id=String(car.id);
    node.innerHTML='<div class="lb-pos"></div><div><div class="lb-name"></div><div class="lb-class"></div></div><div class="lb-speed"></div><div class="gap"></div>';
    item={
      node,
      pos:node.querySelector('.lb-pos'),name:node.querySelector('.lb-name'),klass:node.querySelector('.lb-class'),
      speed:node.querySelector('.lb-speed'),gap:node.querySelector('.gap')
    };
    rowNodes.set(car.id,item);
    return item;
  }

  function syncRowOrder(order){
    const desired=order.map(c=>String(c.id));
    const current=[...els.board.children].map(n=>n.dataset.id);
    if(desired.length===current.length&&desired.every((id,i)=>id===current[i]))return;
    const fragment=document.createDocumentFragment();
    for(const car of order)fragment.appendChild(ensureRow(car).node);
    els.board.replaceChildren(fragment);
  }

  const tele={
    identity:makeDiv('muted'),
    speed:makeDiv('big'),
    position:makeDiv('muted'),
    state:makeDiv('muted'),
    tyre:makeDiv('muted'),
    fuel:makeDiv('muted'),
    energy:makeDiv('muted'),
    laps:makeDiv('muted')
  };
  const speedValue=document.createTextNode('0 '),speedUnit=document.createElement('span');
  speedUnit.className='muted';speedUnit.textContent='km/h';tele.speed.append(speedValue,speedUnit);
  els.tele.append(tele.identity,tele.speed,tele.position,tele.state,tele.tyre,tele.fuel,tele.energy,tele.laps);
  tele.energy.hidden=true;
  let radioKey='';

  function updateTelemetry(car,row,snapshot,weather){
    const sys=car.systems;
    const displayLap=row?.currentLap??(car.lap<0?0:Math.min(snapshot.RACE_LAPS,car.lap+1));
    const gap=fmtDelta(row,'gapToLeaderMeters','gapToLeaderSeconds',row?.overallPosition===1);
    const interval=fmtDelta(row,'intervalMeters','intervalSeconds',row?.overallPosition===1);
    const reliability=sys.failed?`FAIL ${sys.failureReason??'MECHANICAL'}`:`ENG ${Math.round(sys.engineTemp)}°C · STRESS ${Math.round((sys.mechanicalStress||0)*100)}% · DERATE ${Math.round((sys.powerDerate||0)*100)}%`;
    const energy=fmtEnergy(sys);
    setText(tele.identity,`${car.number} ${car.name} · ${car.spec.label}${car.blueFlag?' · BLUE FLAG':''}`);
    const speed=`${Math.round(car.v*3.6)} `;if(speedValue.nodeValue!==speed)speedValue.nodeValue=speed;
    setText(tele.position,`P${row?.overallPosition??'--'} · CLASS P${row?.classPosition??'--'} · GAP ${gap} · INT ${interval}`);
    setText(tele.state,`L${displayLap} · ${row?.status??car.pit.phase} · ${car.racecraft.state} · PITS ${row?.pitStops??0}`);
    setText(tele.tyre,`TYRE ${fmtCompound(sys.tyreCompound)} · WEAR ${Math.round(sys.tyreWear*100)}% · ${Math.round(sys.tyreTemp)}°C · WET ${Math.round((weather?.wetness??0)*100)}%`);
    setText(tele.fuel,`FUEL ${sys.fuel.toFixed(1)}L · ${reliability}`);
    tele.energy.hidden=!energy;setText(tele.energy,energy);
    setText(tele.laps,`CUR ${fmtTime(row?.currentLapTime)} · LAST ${fmtTime(row?.lastLap)} · BEST ${fmtTime(row?.bestLap)}`);
  }

  function updateRadio(events){
    const lines=events.slice(-4);
    const nextKey=lines.map(e=>`${e.id}:${e.text}`).join('|');
    if(nextKey===radioKey)return;
    radioKey=nextKey;
    const fragment=document.createDocumentFragment();
    for(const event of lines){const node=makeDiv('radio-line');node.textContent=event.text;fragment.appendChild(node);}
    els.radio.replaceChildren(fragment);
  }

  function update(snapshot,cameraState){
    setText(els.flag,snapshot.flag);els.flag.dataset.flag=snapshot.flag;
    const procedure=snapshot.restartPhase==='RED_STOP'?'STOP UNDER RED':snapshot.restartPhase==='SC_FORMATION'?'SC RESTART FORMATION':'';
    setText(els.procedure,procedure);els.procedure.hidden=!procedure;
    setText(els.lap,`LAP ${Math.min(snapshot.RACE_LAPS,Math.max(0,snapshot.lap))}/${snapshot.RACE_LAPS}`);
    setText(els.clock,fmtTime(snapshot.time));setText(els.camera,cameraState?.mode||'AUTO');
    const weather=snapshot.environment;
    setText(els.weather,weather?`${weather.condition} ${Math.round(weather.wetness*100)}%`:'DRY');
    const rows=new Map((snapshot.classification||[]).map(row=>[row.carId,row]));
    syncRowOrder(snapshot.order);
    for(let i=0;i<snapshot.order.length;i++){
      const c=snapshot.order[i],item=ensureRow(c),row=rows.get(c.id);
      const gap=fmtDelta(row,'gapToLeaderMeters','gapToLeaderSeconds',i===0);
      const interval=fmtDelta(row,'intervalMeters','intervalSeconds',i===0);
      const status=row?.status??'--';
      const statusLabel=c.systems?.failed&&status==='RUNNING'?'FAIL':c.blueFlag&&status==='RUNNING'?'BLUE':status;
      const overall=row?.overallPosition??i+1;
      const classPosition=row?.classPosition??'--';
      const pitStops=row?.pitStops??0;
      item.node.classList.toggle('active',cameraState?.tracked?.id===c.id);
      setText(item.pos,overall);
      setText(item.name,`${c.number} ${c.name}`);
      setText(item.klass,`${c.spec.label} P${classPosition} · ${statusLabel} · ${fmtCompound(c.systems?.tyreCompound)} · INT ${interval} · PITS ${pitStops}`);
      setText(item.speed,Math.round(c.v*3.6));
      setText(item.gap,gap);
    }
    const car=cameraState?.tracked;
    if(car)updateTelemetry(car,rows.get(car.id),snapshot,weather);
    updateRadio(snapshot.events);
  }
  return{update};
}