export function createCamera(W,R,D,camEl){
 const T=W.THREE,{sample,total,clamp}=W,anchors=[.002,.055,.12,.20,.31,.43,.55,.68,.79,.90,.965],camP=new T.Vector3(),look=new T.Vector3(),up=new T.Vector3(0,1,0),off=new T.Vector3(),right=new T.Vector3();
 let mode='AUTO',focus=0,tv=-1,lastCut=-999,ready=false,yaw=0,pitch=0,zoom=1,drag=false,lastX=0,lastY=0,lastTap=0,pinch=0;
 const photoTarget=new T.Vector3(),photoPos=new T.Vector3(),tmp=new T.Vector3();let photoInit=false;
 function nearest(fr){let k=0,d=9;for(let i=0;i<anchors.length;i++){const q=Math.min(Math.abs(fr-anchors[i]),1-Math.abs(fr-anchors[i]));if(q<d){d=q;k=i;}}return k;}
 function activeFocus(){return mode==='AUTO'?D.focus:focus;}
 function local(c,a){tmp.set(a[0],a[1],a[2]);return c.mesh.localToWorld(tmp.clone());}
 function onboard(c,which){
   const A=c.mesh.userData.cameraAnchors||{},cock=A.cockpit||[0,1.2,.4],nose=A.nose||[0,.7,3],bumper=A.bumper||[0,.45,3.5],rear=A.rear||[0,1,-3],wheel=A.wheel||[-1.2,.55,1.7];
   let p,t;
   if(which==='COCKPIT'){p=local(c,cock);t=local(c,[0,cock[1],11]);}
   else if(which==='NOSE'){p=local(c,nose);t=local(c,[0,nose[1]+.2,15]);}
   else if(which==='BUMPER'){p=local(c,bumper);t=local(c,[0,bumper[1]+.2,15]);}
   else if(which==='REAR'){p=local(c,rear);t=local(c,[0,rear[1],-15]);}
   else {p=local(c,wheel);t=local(c,[0,wheel[1]+.1,12]);}
   const q=sample(c.s,c.lane);return{p,target:t,roadY:q.p.y,k:13,cut:false,onboard:true};
 }
 function desired(active,now){
   const idx=activeFocus(),c=R.cars[idx]||R.cars[0],q=sample(c.s,c.lane),ahead=sample(c.s+52,c.lane);
   if(active==='PHOTO'){
     if(!photoInit){photoTarget.copy(c.mesh.position);photoTarget.y+=1.1;photoPos.copy(W.camera.position);if(photoPos.distanceTo(photoTarget)<5)photoPos.copy(photoTarget).add(new T.Vector3(0,8,-25));photoInit=true;}
     return{p:photoPos.clone(),target:photoTarget.clone(),roadY:Math.min(photoTarget.y-1,0),k:8,cut:false,photo:true};
   }
   if(['COCKPIT','NOSE','REAR','WHEEL','BUMPER'].includes(active))return onboard(c,active);
   if(R.sessionPhase==='FORMATION'){return{p:q.p.clone().addScaledVector(q.t,-24).addScaledVector(q.side,5).add(new T.Vector3(0,7,0)),target:ahead.p.clone().add(new T.Vector3(0,1.4,0)),roadY:q.p.y,k:4,cut:false};}
   if(R.race.t<R.race.green+6&&R.sessionPhase!=='QUALIFYING'){const a=sample(-12),b=sample(85);return{p:a.p.clone().addScaledVector(a.side,48).add(new T.Vector3(0,16,0)),target:b.p.clone().add(new T.Vector3(0,2,0)),roadY:a.p.y,k:5,cut:false};}
   if(active==='CHASE')return{p:q.p.clone().addScaledVector(q.t,-28).addScaledVector(q.side,6).add(new T.Vector3(0,8,0)),target:ahead.p.clone().add(new T.Vector3(0,1.5,0)),roadY:q.p.y,k:3,cut:false};
   if(active==='HELI')return{p:q.p.clone().addScaledVector(q.t,-22).add(new T.Vector3(0,76,0)),target:ahead.p.clone(),roadY:q.p.y,k:1.4,cut:false};
   const fr=c.s/total,k=nearest(fr);let cut=false;if(k!==tv&&now-lastCut>1500){tv=k;lastCut=now;cut=true;}if(tv<0){tv=k;lastCut=now;cut=true;}const a=sample(total*anchors[tv]);return{p:a.p.clone().addScaledVector(a.side,31).add(new T.Vector3(0,12,0)),target:q.p.clone().add(new T.Vector3(0,1.4,0)),roadY:Math.max(a.p.y,q.p.y),k:5.5,cut};
 }
 function update(dt,now){
   const active=mode==='AUTO'?D.shot:mode,d=desired(active,now);
   if(!ready||d.cut){camP.copy(d.p);look.copy(d.target);ready=true;}else{const f=1-Math.exp(-d.k*dt);camP.lerp(d.p,f);look.lerp(d.target,f);}
   if(d.photo){photoPos.copy(camP);photoTarget.copy(look);}
   off.copy(camP).sub(look).multiplyScalar(zoom);off.applyAxisAngle(up,yaw);right.crossVectors(up,off).normalize();if(right.lengthSq()>.001)off.applyAxisAngle(right,pitch);W.camera.position.copy(look).add(off);
   const floor=d.roadY+(W.cameraMinClearance??.9);if(!d.onboard&&W.camera.position.y<floor)W.camera.position.y=floor;W.camera.lookAt(look);
   const leader=R.getStandings()[0];if(leader){W.sun.target.position.copy(leader.mesh.position);W.sun.position.copy(leader.mesh.position).add(new T.Vector3(260,420,180));}
   camEl.textContent=(mode==='AUTO'?`AUTO · ${active}`:mode)+' · 360°';return activeFocus();
 }
 function setMode(m){mode=m;ready=false;photoInit=m==='PHOTO'?false:photoInit;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));}
 function setFocus(n){focus=(Number(n)+R.cars.length)%R.cars.length;D.userFocus(focus);ready=false;}
 function move(x,y){if(!drag)return;const dx=x-lastX,dy=y-lastY;lastX=x;lastY=y;yaw-=dx*.0065;pitch=clamp(pitch-dy*.0048,-1.20,1.20);}
 function panPhoto(dx,dy,dz){if(mode!=='PHOTO')setMode('PHOTO');photoTarget.x+=dx;photoTarget.y+=dy;photoTarget.z+=dz;photoPos.x+=dx;photoPos.y+=dy;photoPos.z+=dz;ready=false;}
 const el=W.renderer.domElement;el.style.touchAction='none';
 el.addEventListener('touchstart',e=>{e.preventDefault();if(e.touches.length===2){drag=false;pinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);return;}if(e.touches.length!==1)return;const t=e.touches[0],n=performance.now();if(n-lastTap<320){yaw=0;pitch=0;zoom=1;}lastTap=n;drag=true;lastX=t.clientX;lastY=t.clientY;},{passive:false});
 el.addEventListener('touchmove',e=>{e.preventDefault();if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(pinch>0)zoom=clamp(zoom*pinch/d,.28,4.0);pinch=d;return;}if(e.touches.length===1)move(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
 el.addEventListener('touchend',e=>{if(e.touches.length<2)pinch=0;if(e.touches.length===0)drag=false;},{passive:true});
 el.addEventListener('wheel',e=>{e.preventDefault();zoom=clamp(zoom*Math.exp(e.deltaY*.001),.28,4.0);},{passive:false});
 el.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;drag=true;lastX=e.clientX;lastY=e.clientY;el.setPointerCapture?.(e.pointerId);});el.addEventListener('pointermove',e=>{if(e.pointerType!=='touch')move(e.clientX,e.clientY);});el.addEventListener('pointerup',()=>drag=false);
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));document.getElementById('next')?.addEventListener('click',()=>setFocus(focus+1));document.getElementById('prev')?.addEventListener('click',()=>setFocus(focus-1));
 return{update,setMode,setFocus,panPhoto,zoomIn:()=>zoom=clamp(zoom*.78,.28,4),zoomOut:()=>zoom=clamp(zoom*1.28,.28,4),reset:()=>{yaw=0;pitch=0;zoom=1;ready=false;},setFov:v=>{W.camera.fov=clamp(Number(v),25,90);W.camera.updateProjectionMatrix();},setExposure:v=>W.renderer.toneMappingExposure=clamp(Number(v),.45,1.8),get zoom(){return zoom},get yaw(){return yaw},get mode(){return mode},get focus(){return focus}};
}
