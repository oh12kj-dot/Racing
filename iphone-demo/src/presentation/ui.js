function fmtTime(sec){
  const m=Math.floor(sec/60),s=Math.max(0,sec-m*60);
  return `${m}:${s.toFixed(1).padStart(4,'0')}`;
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
    camera:root.querySelector('#cameraLabel'),board:root.querySelector('#leaderboard'),
    radio:root.querySelector('#radio'),tele:root.querySelector('#telemetry')
  };
  root.querySelectorAll('[data-cam]').forEach(b=>b.addEventListener('click',()=>callbacks.onCamera?.(b.dataset.cam)));
  root.querySelector('[data-act="prev"]').addEventListener('click',()=>callbacks.onPrev?.());
  root.querySelector('[data-act="next"]').addEventListener('click',()=>callbacks.onNext?.());
  root.querySelector('[data-act="audio"]').addEventListener('click',()=>callbacks.onAudio?.());

  function update(snapshot,cameraState){
    els.flag.textContent=snapshot.flag;
    els.lap.textContent=`LAP ${Math.max(0,snapshot.lap)+1}/${snapshot.RACE_LAPS}`;
    els.clock.textContent=fmtTime(snapshot.time);
    els.camera.textContent=cameraState?.mode||'AUTO';
    const leaderProgress=snapshot.order[0]?.totalProgress||0;
    els.board.innerHTML=snapshot.order.map((c,i)=>{
      const gap=i===0?'LEAD':`+${Math.max(0,(leaderProgress-c.totalProgress)/Math.max(1,c.v)).toFixed(1)}s`;
      return `<div class="lb-row ${cameraState?.tracked?.id===c.id?'active':''}" data-id="${c.id}">
        <div class="lb-pos">${i+1}</div>
        <div><div class="lb-name">${c.number} ${c.name}</div><div class="lb-class">${c.spec.label} · ${c.pit.phase==='TRACK'?c.controlSource||'RACE':c.pit.phase}</div></div>
        <div>${Math.round(c.v*3.6)}</div><div class="gap">${gap}</div>
      </div>`;
    }).join('');
    els.board.querySelectorAll('[data-id]').forEach(r=>r.addEventListener('click',()=>callbacks.onSelect?.(Number(r.dataset.id))));
    const car=cameraState?.tracked;
    if(car){
      els.tele.innerHTML=`<div class="muted">${car.number} ${car.name} · ${car.spec.label}</div>
        <div class="big">${Math.round(car.v*3.6)} <span class="muted">km/h</span></div>
        <div class="muted">L${Math.max(0,car.lap)+1} · ${car.pit.phase} · ${car.racecraft.state}</div>`;
    }
    const lines=snapshot.events.slice(-4);
    els.radio.innerHTML=lines.map(e=>`<div class="radio-line">${e.text}</div>`).join('');
  }
  return{update};
}
