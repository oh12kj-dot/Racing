import {TRACK} from './track.js';
import {buildWorld} from './v6-world.js';
import {createRace} from './v6-race.js';
import {createDirector} from './v6-director.js';
import {createEnvironment} from './v6-environment.js';
import {createCamera} from './v6-camera.js';
import {createUI} from './v6-ui.js';
import {createSafetyCar} from './v6-safety-car.js';
const statusEl=document.getElementById('status'),speedEl=document.getElementById('speed'),camEl=document.getElementById('cam'),errorEl=document.getElementById('error');
function fail(e){console.error(e);statusEl.textContent='ERROR';errorEl.style.display='block';errorEl.textContent='起動エラー: '+(e?.message||e)}
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
const timeout=(ms,msg)=>new Promise((_,r)=>setTimeout(()=>r(new Error(msg)),ms));
(async()=>{try{
 statusEl.textContent='LOADING 3D';
 const THREE=await Promise.race([import('https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js'),timeout(12000,'Three.jsの読み込みがタイムアウトしました')]);
 statusEl.textContent='BUILDING TRACK';
 const W=buildWorld(THREE,TRACK),R=createRace(W,statusEl),D=createDirector(R),E=createEnvironment(W,R),C=createCamera(W,R,D,camEl),U=createUI(W,R,D,E,C),S=createSafetyCar(W,R);
 statusEl.textContent='GRID';
 addEventListener('resize',()=>{W.camera.aspect=innerWidth/innerHeight;W.camera.updateProjectionMatrix();W.renderer.setSize(innerWidth,innerHeight);W.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.45));},{passive:true});
 const clock=new THREE.Clock();W.renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());R.update(dt);D.update(dt);E.update(dt);S.update();const idx=C.update(dt,performance.now()),c=R.cars[idx]||R.getStandings()[0];U.update(dt,idx);W.renderer.render(W.scene,W.camera);if(c)speedEl.textContent=`CAR ${c.number} · ${c.name} · ${c.type.toUpperCase()} · ${Math.round(c.v*3.6)} km/h`;});
}catch(e){fail(e)}})();
