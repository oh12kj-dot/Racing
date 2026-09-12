import {TRACK} from './track.js';
import {buildWorld} from './v5-world.js';
import {createRace} from './v5-race.js';
import {createCamera} from './v5-camera.js';
const statusEl=document.getElementById('status'),speedEl=document.getElementById('speed'),camEl=document.getElementById('cam'),errorEl=document.getElementById('error');
function fail(e){console.error(e);statusEl.textContent='ERROR';errorEl.style.display='block';errorEl.textContent='起動エラー: '+(e?.message||e)}
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
const timeout=(ms,msg)=>new Promise((_,r)=>setTimeout(()=>r(new Error(msg)),ms));
(async()=>{try{statusEl.textContent='LOADING 3D';const THREE=await Promise.race([import('https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js'),timeout(12000,'Three.jsの読み込みがタイムアウトしました')]);statusEl.textContent='BUILDING TRACK';const W=buildWorld(THREE,TRACK),R=createRace(W,statusEl),C=createCamera(W,R,camEl);statusEl.textContent='GRID';addEventListener('resize',()=>{W.camera.aspect=innerWidth/innerHeight;W.camera.updateProjectionMatrix();W.renderer.setSize(innerWidth,innerHeight);W.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.45));},{passive:true});const clock=new THREE.Clock();W.renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());R.update(dt);const idx=C.update(dt,performance.now()),c=R.cars[idx];W.renderer.render(W.scene,W.camera);speedEl.textContent=`CAR ${idx+1} · ${c.type.toUpperCase()} · ${Math.round(c.v*3.6)} km/h`;});}catch(e){fail(e)}})();
