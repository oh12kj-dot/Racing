import {createUI as createV10UI} from './v10-ui.js';

export function createUI(W,R,D,E,C,A,settings,saveSettings){
  const base=createV10UI(W,R,D,E,C,A,settings,saveSettings),tabs=document.getElementById('v10Tabs'),body=document.getElementById('v10Body');
  if(!tabs||!body)return base;
  const b=document.createElement('button');b.textContent='STRAT';b.dataset.v13='strategy';tabs.insertBefore(b,tabs.querySelector('[data-v="cam"]'));
  function pct(x){return `${Math.round((x||0)*100)}%`;}
  function renderStrategy(){const st=R.getStandings(),strategies=R.pitStrategy||[];let h='<div class="section"><b>PIT STRATEGY</b><br><span class="muted">予想タイヤ寿命 / ピット判断 / 燃料・充電 / ダメージ</span></div>';for(const c of st){const s=strategies.find(x=>x.carId===c.id)||{};h+=`<div class="row tap" data-v13car="${c.id}"><b>${c.position}</b><span>${c.name}<br><span class="muted">${s.window||'--'} · ${c.pitService||c.pitLaneStatus||'TRACK'}</span></span><span>${Number.isFinite(s.tyreLifeLaps)?s.tyreLifeLaps.toFixed(1)+'L':'--'}</span><span>${pct(c.wear)}</span></div><div class="section" style="padding:3px 4px"><span class="tag">FUEL ${pct(s.fuel)}</span><span class="tag">CHG ${pct(s.charge)}</span><span class="tag ${s.undercut==='STRONG'?'good':''}">UNDER ${s.undercut||'--'}</span><span class="tag">OVER ${s.overcut||'--'}</span>${c.damageState&&c.damageState!=='OK'?`<span class="tag bad">DMG ${c.damageState}</span>`:''}${c._pitFailure?`<span class="tag bad">${c._pitFailure}</span>`:''}</div>`;}body.innerHTML=h;}
  b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();tabs.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));renderStrategy();},{capture:true});
  body.addEventListener('click',e=>{const row=e.target.closest('[data-v13car]');if(!row)return;C.setFocus(Number(row.dataset.v13car));A?.setFocus?.(Number(row.dataset.v13car));});
  const oldUpdate=base.update;return new Proxy(base,{get(target,prop){if(prop==='update')return(dt,id)=>{oldUpdate(dt,id);if(b.classList.contains('on'))renderStrategy();};return Reflect.get(target,prop,target);}});
}
