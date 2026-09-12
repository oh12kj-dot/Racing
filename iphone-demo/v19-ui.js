import {createUI as createV17UI} from './v17-ui.js';

export function createUI(W,R,D,E,C,A,settings,saveSettings){
  const base=createV17UI(W,R,D,E,C,A,settings,saveSettings);
  const drawer=document.getElementById('v16Drawer'),tabs=document.getElementById('v16Tabs');
  let focusId=0,active=false,acc=0;
  if(!drawer||!tabs)return base;

  const style=document.createElement('style');style.textContent=`#v16Drawer.v19telem{height:80vh}#v19Telem{display:none;position:absolute;z-index:5;left:0;right:0;top:45px;bottom:0;overflow:auto;padding:8px;background:#07121bf8;font-size:10px;line-height:1.38}#v19Telem.open{display:block}.v19g{width:100%;height:104px;background:#081017;border:1px solid #ffffff12;border-radius:8px;margin-top:5px}`;document.head.appendChild(style);
  const tab=document.createElement('button');tab.id='v19TelemetryTab';tab.textContent='TELEM';const cam=tabs.querySelector('[data-tab="cam"]');tabs.insertBefore(tab,cam||null);
  const panel=document.createElement('div');panel.id='v19Telem';drawer.appendChild(panel);

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function plot(canvas,data,defs){
    if(!canvas||data.length<2)return;
    const dpr=Math.min(devicePixelRatio||1,1.5),w=Math.max(250,canvas.clientWidth||320),h=104;canvas.width=w*dpr;canvas.height=h*dpr;
    const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);g.strokeStyle='#ffffff16';g.lineWidth=1;
    for(let i=1;i<4;i++){g.beginPath();g.moveTo(0,h*i/4);g.lineTo(w,h*i/4);g.stroke();}
    for(const d of defs){g.strokeStyle=d.color;g.lineWidth=1.6;g.beginPath();data.forEach((x,i)=>{const px=i/(data.length-1)*w,py=h-clamp(((Number(x[d.key])||0)-d.min)/(d.max-d.min),0,1)*h;if(i)g.lineTo(px,py);else g.moveTo(px,py);});g.stroke();}
  }
  function render(){
    if(!active)return;const c=R.cars[focusId]||R.getStandings()[0];if(!c)return;
    const data=(R.telemetryFor?.(c.id)||[]).slice(-120),last=data[data.length-1]||{},p=c.driverProfile||{};
    panel.innerHTML=`<div class="v16section"><b>TELEMETRY · ${c.name}</b><br><span class="muted">${c.type.toUpperCase()} · ${c.driverStyle||'DRIVER'} · ${Math.round(data.length/10)}s history</span></div><div class="v16section"><span class="tag">${Math.round(last.speed||c.v*3.6)} km/h</span><span class="tag">G${last.gear||1}</span><span class="tag good">THR ${Math.round((last.throttle||0)*100)}%</span><span class="tag bad">BRK ${Math.round((last.brake||0)*100)}%</span><span class="tag">STEER ${Math.round((last.steer||0)*100)}</span>${c.spinState&&c.spinState!=='NONE'?`<span class="tag warn">${c.spinState}</span>`:''}</div><div class="v16section"><b>SPEED</b><canvas id="v19s" class="v19g"></canvas></div><div class="v16section"><b>THROTTLE / BRAKE / STEER</b><canvas id="v19c" class="v19g"></canvas></div><div class="v16section"><b>LAT-G / LONG-G</b><canvas id="v19g" class="v19g"></canvas></div><div class="v16section"><b>TEMPERATURE</b><br>TYRE ${Math.round(last.tyre||c.tyreTemp||0)}°C · ENGINE ${Math.round(last.engine||c.engineTemp||0)}°C</div><div class="v16section"><b>DRIVER · ${c.driverStyle}</b><br><span class="tag">QUALI ${Math.round((p.quali||1)*100)}</span><span class="tag">PACE ${Math.round((p.pace||1)*100)}</span><span class="tag">CONS ${Math.round((p.consistency||1)*100)}</span><span class="tag">TYRE ${Math.round((p.tyre||1)*100)}</span><span class="tag">WET ${Math.round((p.wet||1)*100)}</span><span class="tag">OVTK ${Math.round((p.overtake||1)*100)}</span><span class="tag">DEF ${Math.round((p.defense||1)*100)}</span></div>`;
    plot(panel.querySelector('#v19s'),data,[{key:'speed',min:0,max:360,color:'#fff'}]);
    plot(panel.querySelector('#v19c'),data,[{key:'throttle',min:0,max:1,color:'#61ff8c'},{key:'brake',min:0,max:1,color:'#ff6666'},{key:'steer',min:-1,max:1,color:'#67cfff'}]);
    plot(panel.querySelector('#v19g'),data,[{key:'gLat',min:-3.5,max:3.5,color:'#55dfff'},{key:'gLong',min:-3.5,max:3.5,color:'#ffd95a'}]);
  }

  tab.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();active=true;drawer.classList.add('v19telem');panel.classList.add('open');tabs.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===tab));render();},{capture:true});
  tabs.addEventListener('click',e=>{if(e.target===tab)return;active=false;drawer.classList.remove('v19telem');panel.classList.remove('open');},{capture:true});
  const oldUpdate=base.update;return new Proxy(base,{get(target,prop){if(prop==='update')return(dt,id)=>{focusId=Number(id)||0;oldUpdate(dt,id);acc+=dt;if(active&&acc>=.5){acc=0;render();}};return Reflect.get(target,prop,target);}});
}
