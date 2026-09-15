export function createPerformanceManager(W,settings={},mobile=false){
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const presets={
    AUTO:{fps:60,dpr:1.10,shadowHz:6,effectHz:30,surfaceHz:10,weatherHz:30,lodHz:8,auto:true},
    QUALITY:{fps:60,dpr:1.25,shadowHz:8,effectHz:60,surfaceHz:20,weatherHz:60,lodHz:16,auto:false},
    BALANCED:{fps:60,dpr:1.10,shadowHz:6,effectHz:30,surfaceHz:10,weatherHz:30,lodHz:8,auto:false},
    COOL:{fps:45,dpr:.90,shadowHz:3,effectHz:20,surfaceHz:8,weatherHz:20,lodHz:6,auto:false},
    BATTERY:{fps:30,dpr:.80,shadowHz:0,effectHz:15,surfaceHz:5,weatherHz:15,lodHz:4,auto:false}
  };
  const mode=String(settings.perfMode||'AUTO').toUpperCase(),base={...(presets[mode]||presets.AUTO)};
  const fpsSetting=String(settings.fpsCap??'AUTO').toUpperCase();if(fpsSetting!=='AUTO'&&Number(fpsSetting)>0)base.fps=clamp(Number(fpsSetting),24,120);
  const renderScale=clamp(Number(settings.renderScale??1),.65,1.25);base.dpr*=renderScale;
  if(settings.shadows===false||String(settings.shadows).toUpperCase()==='OFF')base.shadowHz=0;
  if(settings.autoQuality===false)base.auto=false;if(settings.autoQuality===true)base.auto=true;
  let level=0,lastRun=0,accumDt=0,workEMA=0,lastTune=0,current={...base};
  const renderer=W.renderer;
  function effective(){const q={...base};if(base.auto&&mobile){q.dpr*=level===0?1:level===1?.91:.80;q.shadowHz=level===0?q.shadowHz:level===1?Math.min(q.shadowHz,4):Math.min(q.shadowHz,2);q.effectHz=level===0?q.effectHz:level===1?Math.min(q.effectHz,24):Math.min(q.effectHz,16);q.weatherHz=Math.min(q.weatherHz,q.effectHz);q.lodHz=level===0?q.lodHz:Math.min(q.lodHz,5);}return q;}
  function apply(force=false){const q=effective();const maxDevice=mobile?1.35:1.75,target=Math.min(devicePixelRatio||1,maxDevice,q.dpr);if(force||Math.abs(renderer.getPixelRatio()-target)>.02)renderer.setPixelRatio(target);renderer.shadowMap.enabled=q.shadowHz>0;if(W.sun?.shadow){const size=q.shadowHz>=6?1024:q.shadowHz>=3?768:q.shadowHz>0?512:256;if(W.sun.shadow.mapSize.x!==size){W.sun.shadow.mapSize.set(size,size);W.sun.shadow.map?.dispose?.();W.sun.shadow.map=null;}renderer.shadowMap.autoUpdate=!mobile&&q.shadowHz>=8;renderer.shadowMap.needsUpdate=q.shadowHz>0;}current={...q,targetDpr:target};return current;}
  apply(true);
  function beginFrame(now,rawDt){
    accumDt+=Math.min(.05,rawDt);const interval=1000/current.fps;
    if(!lastRun){lastRun=now;const dt=Math.min(.05,Math.max(.001,accumDt));accumDt=0;return dt;}
    if(now-lastRun+0.35<interval)return null;
    if(now-lastRun>interval*2.5)lastRun=now;else lastRun+=interval;
    const dt=Math.min(.05,Math.max(.001,accumDt));accumDt=0;return dt;
  }
  function observe(workMs,now){workEMA=workEMA?workEMA+(workMs-workEMA)*.08:workMs;if(!base.auto||!mobile||now-lastTune<2500)return;lastTune=now;const budget=1000/current.fps;if(workEMA>budget*.88&&level<2){level++;apply();}else if(workEMA<budget*.52&&level>0){level--;apply();}}
  function resize(){apply(true);}
  return{
    beginFrame,observe,resize,apply,
    get config(){return current},get mode(){return mode},get level(){return level},get workMs(){return workEMA},
    interval(name){const q=current,hz=name==='effects'?q.effectHz:name==='surface'?q.surfaceHz:name==='weather'?q.weatherHz:name==='lod'?q.lodHz:name==='shadow'?q.shadowHz:q.fps;return hz>0?1/hz:Infinity;}
  };
}
