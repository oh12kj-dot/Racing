import {buildWorld as buildV9World} from './v9-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV9World(THREE,TRACK);
  W.circuitName=circuitName;
  W.settings=settings;

  const paintCache=new Map();
  const carbon=new THREE.MeshStandardMaterial({color:0x101214,metalness:.5,roughness:.28});
  const tireM=new THREE.MeshStandardMaterial({color:0x050505,roughness:.97});
  const rimM=new THREE.MeshStandardMaterial({color:0x8d969c,metalness:.9,roughness:.22});
  const glassM=new THREE.MeshPhysicalMaterial({color:0x142939,roughness:.06,metalness:0,clearcoat:1,clearcoatRoughness:.05,transparent:true,opacity:.86,envMapIntensity:1.25});
  const headM=new THREE.MeshStandardMaterial({color:0xffffee,emissive:0xfff0ba,emissiveIntensity:1.7});
  const tailM=new THREE.MeshStandardMaterial({color:0x390000,emissive:0xff1608,emissiveIntensity:1.0});
  const chromeM=new THREE.MeshStandardMaterial({color:0xaab3b9,metalness:.92,roughness:.18});

  function bodyMat(color){const key=color>>>0;if(!paintCache.has(key))paintCache.set(key,new THREE.MeshPhysicalMaterial({color:key,metalness:.18,roughness:.17,clearcoat:1,clearcoatRoughness:.09,envMapIntensity:1.35}));return paintCache.get(key);}
  function accentMat(color){const c=new THREE.Color(color).offsetHSL(.01,.05,-.09);return new THREE.MeshPhysicalMaterial({color:c,metalness:.22,roughness:.23,clearcoat:.82,clearcoatRoughness:.14,envMapIntensity:1.1});}
  function wedge(L,Wd,H,front=.74,rear=1){
    const zf=L*.5,zr=-L*.5,wf=Wd*.5*front,wr=Wd*.5*rear,h=H;
    const v=[-wr,0,zr,wr,0,zr,-wf,0,zf,wf,0,zf,-wr*.78,h,zr*.78,wr*.78,h,zr*.78,-wf*.72,h,zf*.72,wf*.72,h,zf*.72];
    const ix=[0,2,1,1,2,3,4,5,6,5,7,6,0,1,4,1,5,4,2,6,3,3,6,7,0,4,2,2,4,6,1,3,5,3,7,5];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();return g;
  }
  function roundedBox(w,h,l,r=.18){
    const shape=new THREE.Shape();const x=-w/2,y=-l/2;
    shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+l-r);shape.quadraticCurveTo(x+w,y+l,x+w-r,y+l);shape.lineTo(x+r,y+l);shape.quadraticCurveTo(x,y+l,x,y+l-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
    const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.05,bevelThickness:.05});g.rotateX(-Math.PI/2);g.translate(0,h*.5,0);return g;
  }
  function detailedCar(color,type){
    const root=new THREE.Group(),visual=new THREE.Group();root.add(visual);
    const paint=bodyMat(color),accent=accentMat(color),wheels=[],brakeMats=[];
    const add=(geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,cast=true)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=cast;m.receiveShadow=true;visual.add(m);return m;};
    const wing=(w,z,y)=>{add(new THREE.BoxGeometry(w,.09,.45),carbon,0,y,z);for(const x of[-w*.38,w*.38])add(new THREE.BoxGeometry(.08,.55,.08),carbon,x,y-.25,z);};
    const mirror=(x,z,y)=>{add(new THREE.SphereGeometry(.14,8,6),carbon,x,y,z);add(new THREE.BoxGeometry(.26,.05,.08),carbon,x*.84,y-.02,z);};
    const lampPair=(z,y,front=true,sep=.72)=>{for(const x of[-sep,sep])add(new THREE.BoxGeometry(.34,.16,.12),front?headM:tailM,x,y,z);};
    const wheel=(x,z,r=.49,width=.52)=>{const g=new THREE.Group(),t=new THREE.Mesh(new THREE.CylinderGeometry(r,r,width,20),tireM),ri=new THREE.Mesh(new THREE.CylinderGeometry(r*.58,r*.58,width*1.04,16),rimM),bm=new THREE.MeshStandardMaterial({color:0x4a4a46,metalness:.75,roughness:.42,emissive:0xff2500,emissiveIntensity:0}),bd=new THREE.Mesh(new THREE.CylinderGeometry(r*.39,r*.39,width*1.08,18),bm),hub=new THREE.Mesh(new THREE.CylinderGeometry(r*.13,r*.13,width*1.10,12),chromeM);for(const o of[t,ri,bd,hub])o.rotation.z=Math.PI/2;t.castShadow=true;g.add(t,ri,bd,hub);g.position.set(x,r*.88,z);visual.add(g);wheels.push(g);brakeMats.push(bm);return g;};
    const fender=(x,z,w=.48,l=1.4,y=.63)=>add(wedge(l,w,.34,.92,1),paint,x,y,z);
    let dims={length:7,width:3},anchors={cockpit:[0,1.25,.35],nose:[0,.68,3.25],bumper:[0,.46,3.65],rear:[0,1.05,-3],wheel:[-1.2,.55,1.7]};

    if(type==='formula'){
      add(wedge(4.5,1.48,.50,.52,.92),paint,0,.56,.15);add(wedge(2.55,.60,.24,.32,.76),paint,0,.49,3.18);add(new THREE.BoxGeometry(3.18,.08,.56),carbon,0,.36,4.43);wing(2.62,-2.18,1.12);
      for(const x of[-.99,.99]){add(wedge(1.9,.62,.44,.72,1),accent,x,.60,.05);add(new THREE.BoxGeometry(.15,.30,1.9),carbon,x*1.12,.40,.05);}add(wedge(1.28,.92,.60,.75,.98),glassM,0,.91,.58,-.11);add(new THREE.BoxGeometry(.34,.48,.44),accent,0,1.32,.08);add(new THREE.TorusGeometry(.32,.035,8,18),carbon,0,1.18,.72,Math.PI/2);mirror(-.62,.72,1.05);mirror(.62,.72,1.05);
      wheel(-1.40,2.38,.50,.52);wheel(1.40,2.38,.50,.52);wheel(-1.42,-1.78,.52,.54);wheel(1.42,-1.78,.52,.54);dims={length:6.95,width:2.96};anchors={cockpit:[0,1.18,.55],nose:[0,.66,3.45],bumper:[0,.42,4.10],rear:[0,1.05,-2.7],wheel:[-1.28,.58,2.18]};
    }else if(type==='gt'){
      add(wedge(5.55,2.52,.62,.86,1),paint,0,.55,0);add(wedge(1.62,2.15,.30,.82,1),accent,0,.82,2.10);add(wedge(2.48,1.92,.78,.84,.96),glassM,0,.91,.10,-.03);add(new THREE.BoxGeometry(2.75,.08,.50),carbon,0,.30,3.00);wing(2.42,-2.84,1.52);for(const x of[-1.27,1.27]){fender(x,1.84,.48,1.55,.65);fender(x,-1.84,.48,1.55,.65);}lampPair(2.86,.72,true,.72);lampPair(-2.84,.78,false,.74);mirror(-1.18,.68,1.28);mirror(1.18,.68,1.28);add(new THREE.BoxGeometry(1.75,.08,.6),carbon,0,.31,-3.0);wheel(-1.38,1.86,.48,.55);wheel(1.38,1.86,.48,.55);wheel(-1.38,-1.86,.48,.55);wheel(1.38,-1.86,.48,.55);dims={length:7.28,width:3.25};
    }else if(type==='proto'){
      add(wedge(5.4,2.22,.38,.50,.98),paint,0,.48,0);add(wedge(1.65,1.24,.24,.36,.82),paint,0,.47,3.04);for(const x of[-.84,.84])add(wedge(1.85,.60,.40,.60,.98),accent,x,.61,1.55);const c=add(new THREE.SphereGeometry(.86,18,10,0,Math.PI*2,0,Math.PI*.58),glassM,0,.94,.42);c.scale.set(.82,.72,1.35);add(new THREE.BoxGeometry(.12,.78,1.75),carbon,0,1.20,-.75);wing(2.16,-2.86,1.22);lampPair(2.80,.64,true,.77);lampPair(-2.73,.70,false,.77);add(new THREE.BoxGeometry(1.7,.09,.64),carbon,0,.26,-3.0);wheel(-1.19,1.96,.46,.50);wheel(1.19,1.96,.46,.50);wheel(-1.19,-1.86,.46,.50);wheel(1.19,-1.86,.46,.50);dims={length:7.08,width:3.0};anchors.cockpit=[0,1.30,.38];
    }else if(type==='hyper'){
      add(wedge(5.35,2.40,.50,.66,1),paint,0,.48,0);add(wedge(1.55,1.55,.28,.48,.82),accent,0,.62,2.30);const c=add(wedge(2.25,1.64,.68,.76,.93),glassM,0,.88,.10,-.05);for(const x of[-1.16,1.16]){add(wedge(1.55,.42,.30,.70,1),paint,x,.58,1.72);add(new THREE.BoxGeometry(.34,.28,1.55),carbon,x,.36,-1.75);}wing(2.10,-2.72,1.15);lampPair(2.78,.64,true,.70);lampPair(-2.72,.70,false,.72);add(new THREE.BoxGeometry(1.95,.07,.72),carbon,0,.25,-2.95);wheel(-1.28,1.88,.47,.52);wheel(1.28,1.88,.47,.52);wheel(-1.28,-1.82,.49,.54);wheel(1.28,-1.82,.49,.54);dims={length:7.0,width:3.12};
    }else if(type==='touring'){
      add(roundedBox(2.42,.66,5.15,.22),paint,0,.53,0);add(wedge(2.42,1.88,.75,.92,.96),glassM,0,.93,-.05);add(new THREE.BoxGeometry(2.48,.12,.64),accent,0,.84,2.05);wing(2.30,-2.64,1.52);for(const x of[-1.24,1.24])add(new THREE.BoxGeometry(.42,.36,3.7),paint,x,.64,0);lampPair(2.60,.72,true,.70);lampPair(-2.60,.76,false,.70);mirror(-1.20,.66,1.31);mirror(1.20,.66,1.31);wheel(-1.33,1.70,.46,.52);wheel(1.33,1.70,.46,.52);wheel(-1.33,-1.72,.46,.52);wheel(1.33,-1.72,.46,.52);dims={length:6.65,width:3.12};
    }else if(type==='supercar'){
      add(wedge(5.0,2.28,.52,.62,.98),paint,0,.48,0);add(wedge(2.15,1.68,.67,.78,.95),glassM,0,.87,-.02,-.05);for(const x of[-1.08,1.08])add(wedge(1.55,.40,.26,.64,1),accent,x,.54,1.65);add(new THREE.BoxGeometry(2.12,.06,.52),carbon,0,.25,2.72);add(new THREE.BoxGeometry(1.88,.08,.42),carbon,0,.92,-2.56);lampPair(2.58,.64,true,.68);lampPair(-2.53,.68,false,.69);mirror(-1.05,.62,1.20);mirror(1.05,.62,1.20);wheel(-1.20,1.63,.47,.51);wheel(1.20,1.63,.47,.51);wheel(-1.20,-1.65,.48,.53);wheel(1.20,-1.65,.48,.53);dims={length:6.45,width:2.95};
    }else{
      add(wedge(5.5,2.30,.42,.54,.98),paint,0,.49,0);add(wedge(1.70,1.28,.25,.40,.84),paint,0,.48,3.02);const c=add(wedge(2.0,1.45,.62,.76,.94),glassM,0,.88,.30,-.06);for(const x of[-.90,.90]){add(wedge(1.65,.48,.34,.60,.98),accent,x,.59,1.52);add(new THREE.BoxGeometry(.34,.26,1.65),carbon,x,.35,-1.70);}add(new THREE.BoxGeometry(.10,.88,1.9),carbon,0,1.20,-.55);wing(2.28,-2.92,1.25);lampPair(2.86,.63,true,.76);lampPair(-2.78,.70,false,.76);add(new THREE.BoxGeometry(1.92,.08,.72),carbon,0,.24,-3.02);wheel(-1.22,1.95,.46,.51);wheel(1.22,1.95,.46,.51);wheel(-1.22,-1.90,.47,.52);wheel(1.22,-1.90,.47,.52);dims={length:7.18,width:3.05};anchors.cockpit=[0,1.23,.35];
    }
    add(new THREE.BoxGeometry(dims.width*.78,.12,dims.length*.76),carbon,0,.20,-.05);
    add(wedge(.82,dims.width*.64,.18,1,.72),carbon,0,.24,-dims.length*.42);
    for(const x of[-.42,.42])add(new THREE.CylinderGeometry(.075,.09,.24,10),chromeM,x,.42,-dims.length*.44,Math.PI/2,0,0);
    root.userData={dims,type,visual,wheels,brakeMats,cameraAnchors:anchors};
    return root;
  }
  W.makeCar=detailedCar;

  function pitRibbon(){
    const seg=150,pos=[],uv=[],ind=[],start=.88,end=1.12,offset=13.2,hw=2.65;
    for(let i=0;i<seg;i++){
      const f=start+(end-start)*i/(seg-1),s=W.total*((f%1+1)%1),q=W.sample(s),c=q.p.clone().addScaledVector(q.side,offset),l=c.clone().addScaledVector(q.side,-hw),r=c.clone().addScaledVector(q.side,hw);l.y+=.055;r.y+=.055;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);uv.push(0,i/8,1,i/8);
    }
    for(let i=0;i<seg-1;i++){const a=i*2,b=a+1,c=(i+1)*2,d=c+1;ind.push(a,b,c,b,d,c);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x303438,roughness:.9,metalness:.02,side:THREE.DoubleSide}));m.receiveShadow=true;m.userData.pitLane=true;W.scene.add(m);
    const boxM=new THREE.MeshStandardMaterial({color:0xd8d8d3,roughness:.82});for(let i=0;i<10;i++){const q=W.sample(W.total*(.006+i*.0045),13.2),b=new THREE.Mesh(new THREE.BoxGeometry(2.4,.025,4.8),boxM);b.position.copy(q.p);b.position.y+=.095;b.rotation.y=Math.atan2(q.t.x,q.t.z);W.scene.add(b);}
  }
  pitRibbon();
  W.pitLaneOffset=13.2;
  return W;
}
