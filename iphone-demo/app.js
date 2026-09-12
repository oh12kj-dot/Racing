import {TRACK} from './track.js';
import {loadSettings,saveSettings,resolveCircuit} from './v10-settings.js';
import {CIRCUITS,getCircuitTrack} from './v10-circuits.js';
import {buildWorld} from './v21-world.js';
import {createRace} from './v20-race.js';
import {createDirector} from './v19-director.js';
import {createEnvironment} from './v21-environment.js';
import {createCamera} from './v13-camera.js';
import {createAudio} from './v20-audio.js';
import {createUI} from './v19-ui.js';
import {createSafetyCar} from './v14-safety-car.js';
import {createBroadcast} from './v18-broadcast.js';
import {createProfiler} from './v21-profiler.js';
const statusEl=document.getElementById('status'),speedEl=document.getElementById('speed'),camEl=document.getElementById('cam'),errorEl=document.getElementById('error');
function fail(e){console.error(e);statusEl.textContent='ERROR';errorEl.style.display='block';errorEl.textContent='起動エラー: '+(e?.message||e)}
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
const timeout=(ms,msg)=>new Promise((_,r)=>setTimeout(()=>r(new Error(msg)),ms));
(async()=>{try{
 statusEl.textContent='LOADING 3D';
 const THREE=await Promise.race([import('https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js'),timeout(16000,'Three.jsの読み込みがタイムアウトしました')]);
 const settings=loadSettings(),circuitId=resolveCircuit(settings),circuit=CIRCUITS[circuitId]||CIRCUITS.SUZUKA,track=getCircuitTrack(TRACK,circuitId);
 statusEl.textContent='BUILDING TRACK';
 const W=buildWorld(THREE,track,settings,circuit.name);
 const mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760,targetDpr=mobile?Math.min(devicePixelRatio||1,1.10):Math.min(devicePixelRatio||1,1.45);
 W.renderer.setPixelRatio(targetDpr);
 if(mobile&&W.sun?.shadow){W.sun.shadow.mapSize.set(1024,1024);W.renderer.shadowMap.autoUpdate=false;W.renderer.shadowMap.needsUpdate=true;}
 if(mobile&&W.updateEffects){const f=W.updateEffects.bind(W);let a=0;W.updateEffects=(cars,dt=.016)=>{a+=dt;if(a<1/30)return;const s=a;a=0;f(cars,s);};}
 if(mobile&&W.updateDynamicSurface){const f=W.updateDynamicSurface.bind(W);let a=0;W.updateDynamicSurface=(race,wet,dt=.016)=>{a+=dt;if(a<.10)return;const s=a;a=0;f(race,wet,s);};}
 if(mobile&&W.updateDebris){const f=W.updateDebris.bind(W);let a=0;W.updateDebris=(dt=.016)=>{a+=dt;if(a<.05)return;const s=a;a=0;f(s);};}
 const R=createRace(W,statusEl,settings),D=createDirector(R),E=createEnvironment(W,R,settings),C=createCamera(W,R,D,camEl),A=createAudio(R),U=createUI(W,R,D,E,C,A,settings,saveSettings),S=createSafetyCar(W,R),B=createBroadcast(W,R,D),P=createProfiler(W,{mobile});
 statusEl.textContent='GRID';
 addEventListener('resize',()=>{W.camera.aspect=innerWidth/innerHeight;W.camera.updateProjectionMatrix();W.renderer.setSize(innerWidth,innerHeight);W.renderer.setPixelRatio(targetDpr);},{passive:true});
 const clock=new THREE.Clock();let envAcc=0,lodAcc=0,shadowAcc=0;
 function updateSessionHUD(){const st=R.getStandings(),leader=st[0],phase=R.sessionPhase;if(phase==='QUALIFYING'){const q=R.qualifying?.[0],pole=q?R.cars[q.carId]:null;statusEl.textContent=`QUALIFYING${pole?` · P1 ${pole.name}`:''}`;return;}const lap=Math.min(R.race.lapsTarget,Math.max(1,(leader?.lap??0)+1));const finished=!!R.postRace?.active||(leader?.lap??0)>=R.race.lapsTarget;if(finished){statusEl.textContent='FINISH · RACE COMPLETE';return;}statusEl.textContent=`RACE · LAP ${lap}/${R.race.lapsTarget} · ${R.flag||'GREEN'}`;}
 W.renderer.setAnimationLoop(()=>{
   P.beginFrame();const dt=Math.min(.05,clock.getDelta());
   P.measure('RACE AI',()=>R.update(dt));P.measure('HUD',updateSessionHUD);P.measure('DIRECTOR',()=>D.update(dt));
   envAcc+=dt;if(!mobile||envAcc>=1/30){const e=envAcc;envAcc=0;P.measure('WEATHER',()=>E.update(e));}
   P.measure('SAFETY CAR',()=>S.update());
   const idx=P.measure('CAMERA',()=>C.update(dt,performance.now())),c=R.cars[idx]||R.getStandings()[0];
   lodAcc+=dt;if(lodAcc>=(mobile?.14:.045)){P.measure('LOD',()=>W.updateVehicleLOD?.(R.cars));lodAcc=0;}
   let shadowDid=false;if(mobile){shadowAcc+=dt;if(shadowAcc>=.12){W.renderer.shadowMap.needsUpdate=true;shadowAcc=0;shadowDid=true;}}
   P.measure('AUDIO',()=>{A.setFocus(idx);A.update(dt);});P.measure('UI',()=>U.update(dt,idx));
   const q=P.gpuBegin();P.measure('RENDER CPU',()=>W.renderer.render(W.scene,W.camera));P.gpuEnd(q);
   if(!mobile)P.measure('PIP',()=>B.render());
   if(c){const flags=[c.blueFlag?'BLUE':'',c.hydroplaning?'HYDRO':'',c._doubleStackWait>0?'DOUBLE STACK':'',c.drsActive?'DRS':'',c.coolingMode?'COOL':'',c.spinState&&c.spinState!=='NONE'?c.spinState:''].filter(Boolean).join(' · ');speedEl.textContent=`${W.circuitName} · ${R.raceClass||'MIXED'} · ${String(c.type||'car').toUpperCase()} · CAR ${c.number} ${c.name} · ${c.driverStyle||''} · P${c.position} · ${Math.round(c.v*3.6)} km/h${flags?' · '+flags:''}`;}
   P.endFrame({shadow:shadowDid});
 });
}catch(e){fail(e)}})();
