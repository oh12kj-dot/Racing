const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function percentile(values,p){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];
}

export function createPerformanceMonitor(renderer,{qualityTier='FULL'}={}){
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
    return{
      owner:'presentation-performance-v1',
      sampleCount,
      frameIntervalMs:avg(frameIntervals),
      frameP95Ms:percentile(frameIntervals,.95),
      mainThreadMs:avg(mainThread),
      simFrameMs:avg(simFrames),
      simTickMs:avg(simTicks),
      renderFrameMs:avg(renderFrames),
      drawCalls:Number(render.calls??0),
      triangles:Number(render.triangles??0),
      points:Number(render.points??0),
      lines:Number(render.lines??0),
      longFrameRate:sampleCount?clamp(longFrames/sampleCount,0,1):0,
      qualityTier,
      devicePixelRatio:typeof devicePixelRatio==='number'?devicePixelRatio:1,
      memoryMB:memory?.usedJSHeapSize?memory.usedJSHeapSize/1048576:null,
      gpuFrameMs:null,
      gpuTimerAvailable:false
    };
  }

  return{record,diagnostics,get last(){return lastSnapshot??diagnostics();}};
}
