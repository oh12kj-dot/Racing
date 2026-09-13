// Racing runtime: stable entry point. Versioned legacy modules are hidden behind ./runtime/index.js.
import {TRACK} from './track.js';
import {loadSettings,saveSettings,resolveCircuit,CIRCUITS,getCircuitTrack,buildWorld,createRace,createDirector,createEnvironment,createCamera,createAudio,createUI,createSafetyCar,createBroadcast,createProfiler,createPerformanceManager,enhanceVisuals} from './runtime/index.js';
const statusEl=document.getElementById('status'),speedEl=document.getElementById('speed'),camEl=document.getElementById('cam'),errorEl=document.getElementById('error');
function fail(e){console.error(e);statusEl.textContent='ERROR';errorEl.style.display='block';errorEl.textContent='起動エラー: '+(e?.message||e)}
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
const timeout=(ms,msg)=>new Promise((_,r)=>setTimeout(()=>r(new Error(msg)),ms));
(async()=>{try{
 statusEl.textContent='LOADING 3D';
 const THREE=await Promise.race([import('https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js'),timeout(16000,'Three.jsの読み込みがタイムアウトしました')]);
 const settings=loadSettings(),circuitId=resolveCircuit(settings),circuit=CIRCUITS[circuitId]||CIRCUITS.SUZUKA,track=getCircuitTrack(TRACK,circuitId);
 statusEl.textContent='BUILDING TRACK';
 const W=buildWorld(THREE,track,settings,circuit.name),mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760,PM=createPerformanceManager(W,settings,mobile),V=enhanceVisuals(W,settings,mobile);try{window.__RACING_PM__=PM;window.__RACING_AUDIT__=W.auditCircuit?.();window.__RACING_VISUALS__=V;}catch{}
 if(W.updateEffects){const f=W.updateEffects.bind(W);let a=0;W.updateEffects=(cars,dt=.016)=>{a+=dt;const step=PM.interval('effects');if(a<step)return;const s=a;a=0;f(cars,s);};}
 if(W.updateDynamicSurface){const f=W.updateDynamicSurface.bind(W);let a=0;W.updateDynamicSurface=(race,wet,dt=.016)=>{a+=dt;const step=PM.interval('surface');if(a<step)return;const s=a;a=0;f(race,wet,s);};}
 if(W.updateDebris){const f=W.updateDebris.bind(W);let a=0;W.updateDebris=(dt=.016)=>{a+=dt;const step=Math.min(.08,PM.interval('effects'));if(a<step)return;const s=a;a=0;f(s);};}
 const R=createRace(W,statusEl,settings),D=createDirector(R),E=createEnvironment(W,R,settings),C=createCamera(W,R,D,camEl),A=createAudio(R,settings);W.updateVisualWeather?.();try{window.__RACING_RACE__=R;window.__RACING_DIRECTOR__=D;window.__RACING_AUDIO__=A;}catch{}
 A.setEnabled?.(settings.sound!==false);
 const U=createUI(W,R,D,E,C,A,settings,saveSettings),S=createSafetyCar(W,R),B=createBroadcast(W,R,D),P=createProfiler(W,{mobile,targetFps:PM.config.fps,race:R,director:D,audio:A});
 statusEl.textContent='GRID';
 addEventListener('resize',()=>{W.camera.aspect=innerWidth/innerHeight;W.camera.updateProjectionMatrix();W.renderer.setSize(innerWidth,innerHeight);PM.resize();},{passive:true});
 const clock=new THREE.Clock();let envAcc=0,lodAcc=0,shadowAcc=0;
 function updateSessionHUD(){const st=R.getStandings(),leader=st[0],phase=R.sessionPhase;if(phase==='QUALIFYING'){const q=R.qualifying?.[0],pole=q?R.cars[q.carId]:null;statusEl.textContent=`QUALIFYING${pole?` · P1 ${pole.name}`:''}`;return;}if(phase==='FORMATION'){statusEl.textContent='FORMATION LAP';return;}const lap=Math.min(R.race.lapsTarget,Math.max(1,(leader?.lap??0)+1)),finished=!!R.postRace?.active||(leader?.lap??0)>=R.race.lapsTarget;if(finished){statusEl.textContent='FINISH · RACE COMPLETE';return;}statusEl.textContent=`RACE · LAP ${lap}/${R.race.lapsTarget} · ${R.flag||'GREEN'}`;}
 W.renderer.setAnimationLoop(()=>{
   const now=performance.now(),rawDt=clock.getDelta(),dt=PM.beginFrame(now,rawDt);if(dt==null)return;const workStart=performance.now();P.beginFrame(now);
   P.measure('RACE AI',()=>R.update(dt));P.measure('HUD',updateSessionHUD);P.measure('DIRECTOR',()=>D.update(dt));
   envAcc+=dt;const envStep=PM.interval('weather');if(envAcc>=envStep){const e=envAcc;envAcc=0;P.measure('WEATHER',()=>{E.update(e);W.updateVisualWeather?.();});}
   P.measure('SAFETY CAR',()=>S.update(dt));
   const idx=P.measure('CAMERA',()=>C.update(dt,now)),c=R.cars[idx]||R.getStandings()[0];
   lodAcc+=dt;const lodStep=PM.interval('lod');if(lodAcc>=lodStep){P.measure('LOD',()=>{W.updateVehicleLOD?.(R.cars);W.updateShadowVisibility?.(R.cars);});lodAcc=0;}
   let shadowDid=false;const shadowStep=PM.interval('shadow');if(Number.isFinite(shadowStep)){shadowAcc+=dt;if(shadowAcc>=shadowStep){W.renderer.shadowMap.needsUpdate=true;shadowAcc=0;shadowDid=true;}}
   P.measure('AUDIO',()=>{A.setFocus(idx);A.update(dt);});P.measure('UI',()=>U.update(dt,idx));
   const q=P.gpuBegin();P.measure('RENDER CPU',()=>W.renderer.render(W.scene,W.camera));P.gpuEnd(q);if(!mobile)P.measure('PIP',()=>B.render());
   if(c){const flags=[c.localYellow?'LOCAL YELLOW':'',c.hazardAvoiding?'AVOID':'',c.blueFlag?'BLUE':'',c.hydroplaning?'HYDRO':'',c._doubleStackWait>0?'DOUBLE STACK':'',c.crashState&&c.crashState!=='NONE'?c.crashState:'',c.drsActive?'DRS':'',c.energyMode&&c.energyMode!=='BALANCED'?c.energyMode:'',c.spinState&&c.spinState!=='NONE'?c.spinState:'',c.pitState&&c.pitState!=='NONE'?c.pitLaneStatus||c.pitState:''].filter(Boolean).join(' · ');speedEl.textContent=`${W.circuitName} · ${R.raceClass||'MIXED'} · ${String(c.type||'car').toUpperCase()} · CAR ${c.number} ${c.name} · P${c.position} · ${Math.round(c.v*3.6)} km/h${flags?' · '+flags:''}`;}
   const workMs=performance.now()-workStart;P.endFrame({shadow:shadowDid,workMs});PM.observe(workMs,performance.now(),{intervalMs:P.frameIntervalMs,gpuMs:P.gpuMs});
 });
}catch(e){fail(e)}})();
