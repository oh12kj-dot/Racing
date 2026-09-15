import {LOG_POLICY} from './v42-config.js';

export function createProfiler(W,{mobile=false,targetFps=60,race=null,director=null,audio=null}={}){
  const r=W.renderer,gl=r.getContext(),ext=gl.getExtension?.('EXT_disjoint_timer_query_webgl2');
  const ema=new Map(),alpha=.12,history=[];
  let frameStart=0,lastFrameStart=0,lastPaint=0,lastSample=0,open=false,pending=null,shadowUpdated=false,longFrames=0,totalFrames=0;
  const generation=race?.logGeneration||{id:`run-${Date.now().toString(36)}`,startedAt:Date.now(),persistent:false};
  const avg=(k,v)=>{if(!Number.isFinite(v))return;const old=ema.get(k);ema.set(k,old==null?v:old+(v-old)*alpha);};

  const btn=document.createElement('button');btn.textContent='PERF';
  btn.style.cssText='position:fixed;z-index:96;right:10px;bottom:max(10px,env(safe-area-inset-bottom));height:30px;min-width:48px;padding:0 7px;border-radius:8px;background:#07121bea;color:#fff;border:1px solid #ffffff35;font:900 9px -apple-system,sans-serif';
  document.body.appendChild(btn);
  const panel=document.createElement('div');
  panel.style.cssText='display:none;position:fixed;z-index:95;right:10px;bottom:max(46px,calc(env(safe-area-inset-bottom) + 42px));width:min(92vw,380px);max-height:68vh;overflow:auto;padding:9px;border-radius:10px;background:#07121bf2;border:1px solid #ffffff30;color:#fff;font:700 10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;backdrop-filter:blur(10px)';
  document.body.appendChild(panel);btn.onclick=()=>{open=!open;panel.style.display=open?'block':'none';};

  function measure(name,fn){const t=performance.now(),v=fn(),ms=performance.now()-t;avg(name,ms);return v;}
  function gpuBegin(){if(!ext||pending)return null;try{const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);return q;}catch{return null;}}
  function gpuEnd(q){if(!q||!ext)return;try{gl.endQuery(ext.TIME_ELAPSED_EXT);pending=q;}catch{try{gl.deleteQuery(q);}catch{}}}
  function pollGpu(){
    if(!ext||!pending)return;
    try{
      const ready=gl.getQueryParameter(pending,gl.QUERY_RESULT_AVAILABLE),disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
      if(ready){if(!disjoint)avg('GPU',gl.getQueryParameter(pending,gl.QUERY_RESULT)/1e6);gl.deleteQuery(pending);pending=null;}
    }catch{pending=null;}
  }
  function qualityState(){try{const pm=window.__RACING_PM__;return pm?{level:pm.level,mode:pm.mode,config:{...pm.config}}:null;}catch{return null;}}
  function snapshot(now=performance.now()){
    const info=r.info,interval=ema.get('INTERVAL')||0,work=ema.get('WORK')||0,gpu=ema.get('GPU');
    return{t:Math.round(now),fps:interval>0?1000/interval:0,intervalMs:interval,workMs:work,gpuMs:gpu??null,dpr:r.getPixelRatio(),calls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures,longFrameRate:totalFrames?longFrames/totalFrames:0,targetFps,quality:qualityState(),cameraCutsPerMinute:director?.cutsPerMinute??null,audio:{enabled:audio?.enabled??null,state:audio?.audioState??null,speaking:audio?.speaking??null,queue:audio?.queueLength??null,focus:audio?.radioFocus??null}};
  }
  function sample(now){
    if(now-lastSample<2000)return;lastSample=now;history.push(snapshot(now));
    if(history.length>LOG_POLICY.profilerSamples)history.splice(0,history.length-LOG_POLICY.profilerSamples);
  }
  function diagnosticsPayload(){
    const dyn=(race?.dynamicsTelemetry||[]).slice(-LOG_POLICY.dynamicsSamples);
    return{
      version:'v42',capturedAt:new Date().toISOString(),generation,
      retention:{...LOG_POLICY,persistence:'none',storage:'memory-only until page close'},
      ua:navigator.userAgent,mobile,targetFps,
      device:{screen:[screen.width,screen.height],viewport:[innerWidth,innerHeight],devicePixelRatio:devicePixelRatio||1,hardwareConcurrency:navigator.hardwareConcurrency??null,deviceMemory:navigator.deviceMemory??null,visibility:document.visibilityState},
      quality:qualityState(),circuitAudit:W.auditCircuit?.()||W.circuitAudit||null,
      samples:history.slice(-LOG_POLICY.diagnosticSamples),latest:snapshot(),
      camera:{cutsPerMinute:director?.cutsPerMinute??null,cutHistory:(director?.cutHistory||[]).slice(-30)},
      audio:{enabled:audio?.enabled??null,state:audio?.audioState??null,speaking:audio?.speaking??null,queue:audio?.queueLength??null,focus:audio?.radioFocus??null,silentModeRespectSupported:audio?.silentModeRespectSupported??null},
      dynamics:dyn,pit:(race?.cars||[]).filter(c=>c.pitState!=='NONE').map(c=>({id:c.id,name:c.name,state:c.pitState,s:c.s,status:c.pitLaneStatus}))
    };
  }
  async function copyLog(){
    const text=JSON.stringify(diagnosticsPayload(),null,2);
    try{await navigator.clipboard?.writeText(text);return true;}
    catch{try{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();return true;}catch{return false;}}
  }
  function clearLogs(){history.length=0;race?.clearDiagnostics?.();return true;}
  function paint(now){
    if(!open||now-lastPaint<500)return;lastPaint=now;
    const info=r.info,interval=ema.get('INTERVAL')||0,work=ema.get('WORK')||0,fps=interval?1000/interval:0,gpu=ema.get('GPU'),budget=1000/Math.max(1,targetFps),quality=qualityState(),entries=[...ema.entries()].filter(([k])=>!['INTERVAL','WORK','GPU'].includes(k)).sort((a,b)=>b[1]-a[1]).slice(0,8),focus=director?.focus!=null?race?.cars?.[director.focus]:null,audit=W.circuitAudit;
    panel.innerHTML=`<b>RUNTIME PROFILER v42 ${mobile?'· MOBILE':''}</b><br>ACTUAL FPS ${fps.toFixed(1)} · INTERVAL ${interval.toFixed(2)} ms<br>CPU WORK ${work.toFixed(2)} ms · GPU ${gpu==null?'N/A':gpu.toFixed(2)+' ms'}<br>BUDGET ${budget.toFixed(2)} ms · DPR ${r.getPixelRatio().toFixed(2)} · AQ ${quality?.level??0}<br>CALLS ${info.render.calls} · TRI ${(info.render.triangles/1000).toFixed(0)}k · LONG ${(totalFrames?longFrames/totalFrames*100:0).toFixed(1)}%<br>LOG ${history.length}/${LOG_POLICY.profilerSamples} · MEMORY ONLY · GEN ${generation.id}<br>PIT ENTRY HITS ${audit?.pitOpenings?.entry?.hits??'-'} · EXIT HITS ${audit?.pitOpenings?.exit?.hits??'-'} · BLDG CLEAR ${audit?.minimumPitLaneBuildingClearance?.toFixed?.(1)??'-'}m<br>CAM CUTS/MIN ${director?.cutsPerMinute??'-'} · RADIO ${audio?.speaking?'TX':'IDLE'} · Q ${audio?.queueLength??'-'}${focus?`<br>CAR ${focus.number} ${focus.racingMode||'CORE'} · ${(focus.v*3.6).toFixed(0)} km/h · A ${(focus.racingLongAccel??0).toFixed(2)} · J ${(focus.racingJerk??0).toFixed(1)}<br>LINE ${focus.racingLineMode||'-'} · DEV ${(focus.racingLineDeviation??0).toFixed(2)} · LAT ${(focus.racingLatUse??0).toFixed(2)}`:''}<hr style="border:0;border-top:1px solid #ffffff22">${entries.map(([k,v],i)=>`${i+1}. ${k.padEnd(13,' ')} ${v.toFixed(2)} ms`).join('<br>')}<br><button id="v42CopyPerf" style="margin-top:8px;height:30px;background:#fff;color:#07121b;border:0;border-radius:6px;font-weight:900">COPY DIAGNOSTICS</button><button id="v42ClearPerf" style="margin:8px 0 0 6px;height:30px;background:#27323a;color:#fff;border:1px solid #ffffff33;border-radius:6px;font-weight:900">CLEAR LOGS</button><span id="v42CopyState" style="margin-left:7px;opacity:.7"></span>`;
    panel.querySelector('#v42CopyPerf')?.addEventListener('click',async()=>{const ok=await copyLog();const s=panel.querySelector('#v42CopyState');if(s)s.textContent=ok?'COPIED':'COPY FAILED';});
    panel.querySelector('#v42ClearPerf')?.addEventListener('click',()=>{clearLogs();const s=panel.querySelector('#v42CopyState');if(s)s.textContent='CLEARED';});
  }
  function beginFrame(now=performance.now()){
    frameStart=now;if(lastFrameStart){const interval=now-lastFrameStart;avg('INTERVAL',interval);totalFrames++;if(interval>(1000/Math.max(1,targetFps))*1.35)longFrames++;}lastFrameStart=now;shadowUpdated=false;pollGpu();
  }
  function endFrame({shadow=false,workMs=null}={}){
    shadowUpdated=shadow;const now=performance.now(),work=Number.isFinite(workMs)?workMs:now-frameStart;avg('WORK',work);sample(now);paint(now);
  }
  const api={measure,beginFrame,endFrame,gpuBegin,gpuEnd,record:(name,ms)=>avg(name,ms),snapshot,copyLog,clearLogs,diagnosticsPayload,get actualFps(){const v=ema.get('INTERVAL');return v?1000/v:0;},get frameIntervalMs(){return ema.get('INTERVAL')||0;},get workMs(){return ema.get('WORK')||0;},get gpuMs(){return ema.get('GPU')??null;},get history(){return history.slice();},get retention(){return LOG_POLICY;}};
  try{window.__RACING_PERF__=api;}catch{}
  return api;
}
