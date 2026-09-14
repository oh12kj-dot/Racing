export function createLifecycleController({W,A,resumeAudio=false,onResume=null}={}){
  let paused=false,reason='RUNNING',pauseCount=0,resumeCount=0,contextLosses=0,contextRestores=0,lastChange=performance.now();
  const canvas=W?.renderer?.domElement;
  function pause(nextReason='PAUSE'){
    if(paused){reason=nextReason||reason;return false;}
    paused=true;reason=nextReason;pauseCount++;lastChange=performance.now();return true;
  }
  function resume(nextReason='RESUME'){
    if(typeof document!=='undefined'&&document.hidden)return false;
    const changed=paused;paused=false;reason=nextReason;lastChange=performance.now();if(changed)resumeCount++;
    try{W?.renderer?.resetState?.();if(W?.renderer?.shadowMap)W.renderer.shadowMap.needsUpdate=true;}catch{}
    if(resumeAudio)try{A?.setEnabled?.(true);}catch{}
    try{onResume?.();}catch{}
    return changed;
  }
  const onVisibility=()=>document.hidden?pause('VISIBILITY_HIDDEN'):resume('VISIBILITY_VISIBLE');
  const onPageHide=()=>pause('PAGE_HIDE');
  const onPageShow=()=>resume('PAGE_SHOW');
  const onContextLost=e=>{e?.preventDefault?.();contextLosses++;pause('WEBGL_CONTEXT_LOST');};
  const onContextRestored=()=>{contextRestores++;resume('WEBGL_CONTEXT_RESTORED');};
  document.addEventListener('visibilitychange',onVisibility,{passive:true});
  addEventListener('pagehide',onPageHide,{passive:true});addEventListener('pageshow',onPageShow,{passive:true});
  canvas?.addEventListener?.('webglcontextlost',onContextLost,false);canvas?.addEventListener?.('webglcontextrestored',onContextRestored,false);
  function dispose(){document.removeEventListener('visibilitychange',onVisibility);removeEventListener('pagehide',onPageHide);removeEventListener('pageshow',onPageShow);canvas?.removeEventListener?.('webglcontextlost',onContextLost);canvas?.removeEventListener?.('webglcontextrestored',onContextRestored);}
  function diagnostics(){return{owner:'runtime-lifecycle-v1',paused,reason,pauseCount,resumeCount,contextLosses,contextRestores,lastChange};}
  return{pause,resume,dispose,diagnostics,pauseForTest:()=>pause('TEST_PAUSE'),resumeForTest:()=>resume('TEST_RESUME'),contextLostForTest:()=>onContextLost({preventDefault(){}}),contextRestoredForTest:onContextRestored,get paused(){return paused},get reason(){return reason}};
}
