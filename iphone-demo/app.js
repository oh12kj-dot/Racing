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
 for(let i=0;i<N;i+=2)for(let j=i+120;j<N;j+=2){if(i<120&&j>N-120)continue;const d=flat[i].distanceToSquared(flat[j]);if(d<best){best=d;bi=i;bj=j;}}
 const bridgeIndex=Math.max(bi,bj),idist=(a,b)=>Math.min(Math.abs(a-b),N-Math.abs(a-b)),P=[];
 for(let i=0;i<N;i++){const u=i/N,und=.75*Math.sin(u*Math.PI*2-.4)+.45*Math.sin(u*Math.PI*4+.8),d=idist(i,bridgeIndex),bridge=8.2*Math.exp(-(d*d)/(2*28*28)),p=flat[i].clone();p.y=und+bridge;P.push(p);}
 const cum=[0];let total=0;for(let i=0;i<N;i++){total+=P[i].distanceTo(P[(i+1)%N]);cum.push(total);}
 const tan=[],side=[];for(let i=0;i<N;i++){const t=P[(i+2)%N].clone().sub(P[(i-2+N)%N]).normalize();tan.push(t);side.push(v3(-t.z,0,t.x).normalize());}
 function sample(s,lane=0){s=wrap(s,total);let lo=0,hi=N;while(lo+1<hi){const m=(lo+hi)>>1;if(cum[m]<=s)lo=m;else hi=m;}const j=(lo+1)%N,seg=Math.max(.001,cum[lo+1]-cum[lo]),f=(s-cum[lo])/seg,p=P[lo].clone().lerp(P[j],f),t=tan[lo].clone().lerp(tan[j],f).normalize(),sv=v3(-t.z,0,t.x).normalize();p.addScaledVector(sv,lane);return{p,t,side:sv,i:lo};}
 function canvasTex(size,paint){const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');paint(g,size);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t;}
 const asphalt=canvasTex(256,(g,s)=>{g.fillStyle='#3b3d3e';g.fillRect(0,0,s,s);for(let i=0;i<8000;i++){const v=70+Math.random()*35;g.fillStyle=`rgb(${v},${v},${v})`;g.fillRect(Math.random()*s,Math.random()*s,1,1);}g.globalAlpha=.08;g.strokeStyle='#111';g.lineWidth=7;g.beginPath();g.moveTo(s*.35,0);g.lineTo(s*.42,s);g.stroke();g.beginPath();g.moveTo(s*.63,0);g.lineTo(s*.56,s);g.stroke();});asphalt.repeat.set(5,160);
 const grass=canvasTex(256,(g,s)=>{g.fillStyle='#5c8148';g.fillRect(0,0,s,s);for(let i=0;i<3000;i++){const l=26+Math.random()*20;g.fillStyle=`hsl(${90+Math.random()*18} 34% ${l}%)`;g.fillRect(Math.random()*s,Math.random()*s,2,2);}});grass.repeat.set(45,45);
 const gravel=canvasTex(256,(g,s)=>{g.fillStyle='#aaa79d';g.fillRect(0,0,s,s);for(let i=0;i<2600;i++){const v=135+Math.random()*65;g.fillStyle=`rgb(${v},${v-3},${v-8})`;g.fillRect(Math.random()*s,Math.random()*s,2,2);}});gravel.repeat.set(18,100);
 const asphaltBump=canvasTex(256,(g,s)=>{g.fillStyle='#888';g.fillRect(0,0,s,s);for(let i=0;i<10000;i++){const v=90+Math.random()*75;g.fillStyle=`rgb(${v},${v},${v})`;g.fillRect(Math.random()*s,Math.random()*s,1,1);}});asphaltBump.repeat.set(5,160);asphaltBump.colorSpace=THREE.NoColorSpace;
 const skyCanvas=document.createElement('canvas');skyCanvas.width=1024;skyCanvas.height=512;const sg=skyCanvas.getContext('2d');const skyGrad=sg.createLinearGradient(0,0,0,512);skyGrad.addColorStop(0,'#4d86bd');skyGrad.addColorStop(.42,'#9fc7e5');skyGrad.addColorStop(.58,'#dfe8e8');skyGrad.addColorStop(.72,'#8da77c');skyGrad.addColorStop(1,'#3d5b32');sg.fillStyle=skyGrad;sg.fillRect(0,0,1024,512);sg.globalAlpha=.34;for(let i=0;i<16;i++){sg.fillStyle='#fff';sg.beginPath();const x=Math.random()*1024,y=130+Math.random()*90,w=90+Math.random()*180;sg.ellipse(x,y,w,18+Math.random()*22,0,0,Math.PI*2);sg.fill();}const envTex=new THREE.CanvasTexture(skyCanvas);envTex.mapping=THREE.EquirectangularReflectionMapping;envTex.colorSpace=THREE.SRGBColorSpace;
 const scene=new THREE.Scene();scene.background=envTex;scene.environment=envTex;scene.backgroundBlurriness=.08;scene.fog=new THREE.Fog(0xb7cbd7,1000,3400);
 const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,6000);
 const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
 renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.45));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
 scene.add(new THREE.HemisphereLight(0xf5fbff,0x48663b,1.7));
 const sun=new THREE.DirectionalLight(0xfff8ea,2.8);sun.position.set(500,720,250);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-1050;sun.shadow.camera.right=1050;sun.shadow.camera.top=1050;sun.shadow.camera.bottom=-1050;sun.shadow.camera.near=100;sun.shadow.camera.far=2400;sun.shadow.bias=-0.00008;scene.add(sun);scene.add(sun.target);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(5000,5000),new THREE.MeshStandardMaterial({map:grass,color:0x77945f,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.22;ground.receiveShadow=false;scene.add(ground);
 function strip(halfWidth,y,mat,receive=true){const pos=[],uv=[],ind=[];for(let i=0;i<N;i++){const p=P[i],sv=side[i],l=p.clone().addScaledVector(sv,-halfWidth),r=p.clone().addScaledVector(sv,halfWidth);l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);uv.push(0,cum[i]/25,1,cum[i]/25);}for(let i=0;i<N;i++){const j=(i+1)%N,a=i*2,b=a+1,c=j*2,d=c+1;ind.push(a,b,c,b,d,c);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.receiveShadow=receive;scene.add(m);return m;}
 strip(31,-.13,new THREE.MeshStandardMaterial({map:grass,color:0x708f58,roughness:1,side:THREE.DoubleSide}),false);
 strip(16,-.06,new THREE.MeshStandardMaterial({map:gravel,color:0xb1ada4,roughness:.98,side:THREE.DoubleSide}),true);
 strip(9.1,-.01,new THREE.MeshStandardMaterial({color:0xb7b3aa,roughness:.96,side:THREE.DoubleSide}),true);
 strip(7.2,.035,new THREE.MeshStandardMaterial({map:asphalt,bumpMap:asphaltBump,bumpScale:.08,color:0x414346,roughness:.88,metalness:.025,envMapIntensity:.35,side:THREE.DoubleSide}),true);
 function offsetStrip(offset,halfWidth,y,mat){const pos=[],uv=[],ind=[];for(let i=0;i<N;i++){const p=P[i],sv=side[i],c=p.clone().addScaledVector(sv,offset),l=c.clone().addScaledVector(sv,-halfWidth),r=c.clone().addScaledVector(sv,halfWidth);l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);uv.push(0,cum[i]/18,1,cum[i]/18);}for(let i=0;i<N;i++){const j=(i+1)%N,a=i*2,b=a+1,c=j*2,d=c+1;ind.push(a,b,c,b,d,c);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.receiveShadow=true;scene.add(m);return m;}
 const lineMat=new THREE.MeshStandardMaterial({color:0xf2f2ed,roughness:.72,metalness:0,side:THREE.DoubleSide});offsetStrip(-6.82,.09,.085,lineMat);offsetStrip(6.82,.09,.085,lineMat);
 const curbG=new THREE.BoxGeometry(1.2,.20,3.3),redM=new THREE.MeshStandardMaterial({color:0xd31f2a,roughness:.82}),whiteM=new THREE.MeshStandardMaterial({color:0xf4f4f4,roughness:.82}),tmp=new THREE.Object3D(),curbCount=Math.ceil(N/9)*2,curbR=new THREE.InstancedMesh(curbG,redM,curbCount),curbW=new THREE.InstancedMesh(curbG,whiteM,curbCount);let cr=0,cw=0;for(let i=0;i<N;i+=9)for(const sign of[-1,1]){const p=P[i].clone().addScaledVector(side[i],sign*7.65);p.y+=.16;tmp.position.copy(p);tmp.rotation.set(0,Math.atan2(tan[i].x,tan[i].z),0);tmp.updateMatrix();(((i/9)|0)%2?curbR:curbW).setMatrixAt(((i/9)|0)%2?cr++:cw++,tmp.matrix);}curbR.count=cr;curbW.count=cw;curbR.castShadow=curbW.castShadow=true;curbR.instanceMatrix.needsUpdate=curbW.instanceMatrix.needsUpdate=true;scene.add(curbR,curbW);
 const railG=new THREE.BoxGeometry(5,.48,.32),railM=new THREE.MeshStandardMaterial({color:0xbcc4c9,roughness:.5,metalness:.55}),rails=new THREE.InstancedMesh(railG,railM,Math.ceil(N/15)*2);let rc=0;for(let i=0;i<N;i+=15)for(const sign of[-1,1]){const p=P[i].clone().addScaledVector(side[i],sign*24);p.y+=1;tmp.position.copy(p);tmp.rotation.set(0,Math.atan2(tan[i].x,tan[i].z),0);tmp.updateMatrix();rails.setMatrixAt(rc++,tmp.matrix);}rails.count=rc;rails.castShadow=true;rails.instanceMatrix.needsUpdate=true;scene.add(rails);
 const start=sample(0),line=new THREE.Mesh(new THREE.BoxGeometry(14,.05,2.2),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8}));line.position.copy(start.p);line.position.y+=.11;line.rotation.y=Math.atan2(start.t.x,start.t.z);scene.add(line);
 const pitMat=new THREE.MeshStandardMaterial({color:0x7c858e,roughness:.75,metalness:.06});for(const frac of[.995,.005,.015,.025,.035]){const a=sample(total*frac);const b=new THREE.Mesh(new THREE.BoxGeometry(38,10,18),pitMat);b.position.copy(a.p).addScaledVector(a.side,43);b.position.y+=5;b.rotation.y=Math.atan2(a.t.x,a.t.z);b.castShadow=b.receiveShadow=true;scene.add(b);}
 const trunkM=new THREE.MeshStandardMaterial({color:0x55402e,roughness:1}),leafM=new THREE.MeshStandardMaterial({color:0x416a35,roughness:1});
 for(let k=0;k<60;k++){const a=sample(total*Math.random()),sgn=Math.random()<.5?-1:1,d=55+Math.random()*80,p=a.p.clone().addScaledVector(a.side,sgn*d);const tr=new THREE.Mesh(new THREE.CylinderGeometry(.55,.8,5.5,6),trunkM);tr.position.copy(p);tr.position.y+=2.5;tr.castShadow=true;scene.add(tr);const crown=new THREE.Mesh(new THREE.ConeGeometry(3.5+Math.random()*2.5,8+Math.random()*4,7),leafM);crown.position.copy(p);crown.position.y+=8.8;crown.castShadow=true;scene.add(crown);}
 const bridgeP=P[bridgeIndex];for(const sign of[-1,1]){const pil=new THREE.Mesh(new THREE.BoxGeometry(3,8,3),new THREE.MeshStandardMaterial({color:0x999b99,roughness:.9}));pil.position.copy(bridgeP).addScaledVector(side[bridgeIndex],sign*5.5);pil.position.y-=4;pil.castShadow=true;scene.add(pil);}
 function makeCar(color,type){
  const g=new THREE.Group();
  const paint=new THREE.MeshPhysicalMaterial({color,metalness:.18,roughness:.20,clearcoat:.92,clearcoatRoughness:.13,envMapIntensity:1.15});
  const accent=new THREE.MeshPhysicalMaterial({color:new THREE.Color(color).offsetHSL(0,0,-.10),metalness:.18,roughness:.24,clearcoat:.75,clearcoatRoughness:.17,envMapIntensity:1.0});
  const dark=new THREE.MeshStandardMaterial({color:0x101214,metalness:.45,roughness:.28,envMapIntensity:.7});
  const glass=new THREE.MeshPhysicalMaterial({color:0x162b3b,metalness:0,roughness:.07,clearcoat:.9,clearcoatRoughness:.07,envMapIntensity:1.15});
  const stripe=new THREE.MeshStandardMaterial({color:0xf4f4ef,roughness:.68});
  const head=new THREE.MeshStandardMaterial({color:0xffffee,emissive:0xfff3c2,emissiveIntensity:1.1});
  const tail=new THREE.MeshStandardMaterial({color:0x3a0000,emissive:0xff180a,emissiveIntensity:.85});
  const wheelMat=new THREE.MeshStandardMaterial({color:0x080808,roughness:.93});
  const wheel=(r=.46,w=.50)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,w,14),wheelMat);m.rotation.z=Math.PI/2;m.castShadow=true;return m;};
  const addWheels=(arr,r,w)=>{for(const [x,y,z] of arr){const wh=wheel(r,w);wh.position.set(x,y,z);g.add(wh);}};
  let dims;
  if(type==='formula'){
   const body=new THREE.Mesh(new THREE.BoxGeometry(1.45,.42,4.35),paint);body.position.set(0,.66,.15);body.castShadow=true;g.add(body);
   const nose=new THREE.Mesh(new THREE.BoxGeometry(.58,.24,2.35),paint);nose.position.set(0,.52,3.25);nose.castShadow=true;g.add(nose);
   const fw=new THREE.Mesh(new THREE.BoxGeometry(3.0,.08,.52),dark);fw.position.set(0,.39,4.45);g.add(fw);
   const rw=new THREE.Mesh(new THREE.BoxGeometry(2.55,.12,.58),dark);rw.position.set(0,1.05,-2.15);g.add(rw);
   for(const x of[-.96,.96]){const pod=new THREE.Mesh(new THREE.BoxGeometry(.58,.40,1.7),accent);pod.position.set(x,.64,.05);pod.castShadow=true;g.add(pod);}
   const cockpit=new THREE.Mesh(new THREE.BoxGeometry(.92,.52,1.1),glass);cockpit.position.set(0,1.02,.55);cockpit.castShadow=true;g.add(cockpit);
   const airbox=new THREE.Mesh(new THREE.BoxGeometry(.34,.42,.42),accent);airbox.position.set(0,1.34,.12);g.add(airbox);
   const centerStripe=new THREE.Mesh(new THREE.BoxGeometry(.18,.03,3.4),stripe);centerStripe.position.set(0,.91,.15);g.add(centerStripe);
   addWheels([[-1.34,.42,2.35],[1.34,.42,2.35],[-1.34,.42,-1.75],[1.34,.42,-1.75]],.48,.50);
   dims={length:6.9,width:2.9};
  }else if(type==='gt'){
   const lower=new THREE.Mesh(new THREE.BoxGeometry(2.45,.62,5.45),paint);lower.position.set(0,.64,0);lower.castShadow=true;g.add(lower);
   const hood=new THREE.Mesh(new THREE.BoxGeometry(2.05,.34,1.45),accent);hood.position.set(0,.88,2.05);g.add(hood);
   const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.92,.76,2.35),glass);cabin.position.set(0,1.20,.15);cabin.castShadow=true;g.add(cabin);
   const deck=new THREE.Mesh(new THREE.BoxGeometry(2.05,.30,1.22),accent);deck.position.set(0,.88,-2.16);g.add(deck);
   const splitter=new THREE.Mesh(new THREE.BoxGeometry(2.72,.08,.46),dark);splitter.position.set(0,.34,2.96);g.add(splitter);
   const spoiler=new THREE.Mesh(new THREE.BoxGeometry(2.36,.10,.40),dark);spoiler.position.set(0,1.47,-2.78);g.add(spoiler);
   for(const x of[-1.26,1.26]){const flare=new THREE.Mesh(new THREE.BoxGeometry(.45,.36,3.7),paint);flare.position.set(x,.70,0);g.add(flare);}
   for(const x of[-.69,.69]){const h=new THREE.Mesh(new THREE.BoxGeometry(.34,.17,.13),head);h.position.set(x,.78,2.80);g.add(h);const t=new THREE.Mesh(new THREE.BoxGeometry(.34,.17,.13),tail);t.position.set(x,.82,-2.80);g.add(t);}
   addWheels([[-1.36,.45,1.82],[1.36,.45,1.82],[-1.36,.45,-1.82],[1.36,.45,-1.82]],.47,.55);
   dims={length:7.2,width:3.25};
  }else{
   const floor=new THREE.Mesh(new THREE.BoxGeometry(2.10,.34,5.15),paint);floor.position.set(0,.55,0);floor.castShadow=true;g.add(floor);
   const nose=new THREE.Mesh(new THREE.BoxGeometry(1.18,.23,1.35),paint);nose.position.set(0,.50,3.05);g.add(nose);
   const frontArch=new THREE.Mesh(new THREE.BoxGeometry(2.28,.38,1.55),accent);frontArch.position.set(0,.70,1.72);g.add(frontArch);
   const canopy=new THREE.Mesh(new THREE.BoxGeometry(1.34,.60,1.85),glass);canopy.position.set(0,1.03,.38);canopy.castShadow=true;g.add(canopy);
   const rearArch=new THREE.Mesh(new THREE.BoxGeometry(2.15,.34,1.45),accent);rearArch.position.set(0,.70,-1.92);g.add(rearArch);
   const fin=new THREE.Mesh(new THREE.BoxGeometry(.11,.72,1.55),dark);fin.position.set(0,1.28,-.72);g.add(fin);
   const wing=new THREE.Mesh(new THREE.BoxGeometry(2.05,.10,.42),dark);wing.position.set(0,1.20,-2.84);g.add(wing);
   for(const x of[-.75,.75]){const h=new THREE.Mesh(new THREE.BoxGeometry(.30,.16,.12),head);h.position.set(x,.69,2.76);g.add(h);const t=new THREE.Mesh(new THREE.BoxGeometry(.30,.16,.12),tail);t.position.set(x,.75,-2.68);g.add(t);}
   addWheels([[-1.18,.43,1.95],[1.18,.43,1.95],[-1.18,.43,-1.84],[1.18,.43,-1.84]],.45,.50);
   dims={length:7.0,width:3.0};
  }
  g.userData.dims=dims;g.userData.type=type;return g;
 }
 const curv=new Float32Array(N);for(let i=0;i<N;i++){const a=tan[(i-6+N)%N],b=tan[(i+6)%N];curv[i]=clamp(Math.acos(clamp(a.dot(b),-1,1))/.45,0,1);}
 function braking(s){return Math.max(curv[sample(s+30).i]*.55,curv[sample(s+70).i]*.9,curv[sample(s+120).i]*1.1,curv[sample(s+175).i]*.8);}
 const colors=[0xf23b35,0x2f7fe8,0xffce32,0xf3f3f3,0x18c982,0x9d62ef,0xf57c22,0x1eb9c5,0xf24f9a,0xb7bdc6],types=['formula','gt','proto'],cars=[],countCars=20,gridGap=12.4,laneLimit=3.9;
 for(let i=0;i<countCars;i++){const type=types[i%3],mesh=makeCar(colors[i%colors.length],type),dims=mesh.userData.dims;scene.add(mesh);const row=Math.floor(i/2),col=i%2,lane=(col?-1:1)*2.55+(row%2?.14:-.14),skill=.94+((i*7)%13)*.006;cars.push({mesh,type,length:dims.length,width:dims.width,s:wrap(-row*gridGap,total),lane,laneTarget:lane,v:0,max:(type==='formula'?79:type==='gt'?73:76)*skill,accel:(type==='formula'?6.9:type==='gt'?6.1:6.5)+skill*.7,brake:16.5,lap:0,overtake:0,avoid:0,reaction:.10+Math.random()*.55,launch:1+Math.random()*.09});}
 const gap=(a,b)=>wrap(b.s-a.s,total);
 function ahead(c,idx){let car=null,g=1e9;for(let j=0;j<cars.length;j++)if(j!==idx){const q=gap(c,cars[j]);if(q<g){g=q;car=cars[j];}}return{car,g};}
 function laneClear(idx,target,aheadDist=42,behindDist=18){const me=cars[idx];for(let j=0;j<cars.length;j++)if(j!==idx){const o=cars[j],ga=gap(me,o),gb=gap(o,me),lat=Math.abs(o.lane-target),minLat=(me.width+o.width)*.42+.45;if((ga<aheadDist||gb<behindDist)&&lat<minLat)return false;}return true;}
 function laneScore(idx,target){const me=cars[idx];let score=0;for(let j=0;j<cars.length;j++)if(j!==idx){const o=cars[j],ga=gap(me,o),gb=gap(o,me),lat=Math.abs(o.lane-target);if(ga<55)score+=Math.min(20,ga)*.25+lat*1.8;if(gb<22)score+=Math.min(12,gb)*.18+lat*1.4;}return score-Math.abs(target)*.08;}
 function chooseAvoidLane(idx){const me=cars[idx],candidates=[-3.2,3.2].filter(x=>laneClear(idx,x));if(!candidates.length)return null;candidates.sort((a,b)=>laneScore(idx,b)-laneScore(idx,a));return candidates[0];}
 function pose(c){const q=sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);}
 function emergencySeparation(){for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){const a=cars[i],b=cars[j],ga=gap(a,b),gb=gap(b,a),forward=ga<gb?ga:-gb,ads=Math.abs(forward),lat=b.lane-a.lane,minLong=(a.length+b.length)*.48+.7,minLat=(a.width+b.width)*.31;if(ads<minLong&&Math.abs(lat)<minLat){const dir=(lat||((i+j)%2?1:-1))>0?1:-1,push=(minLat-Math.abs(lat)+.05)*.42;a.lane=clamp(a.lane-dir*push,-laneLimit,laneLimit);b.lane=clamp(b.lane+dir*push,-laneLimit,laneLimit);if(forward>0){a.v=Math.min(a.v,b.v*.97);a.s=wrap(a.s-(minLong-ads)*.32,total);}else{b.v=Math.min(b.v,a.v*.97);b.s=wrap(b.s-(minLong-ads)*.32,total);}}}}
 cars.forEach(pose);
 const race={t:0,green:4.0,phase:'grid'};
 function updateRace(dt){
  race.t+=dt;
  if(race.t<race.green){statusEl.textContent='LIGHTS '+Math.max(1,Math.ceil(race.green-race.t));cars.forEach(pose);return;}
  statusEl.textContent=race.t<race.green+.6?'GREEN':'RUNNING';
  for(let i=0;i<cars.length;i++){
   const c=cars[i],load=braking(c.s);let target=Math.max(21,c.max*(1-.70*load));
   if(race.t<race.green+c.reaction)target=0;else if(race.t<race.green+4.5)target=Math.max(target,c.max*.82*c.launch);
   const f=ahead(c,i);
   if(f.car){
    const latGap=Math.abs(f.car.lane-c.lane),laneOverlap=latGap<(c.width+f.car.width)*.43+.35,closing=Math.max(0,c.v-f.car.v),safeGap=(c.length+f.car.length)*.55+4.5;
    const ttc=closing>.5?(f.g-safeGap)/closing:99;
    if(laneOverlap&&f.g<115&&f.g>32)target*=1.035;
    if(laneOverlap&&(f.g<38||ttc<2.2)){
      const option=(c.avoid<=0&&load<.58)?chooseAvoidLane(i):null;
      if(option!==null){c.laneTarget=option;c.avoid=1.8;c.overtake=2.8;}
      const margin=clamp((f.g-safeGap)/18,0,1);
      target=Math.min(target,f.car.v+margin*7);
      if(ttc<1.25||f.g<safeGap+4)target=Math.min(target,f.car.v*.97);
    }
   }
   for(let j=0;j<cars.length;j++)if(j!==i){const o=cars[j],ga=gap(c,o),gb=gap(o,c),long=Math.min(ga,gb);if(long<10){const minLat=(c.width+o.width)*.5+.55,lat=c.lane-o.lane;if(Math.abs(lat)<minLat){const away=lat>=0?1:-1;c.laneTarget=clamp(c.laneTarget+away*(minLat-Math.abs(lat))*.34,-laneLimit,laneLimit);target=Math.min(target,c.max*.94);}}}
   if(c.avoid>0)c.avoid-=dt;
   if(c.overtake>0)c.overtake-=dt;else if(load>.46&&c.avoid<=0)c.laneTarget*=.90;else if(c.avoid<=0)c.laneTarget*=.997;
   c.laneTarget=clamp(c.laneTarget,-laneLimit,laneLimit);
   const dv=target-c.v,rate=dv>0?c.accel:c.brake;c.v+=clamp(dv,-rate*dt,rate*dt);
   c.lane=THREE.MathUtils.lerp(c.lane,c.laneTarget,1-Math.exp(-2.1*dt));
   const old=c.s;c.s=wrap(c.s+c.v*dt,total);if(c.s<old-total*.5)c.lap++;
  }
  emergencySeparation();cars.forEach(pose);
 }
 let mode='AUTO',auto='TV',focus=0,autoT=0,tv=-1,lastCut=-999;const anchors=[.002,.055,.12,.20,.31,.43,.55,.68,.79,.90,.965],camP=v3(),look=v3();let ready=false;let orbitYaw=0,orbitPitch=0;const worldUp=v3(0,1,0),orbitOffset=v3(),orbitRight=v3();
 function leader(){let bi=0,bs=-1e9;for(let i=0;i<cars.length;i++){const s=cars[i].lap*total+cars[i].s;if(s>bs){bs=s;bi=i;}}return bi;}
 function nearestAnchor(fr){let k=0,d=9;for(let i=0;i<anchors.length;i++){const q=Math.min(Math.abs(fr-anchors[i]),1-Math.abs(fr-anchors[i]));if(q<d){d=q;k=i;}}return k;}
 function desired(active,now){const idx=race.t<race.green+9?leader():focus,c=cars[idx],q=sample(c.s,c.lane),ahead=sample(c.s+52,c.lane);if(race.t<race.green+6){const a=sample(-12),b=sample(85);return{p:a.p.clone().addScaledVector(a.side,48).add(v3(0,16,0)),target:b.p.clone().add(v3(0,2,0)),k:5,cut:false};}if(active==='CHASE')return{p:q.p.clone().addScaledVector(q.t,-28).addScaledVector(q.side,6).add(v3(0,8,0)),target:ahead.p.clone().add(v3(0,1.5,0)),k:3,cut:false};if(active==='HELI')return{p:q.p.clone().addScaledVector(q.t,-22).add(v3(0,76,0)),target:ahead.p.clone(),k:1.4,cut:false};const fr=c.s/total,k=nearestAnchor(fr);let cut=false;if(k!==tv&&now-lastCut>1500){tv=k;lastCut=now;cut=true;}if(tv<0){tv=k;lastCut=now;cut=true;}const a=sample(total*anchors[tv]);return{p:a.p.clone().addScaledVector(a.side,31).add(v3(0,12,0)),target:q.p.clone().add(v3(0,1.4,0)),k:5.5,cut};}
 function updateCam(active,dt,now){const d=desired(active,now);if(!ready||d.cut){camP.copy(d.p);look.copy(d.target);ready=true;}else{const f=1-Math.exp(-d.k*dt);camP.lerp(d.p,f);look.lerp(d.target,f);}orbitOffset.copy(camP).sub(look);orbitOffset.applyAxisAngle(worldUp,orbitYaw);orbitRight.crossVectors(worldUp,orbitOffset).normalize();if(orbitRight.lengthSq()>.001)orbitOffset.applyAxisAngle(orbitRight,orbitPitch);camera.position.copy(look).add(orbitOffset);camera.lookAt(look);}
 function setMode(m){mode=m;ready=false;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));camEl.textContent=(m==='AUTO'?`AUTO · ${auto}`:m)+' · SWIPE';}
 let drag=false,lastX=0,lastY=0,lastTap=0;function moveView(x,y){if(!drag)return;const dx=x-lastX,dy=y-lastY;lastX=x;lastY=y;orbitYaw=clamp(orbitYaw-dx*.0065,-Math.PI,Math.PI);orbitPitch=clamp(orbitPitch-dy*.0048,-.52,.58);}renderer.domElement.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;e.preventDefault();const t=e.touches[0],now=performance.now();if(now-lastTap<320){orbitYaw=0;orbitPitch=0;}lastTap=now;drag=true;lastX=t.clientX;lastY=t.clientY;},{passive:false});renderer.domElement.addEventListener('touchmove',e=>{if(e.touches.length!==1)return;e.preventDefault();moveView(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});renderer.domElement.addEventListener('touchend',()=>{drag=false;},{passive:true});renderer.domElement.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;drag=true;lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture?.(e.pointerId);});renderer.domElement.addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;moveView(e.clientX,e.clientY);});renderer.domElement.addEventListener('pointerup',()=>{drag=false;});
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));document.getElementById('next').addEventListener('click',()=>{focus=(focus+1)%cars.length;ready=false;});document.getElementById('prev').addEventListener('click',()=>{focus=(focus-1+cars.length)%cars.length;ready=false;});
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.45));},{passive:true});
 camEl.textContent='AUTO · TV · SWIPE';statusEl.textContent='GRID';const clock=new THREE.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());updateRace(dt);autoT+=dt;if(mode==='AUTO'&&race.t>race.green+7&&autoT>7){autoT=0;auto=auto==='TV'?'CHASE':auto==='CHASE'?'HELI':'TV';camEl.textContent=`AUTO · ${auto} · SWIPE`;ready=false;}const active=mode==='AUTO'?auto:mode;updateCam(active,dt,performance.now());renderer.render(scene,camera);const idx=race.t<race.green+9?leader():focus;speedEl.textContent=`CAR ${idx+1} · ${cars[idx].type.toUpperCase()} · ${Math.round(cars[idx].v*3.6)} km/h`;}); 
}
