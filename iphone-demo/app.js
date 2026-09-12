import {TRACK} from './track.js';

const statusEl=document.getElementById('status'),speedEl=document.getElementById('speed'),camEl=document.getElementById('cam'),errorEl=document.getElementById('error');
window.addEventListener('error',e=>showError(e.message||'JavaScript error'));
window.addEventListener('unhandledrejection',e=>showError(e.reason?.message||String(e.reason||'Promise error')));
function showError(msg){statusEl.textContent='ERROR';errorEl.style.display='block';errorEl.textContent='起動エラー: '+msg;}
const timeout=(ms,msg)=>new Promise((_,reject)=>setTimeout(()=>reject(new Error(msg)),ms));
(async()=>{
 try{
  statusEl.textContent='LOADING 3D';
  const THREE=await Promise.race([
   import('https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js'),
   timeout(12000,'Three.jsの読み込みがタイムアウトしました')
  ]);
  statusEl.textContent='BUILDING TRACK';
  start(THREE);
 }catch(e){showError(e?.message||String(e));}
})();

function start(THREE){
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=(v,L)=>((v%L)+L)%L;
 const v3=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
 const BASE=TRACK;
 const cp=BASE.map(([x,z])=>v3(x,0,z));
 const baseCurve=new THREE.CatmullRomCurve3(cp,true,'centripetal',0.5);baseCurve.arcLengthDivisions=5000;
 const N=1200,flat=[];
 for(let i=0;i<N;i++)flat.push(baseCurve.getPointAt(i/N));
 let bi=0,bj=Math.floor(N*.55),best=1e9;
 for(let i=0;i<N;i+=2)for(let j=i+120;j<N;j+=2){
  if(i<120&&j>N-120)continue;
  const d=flat[i].distanceToSquared(flat[j]);
  if(d<best){best=d;bi=i;bj=j;}
 }
 const bridgeIndex=Math.max(bi,bj);
 const idist=(a,b)=>Math.min(Math.abs(a-b),N-Math.abs(a-b));
 const P=[];
 for(let i=0;i<N;i++){
  const u=i/N;
  const und=.75*Math.sin(u*Math.PI*2-0.4)+.45*Math.sin(u*Math.PI*4+0.8);
  const d=idist(i,bridgeIndex),bridge=8.2*Math.exp(-(d*d)/(2*28*28));
  const p=flat[i].clone();p.y=und+bridge;P.push(p);
 }
 const cum=[0];let total=0;for(let i=0;i<N;i++){total+=P[i].distanceTo(P[(i+1)%N]);cum.push(total);}
 const tan=[],side=[];for(let i=0;i<N;i++){const t=P[(i+2)%N].clone().sub(P[(i-2+N)%N]).normalize();tan.push(t);side.push(v3(-t.z,0,t.x).normalize());}
 function sample(s,lane=0){s=wrap(s,total);let lo=0,hi=N;while(lo+1<hi){const m=(lo+hi)>>1;if(cum[m]<=s)lo=m;else hi=m;}const j=(lo+1)%N,seg=Math.max(.001,cum[lo+1]-cum[lo]),f=(s-cum[lo])/seg;const p=P[lo].clone().lerp(P[j],f),t=tan[lo].clone().lerp(tan[j],f).normalize(),sv=v3(-t.z,0,t.x).normalize();p.addScaledVector(sv,lane);return{p,t,side:sv,i:lo};}
 function canvasTex(size,paint){const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');paint(g,size);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t;}
 const asphalt=canvasTex(256,(g,s)=>{g.fillStyle='#3b3d3e';g.fillRect(0,0,s,s);for(let i=0;i<8000;i++){const v=70+Math.random()*35;g.fillStyle=`rgb(${v},${v},${v})`;g.fillRect(Math.random()*s,Math.random()*s,1,1);}g.globalAlpha=.08;g.strokeStyle='#111';g.lineWidth=7;g.beginPath();g.moveTo(s*.35,0);g.lineTo(s*.42,s);g.stroke();g.beginPath();g.moveTo(s*.63,0);g.lineTo(s*.56,s);g.stroke();});asphalt.repeat.set(5,160);
 const grass=canvasTex(256,(g,s)=>{g.fillStyle='#5c8148';g.fillRect(0,0,s,s);for(let i=0;i<3000;i++){const l=26+Math.random()*20;g.fillStyle=`hsl(${90+Math.random()*18} 34% ${l}%)`;g.fillRect(Math.random()*s,Math.random()*s,2,2);}});grass.repeat.set(45,45);
 const gravel=canvasTex(256,(g,s)=>{g.fillStyle='#aaa79d';g.fillRect(0,0,s,s);for(let i=0;i<2600;i++){const v=135+Math.random()*65;g.fillStyle=`rgb(${v},${v-3},${v-8})`;g.fillRect(Math.random()*s,Math.random()*s,2,2);}});gravel.repeat.set(18,100);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x91bee0);scene.fog=new THREE.Fog(0xb7cbd7,950,3200);
 const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,6000);
 const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
 renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.45));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
 scene.add(new THREE.HemisphereLight(0xf5fbff,0x48663b,1.7));
 const sun=new THREE.DirectionalLight(0xfff8ea,2.8);sun.position.set(500,720,250);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-1050;sun.shadow.camera.right=1050;sun.shadow.camera.top=1050;sun.shadow.camera.bottom=-1050;sun.shadow.camera.near=100;sun.shadow.camera.far=2400;sun.shadow.bias=-0.00008;scene.add(sun);scene.add(sun.target);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(5000,5000),new THREE.MeshStandardMaterial({map:grass,color:0x77945f,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.22;ground.receiveShadow=false;scene.add(ground);
 function strip(halfWidth,y,mat,receive=true){const pos=[],uv=[],ind=[];for(let i=0;i<N;i++){const p=P[i],sv=side[i],l=p.clone().addScaledVector(sv,-halfWidth),r=p.clone().addScaledVector(sv,halfWidth);l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);uv.push(0,cum[i]/25,1,cum[i]/25);}for(let i=0;i<N;i++){const j=(i+1)%N,a=i*2,b=a+1,c=j*2,d=c+1;ind.push(a,b,c,b,d,c);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.receiveShadow=receive;scene.add(m);return m;}
 strip(31,-.13,new THREE.MeshStandardMaterial({map:grass,color:0x708f58,roughness:1,side:THREE.DoubleSide}),false);
 strip(16,-.06,new THREE.MeshStandardMaterial({map:gravel,color:0xb1ada4,roughness:.98,side:THREE.DoubleSide}),true);
 strip(9.1,-.01,new THREE.MeshStandardMaterial({color:0xb7b3aa,roughness:.96,side:THREE.DoubleSide}),true);
 strip(7.2,.035,new THREE.MeshStandardMaterial({map:asphalt,color:0x383a3b,roughness:.93,metalness:.02,side:THREE.DoubleSide}),true);
 const curbG=new THREE.BoxGeometry(1.2,.20,3.3),redM=new THREE.MeshStandardMaterial({color:0xd31f2a,roughness:.82}),whiteM=new THREE.MeshStandardMaterial({color:0xf4f4f4,roughness:.82}),tmp=new THREE.Object3D();
 const curbCount=Math.ceil(N/9)*2,curbR=new THREE.InstancedMesh(curbG,redM,curbCount),curbW=new THREE.InstancedMesh(curbG,whiteM,curbCount);let cr=0,cw=0;
 for(let i=0;i<N;i+=9)for(const sign of[-1,1]){const p=P[i].clone().addScaledVector(side[i],sign*7.65);p.y+=.16;tmp.position.copy(p);tmp.rotation.set(0,Math.atan2(tan[i].x,tan[i].z),0);tmp.updateMatrix();(((i/9)|0)%2?curbR:curbW).setMatrixAt(((i/9)|0)%2?cr++:cw++,tmp.matrix);}
 curbR.count=cr;curbW.count=cw;curbR.castShadow=curbW.castShadow=true;curbR.instanceMatrix.needsUpdate=curbW.instanceMatrix.needsUpdate=true;scene.add(curbR,curbW);
 const railG=new THREE.BoxGeometry(5,.48,.32),railM=new THREE.MeshStandardMaterial({color:0xbcc4c9,roughness:.5,metalness:.55}),rails=new THREE.InstancedMesh(railG,railM,Math.ceil(N/15)*2);let rc=0;
 for(let i=0;i<N;i+=15)for(const sign of[-1,1]){const p=P[i].clone().addScaledVector(side[i],sign*24);p.y+=1.0;tmp.position.copy(p);tmp.rotation.set(0,Math.atan2(tan[i].x,tan[i].z),0);tmp.updateMatrix();rails.setMatrixAt(rc++,tmp.matrix);}rails.count=rc;rails.castShadow=true;rails.instanceMatrix.needsUpdate=true;scene.add(rails);
 const start=sample(0),line=new THREE.Mesh(new THREE.BoxGeometry(14,.05,2.2),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8}));line.position.copy(start.p);line.position.y+=.11;line.rotation.y=Math.atan2(start.t.x,start.t.z);scene.add(line);
 const pitMat=new THREE.MeshStandardMaterial({color:0x7c858e,roughness:.75,metalness:.06});for(const frac of[.995,.005,.015,.025,.035]){const a=sample(total*frac);const b=new THREE.Mesh(new THREE.BoxGeometry(38,10,18),pitMat);b.position.copy(a.p).addScaledVector(a.side,43);b.position.y+=5;b.rotation.y=Math.atan2(a.t.x,a.t.z);b.castShadow=b.receiveShadow=true;scene.add(b);}
 const trunkM=new THREE.MeshStandardMaterial({color:0x55402e,roughness:1}),leafM=new THREE.MeshStandardMaterial({color:0x416a35,roughness:1});
 for(let k=0;k<60;k++){const a=sample(total*Math.random()),sgn=Math.random()<.5?-1:1,d=55+Math.random()*80,p=a.p.clone().addScaledVector(a.side,sgn*d);const tr=new THREE.Mesh(new THREE.CylinderGeometry(.55,.8,5.5,6),trunkM);tr.position.copy(p);tr.position.y+=2.5;tr.castShadow=true;scene.add(tr);const crown=new THREE.Mesh(new THREE.ConeGeometry(3.5+Math.random()*2.5,8+Math.random()*4,7),leafM);crown.position.copy(p);crown.position.y+=8.8;crown.castShadow=true;scene.add(crown);}
 const bridgeP=P[bridgeIndex];for(const sign of[-1,1]){const pil=new THREE.Mesh(new THREE.BoxGeometry(3,8,3),new THREE.MeshStandardMaterial({color:0x999b99,roughness:.9}));pil.position.copy(bridgeP).addScaledVector(side[bridgeIndex],sign*5.5);pil.position.y-=4;pil.castShadow=true;scene.add(pil);}
 function makeCar(color){const g=new THREE.Group(),bodyM=new THREE.MeshStandardMaterial({color,metalness:.45,roughness:.28}),dark=new THREE.MeshStandardMaterial({color:0x111315,metalness:.3,roughness:.35}),glass=new THREE.MeshStandardMaterial({color:0x162738,metalness:.12,roughness:.12});const body=new THREE.Mesh(new THREE.BoxGeometry(3.7,.75,7.6),bodyM);body.position.y=.73;body.castShadow=true;g.add(body);const nose=new THREE.Mesh(new THREE.BoxGeometry(1.2,.42,2.4),bodyM);nose.position.set(0,.55,-4.5);nose.castShadow=true;g.add(nose);const cab=new THREE.Mesh(new THREE.BoxGeometry(2.0,.65,2.6),glass);cab.position.set(0,1.25,-.3);cab.castShadow=true;g.add(cab);const fw=new THREE.Mesh(new THREE.BoxGeometry(4.1,.12,.75),dark);fw.position.set(0,.52,-5.1);g.add(fw);const rw=new THREE.Mesh(new THREE.BoxGeometry(4.2,.16,.9),dark);rw.position.set(0,1.05,3.85);g.add(rw);const wm=new THREE.MeshStandardMaterial({color:0x0c0c0c,roughness:.9});for(const x of[-1.8,1.8])for(const z of[-2.5,2.4]){const w=new THREE.Mesh(new THREE.BoxGeometry(.72,.72,1.0),wm);w.position.set(x,.4,z);w.castShadow=true;g.add(w);}return g;}
 const curv=new Float32Array(N);for(let i=0;i<N;i++){const a=tan[(i-6+N)%N],b=tan[(i+6)%N];curv[i]=clamp(Math.acos(clamp(a.dot(b),-1,1))/.45,0,1);}
 function braking(s){return Math.max(curv[sample(s+30).i]*.55,curv[sample(s+70).i]*.9,curv[sample(s+120).i]*1.1,curv[sample(s+175).i]*.8);}
 const colors=[0xf23b35,0x2f7fe8,0xffce32,0xf3f3f3,0x18c982,0x9d62ef,0xf57c22,0x1eb9c5,0xf24f9a,0xb7bdc6],cars=[],countCars=20,gridGap=10.5;
 for(let i=0;i<countCars;i++){const mesh=makeCar(colors[i%colors.length]);scene.add(mesh);const row=Math.floor(i/2),col=i%2,lane=(col?-1:1)*2.35+(row%2?.18:-.18),skill=.94+((i*7)%13)*.006;cars.push({mesh,s:wrap(-row*gridGap,total),lane,laneTarget:lane,v:0,max:78*skill,accel:6.6+skill*.7,brake:16,lap:0,overtake:0,reaction:.10+Math.random()*.55,launch:1+Math.random()*.09});}
 const gap=(a,b)=>wrap(b.s-a.s,total);
 function ahead(c,idx){let car=null,g=1e9;for(let j=0;j<cars.length;j++)if(j!==idx){const q=gap(c,cars[j]);if(q<g){g=q;car=cars[j];}}return{car,g};}
 function free(idx,lane){const me=cars[idx];for(let j=0;j<cars.length;j++)if(j!==idx){const o=cars[j],du=Math.min(gap(me,o),gap(o,me));if(du<22&&Math.abs(o.lane-lane)<2.6)return false;}return true;}
 function pose(c){const q=sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);}
 cars.forEach(pose);
 const race={t:0,green:4.0,phase:'grid'};
 function updateRace(dt){race.t+=dt;if(race.t<race.green){statusEl.textContent='LIGHTS '+Math.max(1,Math.ceil(race.green-race.t));return;}statusEl.textContent=race.t<race.green+.6?'GREEN':'RUNNING';for(let i=0;i<cars.length;i++){const c=cars[i],load=braking(c.s);let target=Math.max(23,c.max*(1-.70*load));if(race.t<race.green+c.reaction)target=0;else if(race.t<race.green+4.5)target=Math.max(target,c.max*.82*c.launch);const f=ahead(c,i);if(f.car){const same=Math.abs(f.car.lane-c.lane)<2.8;if(same&&f.g<95&&f.g>28)target*=1.045;if(same&&f.g<24){target=Math.min(target,f.car.v*.965);if(c.overtake<=0&&load<.40){const a=(i%2?-3:3),b=-a;if(free(i,a)){c.laneTarget=a;c.overtake=3;}else if(free(i,b)){c.laneTarget=b;c.overtake=3;}}}}if(c.overtake>0)c.overtake-=dt;else if(load>.42)c.laneTarget*=.88;else c.laneTarget*=.997;const dv=target-c.v,rate=dv>0?c.accel:c.brake;c.v+=clamp(dv,-rate*dt,rate*dt);c.lane=THREE.MathUtils.lerp(c.lane,c.laneTarget,1-Math.exp(-2.2*dt));const old=c.s;c.s=wrap(c.s+c.v*dt,total);if(c.s<old-total*.5)c.lap++;pose(c);}}
 let mode='AUTO',auto='TV',focus=0,autoT=0,tv=-1,lastCut=-999;const anchors=[.002,.055,.12,.20,.31,.43,.55,.68,.79,.90,.965],camP=v3(),look=v3();let ready=false;
 function leader(){let bi=0,bs=-1e9;for(let i=0;i<cars.length;i++){const s=cars[i].lap*total+cars[i].s;if(s>bs){bs=s;bi=i;}}return bi;}
 function nearestAnchor(fr){let k=0,d=9;for(let i=0;i<anchors.length;i++){const q=Math.min(Math.abs(fr-anchors[i]),1-Math.abs(fr-anchors[i]));if(q<d){d=q;k=i;}}return k;}
 function desired(active,now){const idx=race.t<race.green+9?leader():focus,c=cars[idx],q=sample(c.s,c.lane),ahead=sample(c.s+52,c.lane);if(race.t<race.green+6){const a=sample(-12),b=sample(85);return{p:a.p.clone().addScaledVector(a.side,48).add(v3(0,16,0)),target:b.p.clone().add(v3(0,2,0)),k:5,cut:false};}if(active==='CHASE')return{p:q.p.clone().addScaledVector(q.t,-28).addScaledVector(q.side,6).add(v3(0,8,0)),target:ahead.p.clone().add(v3(0,1.5,0)),k:3,cut:false};if(active==='HELI')return{p:q.p.clone().addScaledVector(q.t,-22).add(v3(0,76,0)),target:ahead.p.clone(),k:1.4,cut:false};const fr=c.s/total,k=nearestAnchor(fr);let cut=false;if(k!==tv&&now-lastCut>1500){tv=k;lastCut=now;cut=true;}if(tv<0){tv=k;lastCut=now;cut=true;}const a=sample(total*anchors[tv]);return{p:a.p.clone().addScaledVector(a.side,31).add(v3(0,12,0)),target:q.p.clone().add(v3(0,1.4,0)),k:5.5,cut};}
 function updateCam(active,dt,now){const d=desired(active,now);if(!ready||d.cut){camP.copy(d.p);look.copy(d.target);ready=true;}else{const f=1-Math.exp(-d.k*dt);camP.lerp(d.p,f);look.lerp(d.target,f);}camera.position.copy(camP);camera.lookAt(look);}
 function setMode(m){mode=m;ready=false;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));camEl.textContent=m==='AUTO'?`AUTO · ${auto}`:m;}
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));document.getElementById('next').addEventListener('click',()=>{focus=(focus+1)%cars.length;ready=false;});document.getElementById('prev').addEventListener('click',()=>{focus=(focus-1+cars.length)%cars.length;ready=false;});
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.45));},{passive:true});
 statusEl.textContent='GRID';const clock=new THREE.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());updateRace(dt);autoT+=dt;if(mode==='AUTO'&&race.t>race.green+7&&autoT>7){autoT=0;auto=auto==='TV'?'CHASE':auto==='CHASE'?'HELI':'TV';camEl.textContent=`AUTO · ${auto}`;ready=false;}const active=mode==='AUTO'?auto:mode;updateCam(active,dt,performance.now());renderer.render(scene,camera);const idx=race.t<race.green+9?leader():focus;speedEl.textContent=`CAR ${idx+1} · ${Math.round(cars[idx].v*3.6)} km/h`;}); 
}
