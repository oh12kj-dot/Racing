import {FIXED_DT} from './src/config.js';
import {createRaceSimulation} from './src/simulation/race.js';
import {createWorld} from './src/presentation/world.js';
import {createCameraDirector} from './src/presentation/camera.js';
import {createUI} from './src/presentation/ui.js';
import {createRaceAudio} from './src/presentation/audio.js';
import {createPerformanceMonitor} from './src/presentation/performance.js';

const viewport=document.querySelector('#viewport');
const boot=document.querySelector('#boot');
const watchButton=document.querySelector('#watchButton');
const bootStatus=document.querySelector('#bootStatus');
const query=new URLSearchParams(location.search);

let sim,world,director,ui,audio,perf;
let started=false,last=performance.now(),acc=0,raf=0,tickIndex=0;
const lifecycle={
  paused:false,reason:null,resumeCount:0,contextLosses:0,contextRestores:0,
  pause(reason='manual'){this.paused=true;this.reason=reason;},
  resume(){if(this.paused)this.resumeCount++;this.paused=false;this.reason=null;last=performance.now();acc=0;},
  pauseForTest(){this.pause('test');},
  resumeForTest(){this.resume();},
  contextLostForTest(){this.contextLosses++;this.pause('webgl-context-lost');},
  contextRestoredForTest(){this.contextRestores++;this.resume();},
  diagnostics(){return{owner:'runtime-lifecycle-v1',paused:this.paused,reason:this.reason,resumeCount:this.resumeCount,contextLosses:this.contextLosses,contextRestores:this.contextRestores};}
};

function environmentFromQuery(){
  const mode=(query.get('weather')||'').toLowerCase();
  if(mode==='wet')return{initialWetness:.72,rainRate:0,dryingRate:0,ambientTemp:18};
  if(mode==='rain')return{initialWetness:.10,rainRate:.68,dryingRate:.25,ambientTemp:17};
  if(mode==='changeable')return{
    initialWetness:.16,rainRate:.05,dryingRate:.45,ambientTemp:18,forecastHorizonSeconds:120,
    rainTimeline:[
      {time:45,rainRate:.72},
      {time:180,rainRate:.72},
      {time:300,rainRate:.08},
      {time:420,rainRate:0}
    ]
  };
  return null;
}
function stepSimulation(seconds){
  if(lifecycle.paused)return{...sim.snapshot(),paused:true,idx:tickIndex};
  const steps=Math.max(1,Math.round(seconds/FIXED_DT));
  for(let i=0;i<steps;i++){sim.update(FIXED_DT);tickIndex++;}
  return{...sim.snapshot(),paused:false,idx:tickIndex};
}
function init(){
  const environment=environmentFromQuery();
  sim=environment?createRaceSimulation(undefined,{environment}):createRaceSimulation();
  world=createWorld(viewport,sim.track,sim.cars);
  director=createCameraDirector(world,sim.track);
  world.camera=director.camera;
  audio=createRaceAudio();
  perf=createPerformanceMonitor(world.renderer,{qualityTier:'FULL'});
  ui=createUI(document.querySelector('#ui'),{
    onCamera:m=>director.setMode(m),
    onPrev:()=>director.cycleTracked(-1,sim.cars),
    onNext:()=>director.cycleTracked(1,sim.cars),
    onSelect:id=>{director.trackedId=id;director.setMode('FOLLOW');},
    onAudio:()=>{audio.start();audio.setMuted(!audio.muted);}
  });
  resize();
  const snap=sim.snapshot();
  world.update(snap);
  const cam=director.update(snap);
  ui.update(snap,cam);
  world.renderer.render(world.scene,director.camera);
  bootStatus.textContent=`READY · 24 CARS · ${snap.environment.condition} · DETERMINISTIC CORE`;

  world.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();lifecycle.contextLosses++;lifecycle.pause('webgl-context-lost');});
  world.renderer.domElement.addEventListener('webglcontextrestored',()=>{lifecycle.contextRestores++;lifecycle.resume();});

  window.__RACING__={sim,world,director,lifecycle,performance:perf};
  window.__RACING_RACE__=sim;
  window.__RACING_WORLD__=world;
  window.__RACING_LIFECYCLE__=lifecycle;
  window.__RACING_PERFORMANCE__=perf;
  window.__RACING_REGRESSION_MONITOR__={owner:'clean-rebuild-v1',diagnostics:()=>sim.snapshot().diagnostics};
  window.__RACING_THREE_SOURCE__={kind:'local-npm',version:'0.185.1'};
  window.__RACING_TEST_TICK__=(seconds=.05)=>{
    const workStart=performance.now(),idxBefore=tickIndex,simStart=performance.now();
    const s=stepSimulation(seconds),simEnd=performance.now();
    world.update(s);const c=director.update(s);ui.update(s,c);
    const renderStart=performance.now();world.renderer.render(world.scene,director.camera);const end=performance.now();
    perf.record({frameIntervalMs:0,mainThreadMs:end-workStart,simFrameMs:simEnd-simStart,renderFrameMs:end-renderStart,simSteps:tickIndex-idxBefore});
    return s;
  };
}
function frame(now){
  raf=requestAnimationFrame(frame);
  const workStart=performance.now(),frameIntervalMs=Math.max(0,now-last);
  const elapsed=Math.min(.12,frameIntervalMs/1000);last=now;
  let steps=0,simFrameMs=0;
  if(started&&!document.hidden&&!lifecycle.paused){
    acc=Math.min(.25,acc+elapsed);
    const simStart=performance.now();
    while(acc>=FIXED_DT&&steps<8){sim.update(FIXED_DT);tickIndex++;acc-=FIXED_DT;steps++;}
    simFrameMs=performance.now()-simStart;
  }
  const snap=sim.snapshot();
  world.update(snap);
  const cam=director.update(snap);
  audio.update(cam?.tracked);
  ui.update(snap,cam);
  const renderStart=performance.now();
  world.renderer.render(world.scene,director.camera);
  const end=performance.now();
  perf.record({frameIntervalMs,mainThreadMs:end-workStart,simFrameMs,renderFrameMs:end-renderStart,simSteps:steps});
}
function resize(){
  if(!world||!director)return;
  world.resize();director.resize(viewport.clientWidth,viewport.clientHeight);
}
watchButton.addEventListener('click',()=>{
  audio.start();
  started=true;sim.setRunning(true);
  lifecycle.resume();
  boot.classList.add('hidden');
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)lifecycle.pause('visibility');
  else if(started)lifecycle.resume();
});
window.addEventListener('resize',resize,{passive:true});
window.addEventListener('orientationchange',()=>setTimeout(resize,80),{passive:true});
window.addEventListener('pagehide',()=>cancelAnimationFrame(raf),{once:true});

try{
  init();
  if(query.has('runtimeTest')){
    started=true;boot.classList.add('hidden');
  }
  raf=requestAnimationFrame(frame);
}catch(err){
  console.error(err);
  bootStatus.textContent=`ERROR: ${err?.message||err}`;
}
