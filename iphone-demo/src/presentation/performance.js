const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const DEFAULT_PERFORMANCE_BUDGET=Object.freeze({
  frameP95Ms:120,
  mainThreadMs:80,
  renderFrameMs:70,
  drawCalls:300,
  triangles:400000
});

function percentile(values,p){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];
}

export function createPerformanceMonitor(renderer,{qualityTier='FULL',budget=DEFAULT_PERFORMANCE_BUDGET}={}){
  const frameIntervals=[],mainThread=[],simFrames=[],renderFrames=[],simTicks=[];
  let sampleCount=0,longFrames=0,lastSnapshot=null;
  const push=(arr,value)=>{if(Number.isFinite(value)){arr.push(value);if(arr.length>240)arr.shift();}};

  function record({frameIntervalMs=0,mainThreadMs=0,simFrameMs=0,renderFrameMs=0,simSteps=0}={}){
    sampleCount++;
    push(frameIntervals,frameIntervalMs);
    push(mainThread,mainThreadMs);
    push(simFrames,simFrameMs);
    push(renderFrames,renderFrameMs);
    if(simSteps>0)push(simTicks,simFrameMs/simSteps);
    if(frameIntervalMs>25)longFrames++;
    lastSnapshot=diagnostics();
    return lastSnapshot;
  }

  function diagnostics(){
    const render=renderer?.info?.render??{};
    const memory=typeof performance!=='undefined'&&performance.memory?performance.memory:null;
    const avg=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
    const metrics={
      frameP95Ms:percentile(frameIntervals,.95),
      mainThreadMs:avg(mainThread),
      renderFrameMs:avg(renderFrames),
      drawCalls:Number(render.calls??0),
      triangles:Number(render.triangles??0)
    };
    const exceeded=Object.entries(budget).filter(([key,limit])=>Number.isFinite(limit)&&Number.isFinite(metrics[key])&&metrics[key]>limit).map(([key])=>key);
    return{
      owner:'presentation-performance-v2',
      sampleCount,
      frameIntervalMs:avg(frameIntervals),
      frameP95Ms:metrics.frameP95Ms,
      mainThreadMs:metrics.mainThreadMs,
      simFrameMs:avg(simFrames),
      simTickMs:avg(simTicks),
      renderFrameMs:metrics.renderFrameMs,
      drawCalls:metrics.drawCalls,
      triangles:metrics.triangles,
      points:Number(render.points??0),
      lines:Number(render.lines??0),
      longFrameRate:sampleCount?clamp(longFrames/sampleCount,0,1):0,
      qualityTier,
      budget:{...budget},
      budgetExceeded:exceeded,
      withinBudget:exceeded.length===0,
      devicePixelRatio:typeof devicePixelRatio==='number'?devicePixelRatio:1,
      memoryMB:memory?.usedJSHeapSize?memory.usedJSHeapSize/1048576:null,
      gpuFrameMs:null,
      gpuTimerAvailable:false
    };
  }

  return{record,diagnostics,get last(){return lastSnapshot??diagnostics();}};
}
