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
export function createUI(root,callbacks={}){
  root.innerHTML=`
  <div class="hud">
    <div class="topbar">
      <div class="chip race-state"><span class="flag" id="flag">GREEN</span><span id="lap">LAP 0/8</span><span id="clock">0:00.0</span></div>
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
    flag:root.querySelector('#flag'),lap:root.querySelector('#lap'),clock:root.querySelector('#clock'),
    camera:root.querySelector('#cameraLabel'),board:root.querySelector('#leaderboard'),radio:root.querySelector('#radio'),tele:root.querySelector('#telemetry')
  };
  root.querySelectorAll('[data-cam]').forEach(b=>b.addEventListener('click',()=>callbacks.onCamera?.(b.dataset.cam)));
  root.querySelector('[data-act="prev"]').addEventListener('click',()=>callbacks.onPrev?.());
  root.querySelector('[data-act="next"]').addEventListener('click',()=>callbacks.onNext?.());
  root.querySelector('[data-act="audio"]').addEventListener('click',()=>callbacks.onAudio?.());

  function update(snapshot,cameraState){
    els.flag.textContent=snapshot.flag;els.flag.dataset.flag=snapshot.flag;
    els.lap.textContent=`LAP ${Math.min(snapshot.RACE_LAPS,Math.max(0,snapshot.lap))}/${snapshot.RACE_LAPS}`;
    els.clock.textContent=fmtTime(snapshot.time);els.camera.textContent=cameraState?.mode||'AUTO';
    const rows=new Map((snapshot.classification||[]).map(row=>[row.carId,row]));
    els.board.innerHTML=snapshot.order.map((c,i)=>{
      const row=rows.get(c.id);
      const gap=fmtDelta(row,'gapToLeaderMeters','gapToLeaderSeconds',i===0);
      const interval=fmtDelta(row,'intervalMeters','intervalSeconds',i===0);
      const status=row?.status??'--';
      const statusLabel=c.blueFlag&&status==='RUNNING'?'BLUE':status;
      const overall=row?.overallPosition??i+1;
      const classPosition=row?.classPosition??'--';
      const pitStops=row?.pitStops??0;
      return `<div class="lb-row ${cameraState?.tracked?.id===c.id?'active':''}" data-id="${c.id}">
        <div class="lb-pos">${overall}</div>
        <div><div class="lb-name">${c.number} ${c.name}</div><div class="lb-class">${c.spec.label} P${classPosition} · ${statusLabel} · INT ${interval} · PITS ${pitStops}</div></div>
        <div>${Math.round(c.v*3.6)}</div><div class="gap">${gap}</div>
      </div>`;
    }).join('');
    els.board.querySelectorAll('[data-id]').forEach(r=>r.addEventListener('click',()=>callbacks.onSelect?.(Number(r.dataset.id))));
    const car=cameraState?.tracked;
    if(car){
      const sys=car.systems;
      const row=rows.get(car.id);
      const displayLap=row?.currentLap??(car.lap<0?0:Math.min(snapshot.RACE_LAPS,car.lap+1));
      const gap=fmtDelta(row,'gapToLeaderMeters','gapToLeaderSeconds',row?.overallPosition===1);
      const interval=fmtDelta(row,'intervalMeters','intervalSeconds',row?.overallPosition===1);
      els.tele.innerHTML=`<div class="muted">${car.number} ${car.name} · ${car.spec.label}${car.blueFlag?' · BLUE FLAG':''}</div>
        <div class="big">${Math.round(car.v*3.6)} <span class="muted">km/h</span></div>
        <div class="muted">P${row?.overallPosition??'--'} · CLASS P${row?.classPosition??'--'} · GAP ${gap} · INT ${interval}</div>
        <div class="muted">L${displayLap} · ${row?.status??car.pit.phase} · ${car.racecraft.state} · PITS ${row?.pitStops??0}</div>
        <div class="muted">FUEL ${sys.fuel.toFixed(1)}L · TYRE ${Math.round(sys.tyreWear*100)}% · ${Math.round(sys.tyreTemp)}°C</div>
        <div class="muted">CUR ${fmtTime(row?.currentLapTime)} · LAST ${fmtTime(row?.lastLap)} · BEST ${fmtTime(row?.bestLap)}</div>`;
    }
    const lines=snapshot.events.slice(-4);
    els.radio.innerHTML=lines.map(e=>`<div class="radio-line">${e.text}</div>`).join('');
  }
  return{update};
}
