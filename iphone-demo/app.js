import {TRACK} from './track.js';
import {loadSettings,saveSettings,resolveCircuit} from './v10-settings.js';
import {CIRCUITS,getCircuitTrack} from './v10-circuits.js';
import {buildWorld} from './v13-world.js';
import {createRace} from './v13-race.js';
import {createDirector} from './v8-director-final.js';
import {createEnvironment} from './v10-environment.js';
import {createCamera} from './v13-camera.js';
import {createAudio} from './v10-audio.js';
import {createUI} from './v13-ui.js';
import {createSafetyCar} from './v6-safety-car.js';
const statusEl=document.getElementById('status'),speedEl=document.getElementById('speed'),camEl=document.getElementById('cam'),errorEl=document.getElementById('error');
function fail(e){console.error(e);statusEl.textContent='ERROR';errorEl.style.display='block';errorEl.textContent='起動エラー: '+(e?.message||e)}
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
const timeout=(ms,msg)=>new Promise((_,r)=>setTimeout(()=>r(new Error(msg)),ms));
(async()=>{try{
 statusEl.textContent='LOADING 3D';
 const THREE=await Promise.race([import('https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js'),timeout(16000,'Three.jsの読み込みがタイムアウトしました')]);
 const settings=loadSettings(),circuitId=resolveCircuit(settings),circuit=CIRCUITS[circuitId]||CIRCUITS.SUZUKA,track=getCircuitTrack(TRACK,circuitId);
 statusEl.textContent='BUILDING TRACK';
 const W=buildWorld(THREE,track,settings,circuit.name),R=createRace(W,statusEl,settings),D=createDirector(R),E=createEnvironment(W,R,settings),C=createCamera(W,R,D,camEl),A=createAudio(R),U=createUI(W,R,D,E,C,A,settings,saveSettings),S=createSafetyCar(W,R);
 statusEl.textContent='GRID';
 addEventListener('resize',()=>{W.camera.aspect=innerWidth/innerHeight;W.camera.updateProjectionMatrix();W.renderer.setSize(innerWidth,innerHeight);W.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.45));},{passive:true});
 const clock=new THREE.Clock();
 W.renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());R.update(dt);D.update(dt);E.update(dt);S.update();const idx=C.update(dt,performance.now()),c=R.cars[idx]||R.getStandings()[0];W.updateVehicleLOD?.(R.cars);A.setFocus(idx);A.update(dt);U.update(dt,idx);W.renderer.render(W.scene,W.camera);if(c)speedEl.textContent=`${W.circuitName} · CAR ${c.number} ${c.name} · ${c.type.toUpperCase()} · P${c.position} · ${Math.round(c.v*3.6)} km/h${c.drsActive?' · DRS':''}${c.pitState!=='NONE'?` · ${c.pitLaneStatus||c.pitService||'PIT'}`:''}${c.damageState&&c.damageState!=='OK'?` · DMG ${c.damageState}`:''}`;});
}catch(e){fail(e)}})();
