export function createUI(W,R,D,E,C){
 const style=document.createElement('style');style.textContent=`
 #racePanel{position:fixed;z-index:22;right:10px;top:max(10px,env(safe-area-inset-top));width:min(48vw,210px);background:#07121bce;border:1px solid #ffffff2f;border-radius:12px;padding:8px 9px;backdrop-filter:blur(10px);font-size:10px;line-height:1.3}
 #racePanel .head{display:flex;justify-content:space-between;font-weight:900;margin-bottom:5px;color:#fff}#racePanel .row{display:grid;grid-template-columns:18px 1fr 38px 29px;gap:4px;padding:2px 0;border-top:1px solid #ffffff12;align-items:center}#racePanel .me{color:#65ff9a}#racePanel .tyre{font-weight:900;text-align:center}
 #weatherPanel{position:fixed;z-index:21;left:12px;top:76px;background:#07121bc2;border:1px solid #ffffff28;border-radius:10px;padding:6px 8px;font-size:10px;font-weight:800;backdrop-filter:blur(8px)}
 #eventBanner{position:fixed;z-index:25;top:max(118px,calc(env(safe-area-inset-top) + 104px));left:50%;transform:translateX(-50%);padding:7px 13px;border-radius:8px;background:#0b121ce8;border:1px solid #ffffff38;font-size:12px;font-weight:950;letter-spacing:.5px;opacity:0;transition:opacity .15s;white-space:nowrap}#eventBanner.show{opacity:1}#eventBanner.yellow{background:#8a6a00ed;color:#fff}#eventBanner.sc{background:#9a6d00ed}#eventBanner.replay{background:#9d1324ee}
 #zoomCtl{position:fixed;z-index:31;right:10px;bottom:calc(max(72px,env(safe-area-inset-bottom) + 62px));display:grid;gap:5px}#zoomCtl button{min-width:42px;width:42px;height:38px;padding:0;font-size:18px;background:#07121be6}
 #driverCard{position:fixed;z-index:21;right:10px;bottom:calc(max(126px,env(safe-area-inset-bottom) + 114px));background:#07121bc2;border:1px solid #ffffff28;border-radius:10px;padding:6px 8px;font-size:9px;min-width:118px;backdrop-filter:blur(8px)}
 `;document.head.appendChild(style);
 const rp=document.createElement('div');rp.id='racePanel';document.body.appendChild(rp);
 const wp=document.createElement('div');wp.id='weatherPanel';document.body.appendChild(wp);
 const eb=document.createElement('div');eb.id='eventBanner';document.body.appendChild(eb);
 const dc=document.createElement('div');dc.id='driverCard';document.body.appendChild(dc);
 const z=document.createElement('div');z.id='zoomCtl';z.innerHTML='<button id="zin">＋</button><button id="zout">−</button><button id="zreset">↺</button>';document.body.appendChild(z);z.querySelector('#zin').onclick=C.zoomIn;z.querySelector('#zout').onclick=C.zoomOut;z.querySelector('#zreset').onclick=C.reset;
 let acc=0;const fmt=t=>!Number.isFinite(t)?'--':`${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}`;const tyreColor=c=>R.compounds[c]?.color||'#fff';
 function update(dt,focusId){acc+=dt;if(acc<.18)return;acc=0;const st=R.getStandings(),lead=st[0],lap=Math.min((lead?.lap||0)+1,R.race.lapsTarget);let html=`<div class="head"><span>LAP ${lap}/${R.race.lapsTarget}</span><span>${R.flag}</span></div>`;st.slice(0,10).forEach(c=>{const gap=c===lead?'LEAD':`+${Math.max(0,((lead.lap*W.total+lead.s)-(c.lap*W.total+c.s))/Math.max(1,lead.v)).toFixed(1)}s`;html+=`<div class="row ${c.id===focusId?'me':''}"><b>${c.position}</b><span>${c.name}</span><span>${gap}</span><span class="tyre" style="color:${tyreColor(c.compound)}">${c.compound[0]}${Math.round(c.wear*100)}</span></div>`;});rp.innerHTML=html;
 const h=Math.floor(W.env.timeOfDay),m=Math.floor((W.env.timeOfDay-h)*60);wp.innerHTML=`${E.weather} · ${W.env.temperature}°C<br>${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} · WET ${Math.round(W.env.wetness*100)}%`;
 const c=R.cars[focusId]||lead;if(c)dc.innerHTML=`<b>${c.name} · ${c.type.toUpperCase()}</b><br>P${c.position} · ${c.compound} ${Math.round(c.wear*100)}%<br>PIT ${c.pits} · BEST ${fmt(c.bestLap)}<br>AGR ${Math.round(c.driver.aggression*100)} · RC ${Math.round(c.driver.racecraft*100)} · TY ${Math.round(c.driver.tireCare*100)}`;
 let text=D.banner,cls='';if(R.replay){text='REPLAY';cls='replay';}else if(R.flag==='SC'){text='SAFETY CAR';cls='sc';}else if(R.flag==='YELLOW'){text='YELLOW FLAG';cls='yellow';}eb.textContent=text||'';eb.className=text?`show ${cls}`:'';}
 return{update};
}
