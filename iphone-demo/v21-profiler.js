export function createProfiler(W,{mobile=false}={}){
  const r=W.renderer,gl=r.getContext(),ext=gl.getExtension?.('EXT_disjoint_timer_query_webgl2');
  const ema=new Map(),alpha=.12;let frameStart=0,lastPaint=0,open=false,gpuMs=null,pending=null,shadowUpdated=false;
  const avg=(k,v)=>{const old=ema.get(k);ema.set(k,old==null?v:old+(v-old)*alpha);};
  const btn=document.createElement('button');btn.textContent='PERF';btn.style.cssText='position:fixed;z-index:96;right:10px;bottom:max(10px,env(safe-area-inset-bottom));height:30px;min-width:48px;padding:0 7px;border-radius:8px;background:#07121bea;color:#fff;border:1px solid #ffffff35;font:900 9px -apple-system,sans-serif';document.body.appendChild(btn);
  const panel=document.createElement('div');panel.style.cssText='display:none;position:fixed;z-index:95;right:10px;bottom:max(46px,calc(env(safe-area-inset-bottom) + 42px));width:min(88vw,320px);padding:9px;border-radius:10px;background:#07121bf2;border:1px solid #ffffff30;color:#fff;font:700 10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;backdrop-filter:blur(10px);pointer-events:none';document.body.appendChild(panel);
  btn.onclick=()=>{open=!open;panel.style.display=open?'block':'none';};
  function measure(name,fn){const t=performance.now(),v=fn(),ms=performance.now()-t;avg(name,ms);return v;}
  function gpuBegin(){if(!ext||pending)return null;try{const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);return q;}catch{return null;}}
  function gpuEnd(q){if(!q||!ext)return;try{gl.endQuery(ext.TIME_ELAPSED_EXT);pending=q;}catch{try{gl.deleteQuery(q);}catch{}}}
  function pollGpu(){if(!ext||!pending)return;try{const ready=gl.getQueryParameter(pending,gl.QUERY_RESULT_AVAILABLE),disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);if(ready){if(!disjoint){gpuMs=gl.getQueryParameter(pending,gl.QUERY_RESULT)/1e6;avg('GPU',gpuMs);}gl.deleteQuery(pending);pending=null;}}catch{pending=null;}}
  function paint(now){if(!open||now-lastPaint<500)return;lastPaint=now;const info=r.info,frame=ema.get('FRAME')||0,entries=[...ema.entries()].filter(([k])=>!['FRAME','GPU'].includes(k)).sort((a,b)=>b[1]-a[1]).slice(0,8);const gpu=ema.get('GPU');panel.innerHTML=`<b>RUNTIME PROFILER ${mobile?'· MOBILE':''}</b><br>FPS ${(1000/Math.max(1,frame)).toFixed(1)} · FRAME ${frame.toFixed(2)} ms<br>GPU ${gpu==null?'N/A':gpu.toFixed(2)+' ms'} · DPR ${r.getPixelRatio().toFixed(2)}<br>CALLS ${info.render.calls} · TRI ${(info.render.triangles/1000).toFixed(0)}k<br>GEO ${info.memory.geometries} · TEX ${info.memory.textures}<br>SHADOW ${shadowUpdated?'UPDATED':'CACHED'}<hr style="border:0;border-top:1px solid #ffffff22">${entries.map(([k,v],i)=>`${i+1}. ${k.padEnd(12,' ')} ${v.toFixed(2)} ms`).join('<br>')}<br><span style="opacity:.65">Render CPU = JS→WebGL submission. GPU ms appears only when Safari exposes EXT_disjoint_timer_query_webgl2.</span>`;}
  function beginFrame(){frameStart=performance.now();shadowUpdated=false;pollGpu();}
  function endFrame({shadow=false}={}){shadowUpdated=shadow;avg('FRAME',performance.now()-frameStart);paint(performance.now());}
  return{measure,beginFrame,endFrame,gpuBegin,gpuEnd,record:(name,ms)=>avg(name,ms)};
}
