import {FIXED_DT} from './src/config.js';
import {createRaceSimulation} from './src/simulation/race.js';
import {createWorld} from './src/presentation/world.js';
import {createCameraDirector} from './src/presentation/camera.js';
import {createUI} from './src/presentation/ui.js';
import {createRaceAudio} from './src/presentation/audio.js';

const viewport=document.querySelector('#viewport');
const boot=document.querySelector('#boot');
const watchButton=document.querySelector('#watchButton');
const bootStatus=document.querySelector('#bootStatus');

let sim,world,director,ui,audio;
let started=false,last=performance.now(),acc=0,raf=0;

function init(){
  sim=createRaceSimulation();
  world=createWorld(viewport,sim.track,sim.cars);
  director=createCameraDirector(world,sim.track);
  audio=createRaceAudio();
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
  bootStatus.textContent='READY · 24 CARS · DETERMINISTIC CORE';

  window.__RACING__={sim,world,director};
  window.__RACING_TEST_TICK__=(seconds=.05)=>{
    const steps=Math.max(1,Math.round(seconds/FIXED_DT));
    for(let i=0;i<steps;i++)sim.update(FIXED_DT);
    const s=sim.snapshot();world.update(s);const c=director.update(s);ui.update(s,c);world.renderer.render(world.scene,director.camera);return s;
  };
}
function frame(now){
  raf=requestAnimationFrame(frame);
  const elapsed=Math.min(.12,(now-last)/1000);last=now;
  if(started&&!document.hidden){
    acc=Math.min(.25,acc+elapsed);
    let steps=0;
    while(acc>=FIXED_DT&&steps<8){sim.update(FIXED_DT);acc-=FIXED_DT;steps++;}
  }
  const snap=sim.snapshot();
  world.update(snap);
  const cam=director.update(snap);
  audio.update(cam?.tracked);
  ui.update(snap,cam);
  world.renderer.render(world.scene,director.camera);
}
function resize(){
  if(!world||!director)return;
  world.resize();director.resize(viewport.clientWidth,viewport.clientHeight);
}
watchButton.addEventListener('click',()=>{
  audio.start();
  started=true;sim.setRunning(true);
  boot.classList.add('hidden');
});
document.addEventListener('visibilitychange',()=>{last=performance.now();acc=0;});
window.addEventListener('resize',resize,{passive:true});
window.addEventListener('orientationchange',()=>setTimeout(resize,80),{passive:true});
window.addEventListener('pagehide',()=>cancelAnimationFrame(raf),{once:true});

try{
  init();
  if(new URLSearchParams(location.search).has('runtimeTest')){
    started=true;boot.classList.add('hidden');
  }
  raf=requestAnimationFrame(frame);
}catch(err){
  console.error(err);
  bootStatus.textContent=`ERROR: ${err?.message||err}`;
}
