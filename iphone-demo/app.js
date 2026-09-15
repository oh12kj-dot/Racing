// Racing runtime: stable entry point. Versioned legacy modules are hidden behind ./runtime/index.js.
import {TRACK} from './track.js';
import {loadSettings,saveSettings,resolveCircuit,CIRCUITS,getCircuitTrack,buildWorld,createRace,createDirector,createEnvironment,createCamera,createAudio,createUI,createSafetyCar,createBroadcast,createProfiler,createPerformanceManager,enhanceVisuals,enhanceSurfaceDetail,enhanceProceduralClassVisuals,createEnvironmentReflections,createSceneQualityController,createSelectiveGlow,createRenderAssetManager,cleanupLegacyWorld,attachRuntimeAudit,loadThree,createRuntimeRegression,createLifecycleController,createReplay,createVehicleMotion} from './runtime/index.js';
const statusEl=document.getElementById('status'),speedEl=document.getElementById('speed'),camEl=document.getElementById('cam'),errorEl=document.getElementById('error'),runtimeTest=new URLSearchParams(location.search).has('runtimeTest');
function fail(e){console.error(e);statusEl.textContent='ERROR';errorEl.style.display='block';errorEl.textContent='起動エラー: '+(e?.message||e)}
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
(async()=>{try{
 statusEl.textContent='LOADING 3D';
 const THREE=await loadThree({timeoutMs:16000});
 const settings=loadSettings();settings.runtimeCleanWorld=true;
 const circuitId=resolveCircuit(settings),circuit=CIRCUITS[circuitId]||CIRCUITS.SUZUKA,track=getCircuitTrack(TRACK,circuitId);
 statusEl.textContent='BUILDING TRACK';
 const W=buildWorld(THREE,track,settings,circuit.name),mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760;
 const cleanup=cleanupLegacyWorld(W),surface=enhanceSurfaceDetail(W,{mobile}),PM=createPerformanceManager(W,settings,mobile),V=enhanceVisuals(W,settings,mobile),CV=enhanceProceduralClassVisuals(W,THREE,{mobile});
 if(runtimeTest){W.renderer.setPixelRatio(.65);W.renderer.shadowMap.enabled=false;}
 try{window.__RACING_WORLD__=W;window.__RACING_PM__=PM;window.__RACING_VISUALS__=V;window.__RACING_CLASS_VISUALS__=CV;window.__RACING_WORLD_CLEANUP__=cleanup;window.__RACING_SURFACE__=surface;}catch{}
 if(W.updateEffects){const f=W.updateEffects.bind(W);let a=0;W.updateEffects=(cars,dt=.016)=>{a+=dt;const step=PM.interval('effects');if(a<step)return;const s=a;a=0;f(cars,s);};}
 if(W.updateDynamicSurface){const f=W.updateDynamicSurface.bind(W);let a=0;W.updateDynamicSurface=(race,wet,dt=.016)=>{a+=dt;const step=PM.interval('surface');if(a<step)return;const s=a;a=0;f(race,wet,s);};}
 if(W.updateDebris){const f=W.updateDebris.bind(W);let a=0;W.updateDebris=(dt=.016)=>{a+=dt;const step=Math.min(.08,PM.interval('effects'));if(a<step)return;const s=a;a=0;f(s);};}
 const R=createRace(W,statusEl,settings),AM=createRenderAssetManager(W,{mobile});
 // External GLBs improve presentation but are never allowed to gate simulation boot.
 // CI deliberately skips them so physics/state regressions are deterministic and fast.
 const assetLoad=runtimeTest
   ?Promise.resolve(W.renderAssets={state:'skipped-test',manifestVersion:0,requested:0,loaded:0,vehicleRequested:0,vehicleLoaded:0,tracksideRequested:0,tracksideLoaded:0,failed:0,mobile,sources:[],loaderSource:'skipped-test'})
   :AM.upgradeCars(R.cars).catch(e=>{console.warn('Optional render asset upgrade failed; keeping procedural fallback.',e);return W.renderAssets;});
 const D=createDirector(R),E=createEnvironment(W,R,settings),F=createEnvironmentReflections(W,{mobile}),C=createCamera(W,R,D,camEl),A=createAudio(R,settings),Q=createRuntimeRegression(W,R),QL=createSceneQualityController(W,{mobile}),G=createSelectiveGlow(W,R.cars,{mobile}),RP=createReplay(W,R,{enabled:!runtimeTest}),VM=createVehicleMotion(W,R,{mobile});W.updateVisualWeather?.();QL.apply(runtimeTest?3:PM.level,R.cars);G.update?.(runtimeTest?3:PM.level);attachRuntimeAudit(W,{race:R,performance:PM,regression:Q,quality:QL,reflections:F});
 try{window.__RACING_RACE__=R;window.__RACING_DIRECTOR__=D;window.__RACING_AUDIO__=A;window.__RACING_ASSETS__=AM;window.__RACING_ASSET_LOAD__=assetLoad;window.__RACING_REGRESSION_MONITOR__=Q;window.__RACING_REFLECTIONS__=F;window.__RACING_SCENE_QUALITY__=QL;window.__RACING_GLOW__=G;window.__RACING_REPLAY__=RP;window.__RACING_VEHICLE_MOTION__=VM;window.__RACING_AUDIT__=W.auditCircuit?.();}catch{}
 A.setEnabled?.(!runtimeTest&&settings.sound!==false);
 const U=createUI(W,R,D,E,C,A,settings,saveSettings),S=createSafetyCar(W,R),B=createBroadcast(W,R,D),P=createProfiler(W,{mobile,targetFps:PM.config.fps,race:R,director:D,audio:A});
 statusEl.textContent='GRID';
 addEventListener('resize',()=>{W.camera.aspect=innerWidth/innerHeight;W.camera.updateProjectionMatrix();W.renderer.setSize(innerWidth,innerHeight);PM.resize();},{passive:true});
 const clock=new THREE.Clock(),L=createLifecycleController({W,A,resumeAudio:!runtimeTest&&settings.sound!==false,onResume:()=>clock.getDelta()});try{window.__RACING_LIFECYCLE__=L;}catch{}let envAcc=0,lodAcc=0,shadowAcc=0;
 function updateSessionHUD(){const st=R.getStandings(),leader=st[0],phase=R.sessionPhase;if(phase==='QUALIFYING'){const q=R.qualifying?.[0],pole=q?R.cars[q.carId]:null;statusEl.textContent=`QUALIFYING${pole?` · P1 ${pole.name}`:''}`;return;}if(phase==='FORMATION'){statusEl.textContent='FORMATION LAP';return;}const lap=Math.min(R.race.lapsTarget,Math.max(1,(leader?.lap??0)+1)),finished=!!R.postRace?.active||(leader?.lap??0)>=R.race.lapsTarget;if(finished){statusEl.textContent='FINISH · RACE COMPLETE';return;}statusEl.textContent=`RACE · LAP ${lap}/${R.race.lapsTarget} · ${R.flag||'GREEN'}`;}
 function frame(dt,now=performance.now(),render=true){
   if(L.paused)return{idx:D.focus??0,shadowDid:false,paused:true};
   P.measure('RACE AI',()=>R.update(dt));P.measure('REGRESSION',()=>Q.update(dt));P.measure('HUD',updateSessionHUD);P.measure('REPLAY BUFFER',()=>RP.capture(dt));P.measure('DIRECTOR',()=>D.update(dt));
   envAcc+=dt;const envStep=PM.interval('weather');if(envAcc>=envStep){const e=envAcc;envAcc=0;P.measure('WEATHER',()=>{E.update(e);W.updateVisualWeather?.();if(!runtimeTest)F.paint?.();});}
   P.measure('SAFETY CAR',()=>S.update(dt));
   const replayApplied=P.measure('REPLAY APPLY',()=>RP.apply());
   const idx=P.measure('CAMERA',()=>C.update(dt,now)),c=R.cars[idx]||R.getStandings()[0];
   P.measure('VEHICLE MOTION',()=>VM.update(dt));
   lodAcc+=dt;const lodStep=PM.interval('lod');if(lodAcc>=lodStep){P.measure('LOD',()=>{W.updateVehicleLOD?.(R.cars);W.updateShadowVisibility?.(R.cars);QL.apply(runtimeTest?3:PM.level,R.cars);G.update?.(runtimeTest?3:PM.level);});lodAcc=0;}
   let shadowDid=false;const shadowStep=PM.interval('shadow');if(!runtimeTest&&Number.isFinite(shadowStep)){shadowAcc+=dt;if(shadowAcc>=shadowStep){W.updateHybridVehicleShadows?.(R.cars);W.renderer.shadowMap.needsUpdate=true;shadowAcc=0;shadowDid=true;}}
   if(!runtimeTest)P.measure('AUDIO',()=>{A.setFocus(idx);A.update(dt);});P.measure('UI',()=>U.update(dt,idx));
   if(render){const q=P.gpuBegin();P.measure('RENDER CPU',()=>W.renderer.render(W.scene,W.camera));P.gpuEnd(q);if(!mobile&&!runtimeTest)P.measure('PIP',()=>B.render(now));}
   if(c){const flags=[RP.active?'REPLAY':'',c.localYellow?'LOCAL YELLOW':'',c.hazardAvoiding?'AVOID':'',c.blueFlag?'BLUE':'',c.hydroplaning?'HYDRO':'',c._runtimePitQueued?'DOUBLE STACK':'',c.guardrailCorrection?'BARRIER SAFE':'',c.crashState&&c.crashState!=='NONE'?c.crashState:'',c.drsActive?'DRS':'',c.energyMode&&c.energyMode!=='BALANCED'?c.energyMode:'',c.spinState&&c.spinState!=='NONE'?c.spinState:'',c.pitState&&c.pitState!=='NONE'?c.pitLaneStatus||c.pitState:''].filter(Boolean).join(' · ');const displayKmh=typeof R.displaySpeedKmh==='function'?R.displaySpeedKmh(c):Math.max(0,(c.v||0)*3.6);speedEl.textContent=`${W.circuitName} · ${R.raceClass||'MIXED'} · ${String(c.type||'car').toUpperCase()} · CAR ${c.number} ${c.name} · P${c.position} · ${Math.round(displayKmh)} km/h${flags?' · '+flags:''}`;}
   if(replayApplied)P.measure('REPLAY RESTORE',()=>RP.restore());
   return{idx,shadowDid};
 }
 if(runtimeTest){
   try{window.__RACING_TEST_TICK__=(dt=.016,render=false)=>frame(Math.max(.001,Math.min(.05,Number(dt)||.016)),performance.now(),render);}catch{}
   P.beginFrame(performance.now());const x=frame(.016,performance.now(),true);P.endFrame({shadow:x.shadowDid,workMs:0});
   return;
 }
 W.renderer.setAnimationLoop(()=>{
   if(L.paused){clock.getDelta();return;}
   const now=performance.now(),rawDt=clock.getDelta(),dt=PM.beginFrame(now,rawDt);if(dt==null)return;const workStart=performance.now();P.beginFrame(now);const x=frame(dt,now,true);const workMs=performance.now()-workStart;P.endFrame({shadow:x.shadowDid,workMs});PM.observe(workMs,performance.now(),{intervalMs:P.frameIntervalMs,gpuMs:P.gpuMs});
 });
}catch(e){fail(e)}})();