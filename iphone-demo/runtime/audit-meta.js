export function attachRuntimeAudit(W,{race=null,performance=null,regression=null,quality=null,reflections=null}={}){
  const prior=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=prior?prior():(W.circuitAudit||{});
    return{
      ...a,
      runtimeRendering:{
        visuals:W.visualEnhancements?{...W.visualEnhancements,root:undefined}:null,
        surfaceDetail:W.surfaceDetail?{applied:W.surfaceDetail.applied,resolution:W.surfaceDetail.resolution}:null,
        legacyCleanup:W.legacyWorldCleanup||null,
        quality:quality?.state||W.runtimeSceneQuality||null,
        reflectionKey:reflections?.key||W.runtimeReflections?.key||null,
        shadowProjection:W.sun?.shadow?.camera?{left:W.sun.shadow.camera.left,right:W.sun.shadow.camera.right,top:W.sun.shadow.camera.top,bottom:W.sun.shadow.camera.bottom,mapSize:[W.sun.shadow.mapSize.x,W.sun.shadow.mapSize.y]}:null,
        renderer:{dpr:W.renderer?.getPixelRatio?.()??null,toneMapping:W.renderer?.toneMapping??null}
      },
      runtimeSafety:{
        pit:race?.pitStateDiagnostics||null,
        barrier:race?.barrierSafetyDiagnostics||null,
        regression:regression?.diagnostics?.()||null
      },
      runtimePerformance:performance?{mode:performance.mode,level:performance.level,config:{...performance.config},workMs:performance.workMs,renderIntervalMs:performance.renderIntervalMs}:null
    };
  };
  W.circuitAudit=W.auditCircuit();return W.auditCircuit;
}
