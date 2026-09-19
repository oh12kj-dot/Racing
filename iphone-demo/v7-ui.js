export function createUI(W,R,D,E,C){
 const style=document.createElement('style');style.textContent=`
 #hud{max-width:230px;padding:7px 9px;font-size:11px;background:#07121bb9;border-color:#ffffff26}
 #cam,#controls{display:none}
 body.ui-camera #cam{display:block}
 body.ui-camera #controls{display:flex}
 #uiTabs{position:fixed;z-index:40;right:10px;top:max(10px,env(safe-area-inset-top));display:flex;gap:5px;padding:5px;border-radius:12px;background:#07121bc7;border:1px solid #ffffff24;backdrop-filter:blur(10px)}
 #uiTabs button{height:34px;min-width:46px;padding:0 8px;font-size:10px;border-radius:8px}
 #uiTabs button.on{background:#fff;color:#07121b}
 .sheet{display:none;position:fixed;z-index:35;right:10px;top:58px;width:min(72vw,260px);max-height:58vh;overflow:auto;background:#07121bdf;border:1px solid #ffffff2c;border-radius:12px;padding:9px;backdrop-filter:blur(12px);font-size:10px;line-height:1.35;box-shadow:0 8px 30px #0005}
 .sheet.open{display:block}
 #racePanel .head{display:flex;justify-content:space-between;position:sticky;top:-9px;background:#07121bf2;padding:8px 0 6px;font-weight:950;color:#fff}
 #racePanel .row{display:grid;grid-template-columns:20px 1fr 42px 34px;gap:4px;padding:4px 0;border-top:1px solid #ffffff12;align-items:center}
 #racePanel .me{color:#65ff9a}#racePanel .tyre{font-weight:900;text-align:center}
 #infoPanel .section{padding:5px 0;border-top:1px solid #ffffff16}#infoPanel .section:first-child{border-top:0}#infoPanel b{color:#fff}
 #eventBanner{position:fixed;z-index:45;top:max(58px,calc(env(safe-area-inset-top) + 52px));left:50%;transform:translateX(-50%);padding:7px 13px;border-radius:8px;background:#0b121ce8;border:1px solid #ffffff38;font-size:12px;font-weight:950;letter-spacing:.5px;opacity:0;transition:opacity .15s;white-space:nowrap;pointer-events:none}#eventBanner.show{opacity:1}#eventBanner.yellow{background:#8a6a00ed}#eventBanner.sc{background:#9a6d00ed}
 #zoomCtl{display:none;position:fixed;z-index:41;right:10px;bottom:calc(max(72px,env(safe-area-inset-bottom) + 62px));gap:5px;grid-template-columns:repeat(3,42px)}body.ui-camera #zoomCtl{display:grid}#zoomCtl button{min-width:42px;width:42px;height:38px;padding:0;font-size:18px;background:#07121be6}
 @media(max-width:420px){#controls{left:10px;right:10px;transform:none;justify-content:center;overflow-x:auto}#controls button{min-width:44px;padding:0 7px}.sheet{top:56px}}
 `;document.head.appendChild(style);
 const tabs=document.createElement('div');tabs.id='uiTabs';tabs.innerHTML='<button data-tab="race">順位</button><button data-tab="info">情報</button><button data-tab="camera">CAM</button>';document.body.appendChild(tabs);
 const rp=document.createElement('div');rp.id='racePanel';rp.className='sheet';document.body.appendChild(rp);
 const ip=document.createElement('div');ip.id='infoPanel';ip.className='sheet';document.body.appendChild(ip);
 const eb=document.createElement('div');eb.id='eventBanner';document.body.appendChild(eb);
 const z=document.createElement('div');z.id='zoomCtl';z.innerHTML='<button id="zin">＋</button><button id="zout">−</button><button id="zreset">↺</button>';document.body.appendChild(z);z.querySelector('#zin').onclick=C.zoomIn;z.querySelector('#zout').onclick=C.zoomOut;z.querySelector('#zreset').onclick=C.reset;
 let open=null;
 function setOpen(next){open=open===next?null:next;rp.classList.toggle('open',open==='race');ip.classList.toggle('open',open==='info');document.body.classList.toggle('ui-camera',open==='camera');tabs.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===open));}
 tabs.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>setOpen(b.dataset.tab)));
 let acc=0;const fmt=t=>!Number.isFinite(t)?'--':`${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}`,tyreColor=c=>R.compounds[c]?.color||'#fff';
 function update(dt,focusId){acc+=dt;if(acc<.18)return;acc=0;const st=R.getStandings(),lead=st[0],lap=Math.min((lead?.lap||0)+1,R.race.lapsTarget);let html=`<div class="head"><span>LAP ${lap}/${R.race.lapsTarget}</span><span>${R.flag}</span></div>`;st.forEach(c=>{const gap=c===lead?'LEAD':`+${Math.max(0,((lead.lap*W.total+lead.s)-(c.lap*W.total+c.s))/Math.max(1,lead.v)).toFixed(1)}s`;html+=`<div class="row ${c.id===focusId?'me':''}"><b>${c.position}</b><span>${c.name}</span><span>${gap}</span><span class="tyre" style="color:${tyreColor(c.compound)}">${c.compound[0]}${Math.round(c.wear*100)}</span></div>`;});rp.innerHTML=html;
 const h=Math.floor(W.env.timeOfDay),m=Math.floor((W.env.timeOfDay-h)*60),c=R.cars[focusId]||lead;if(c)ip.innerHTML=`<div class="section"><b>RACE</b><br>${E.weather} · ${W.env.temperature}°C · ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}<br>ROAD WET ${Math.round(W.env.wetness*100)}% · FLAG ${R.flag}</div><div class="section"><b>${c.name} · ${c.type.toUpperCase()}</b><br>P${c.position} · ${c.compound} · WEAR ${Math.round(c.wear*100)}%<br>PIT ${c.pits} · BEST ${fmt(c.bestLap)}</div><div class="section"><b>DRIVER</b><br>AGG ${Math.round(c.driver.aggression*100)} · RACECRAFT ${Math.round(c.driver.racecraft*100)}<br>TYRE ${Math.round(c.driver.tireCare*100)} · WET ${Math.round(c.driver.wetSkill*100)}</div><div class="section"><b>CAMERA</b><br>1本指: 360°回転<br>2本指: ズーム<br>ダブルタップ: リセット</div>`;
 let text=D.banner,cls='';if(R.flag==='SC'){text='SAFETY CAR';cls='sc';}else if(R.flag==='YELLOW'){text='YELLOW FLAG';cls='yellow';}eb.textContent=text||'';eb.className=text?`show ${cls}`:'';}
 return{update};
}
