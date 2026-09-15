import {buildWorld as buildV10World} from './v10-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV10World(THREE,TRACK,settings,circuitName);
  const total=W.total;
  const TEAM_NAMES=['APEX','VORTEX','ORION','SAKURA','TITAN','NOVA','FALCON','HELIX','VECTOR','PULSE'];
  const TEAM_COLORS=[0xe3312d,0x287de1,0xf2c52f,0xf3f3f3,0x20bd7b,0x9362df,0xed7b27,0x22aab8,0xe04a90,0xaeb6c1];
  const ENTRY=.955,FULL=.982,EXIT_BEGIN=.060,EXIT_END=.082,LANE=13.6,BOX=18.1;
  const PIT_LIMIT=22.22;
  const mod1=x=>((x%1)+1)%1;
  const smooth=t=>t*t*(3-2*t);

  const remove=[];
  W.scene.traverse(o=>{
    if(o.userData?.pitLane)remove.push(o);
    if(o.isMesh&&o.geometry?.type==='BoxGeometry'){
      const p=o.geometry.parameters||{};
      if(Math.abs((p.width||0)-2.4)<.03&&Math.abs((p.height||0)-.025)<.01&&Math.abs((p.depth||0)-4.8)<.03)remove.push(o);
    }
  });
  remove.forEach(o=>o.parent?.remove(o));

  function phaseForS(s){return mod1(s/total-ENTRY);}
  const fullP=mod1(FULL-ENTRY),exitBeginP=mod1(EXIT_BEGIN-ENTRY),exitEndP=mod1(EXIT_END-ENTRY);
  function pitOffsetAtS(s){
    const p=phaseForS(s);
    if(p>exitEndP)return 0;
    if(p<fullP)return LANE*smooth(Math.max(0,Math.min(1,p/fullP)));
    if(p<=exitBeginP)return LANE;
    const t=(p-exitBeginP)/(exitEndP-exitBeginP);
    return LANE*(1-smooth(Math.max(0,Math.min(1,t))));
  }
  function inPitWindow(s){return phaseForS(s)<=exitEndP;}
  function inPitSpeedZone(s){const p=phaseForS(s);return p>=fullP*.72&&p<=exitBeginP+.008;}
  function pitBoxS(teamId){return total*mod1(.0035+Math.max(0,Math.min(9,teamId||0))*.0052);}
  function poseAt(s,offset){const q=W.sample(s,offset);return{p:q.p,t:q.t,side:q.side,rotationY:Math.atan2(q.t.x,q.t.z)};}
  function pitPose(s,teamId=0,state='ENTRY'){
    if(state==='STOP'){const bs=pitBoxS(teamId),q=poseAt(bs,BOX);return{...q,s:bs,offset:BOX};}
    const off=pitOffsetAtS(s),q=poseAt(s,off);return{...q,s,offset:off};
  }

  const pit=new THREE.Group();pit.name='PIT_COMPLEX_V11';pit.userData.pitComplex=true;W.scene.add(pit);
  const asphaltM=new THREE.MeshStandardMaterial({color:0x34383b,roughness:.91,metalness:.015,side:THREE.DoubleSide});
  const apronM=new THREE.MeshStandardMaterial({color:0x5d6163,roughness:.95,metalness:.01,side:THREE.DoubleSide});
  const whiteM=new THREE.MeshStandardMaterial({color:0xf0f0ea,roughness:.78,side:THREE.DoubleSide});
  const yellowM=new THREE.MeshStandardMaterial({color:0xf2c72c,roughness:.72,side:THREE.DoubleSide});
  const concreteM=new THREE.MeshStandardMaterial({color:0xb7b9b6,roughness:.88,metalness:.02});
  const darkM=new THREE.MeshStandardMaterial({color:0x1b2024,roughness:.72,metalness:.16});
  const roofM=new THREE.MeshStandardMaterial({color:0x555d62,roughness:.74,metalness:.20});
  const glass=new THREE.MeshPhysicalMaterial({color:0x22343f,roughness:.12,transparent:true,opacity:.58,metalness:.05,clearcoat:.6});
  const tireM=new THREE.MeshStandardMaterial({color:0x080808,roughness:.96});
  const metalM=new THREE.MeshStandardMaterial({color:0x899399,roughness:.35,metalness:.72});

  function ribbon(startF,endF,segments,centerOffsetFn,halfWidth,material,y=.055){
    const pos=[],uv=[],ind=[];
    for(let i=0;i<segments;i++){
      const uf=startF+(endF-startF)*i/(segments-1),f=mod1(uf),s=total*f,q=W.sample(s),off=centerOffsetFn(s,uf),c=q.p.clone().addScaledVector(q.side,off),l=c.clone().addScaledVector(q.side,-halfWidth),r=c.clone().addScaledVector(q.side,halfWidth);
      l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);uv.push(0,i/8,1,i/8);
    }
    for(let i=0;i<segments-1;i++){const a=i*2,b=a+1,c=(i+1)*2,d=c+1;ind.push(a,b,c,b,d,c);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ind);g.computeVertexNormals();
    const m=new THREE.Mesh(g,material);m.receiveShadow=true;pit.add(m);return m;
  }

  ribbon(ENTRY,1+EXIT_END,260,s=>pitOffsetAtS(s),3.15,asphaltM,.064);
  ribbon(.989,1.057,150,()=>17.25,5.05,apronM,.058);
  ribbon(.975,1.068,155,s=>pitOffsetAtS(s)-3.00,.085,whiteM,.105);
  ribbon(.988,1.060,150,()=>21.92,.095,whiteM,.107);
  ribbon(.990,1.058,150,()=>15.55,.075,yellowM,.109);

  function crossLine(f,colorMat,width=6.3,depth=.45,offset=LANE){
    const q=W.sample(total*mod1(f),offset),m=new THREE.Mesh(new THREE.BoxGeometry(width,.025,depth),colorMat);
    m.position.copy(q.p);m.position.y+=.115;m.rotation.y=Math.atan2(q.t.x,q.t.z);pit.add(m);return m;
  }
  crossLine(FULL,yellowM);crossLine(EXIT_BEGIN,yellowM);

  const wallGeo=new THREE.BoxGeometry(3.9,.78,.42),wallCount=58,wall=new THREE.InstancedMesh(wallGeo,concreteM,wallCount),tmp=new THREE.Object3D();
  for(let i=0;i<wallCount;i++){
    const uf=.982+(.073)*i/(wallCount-1),s=total*mod1(uf),q=W.sample(s,9.55);
    tmp.position.copy(q.p);tmp.position.y+=.47;tmp.rotation.set(0,Math.atan2(q.t.x,q.t.z),0);tmp.updateMatrix();wall.setMatrixAt(i,tmp.matrix);
  }
  wall.castShadow=true;wall.receiveShadow=true;wall.instanceMatrix.needsUpdate=true;pit.add(wall);

  const postGeo=new THREE.BoxGeometry(.10,1.45,.10),posts=new THREE.InstancedMesh(postGeo,metalM,38);
  for(let i=0;i<38;i++){
    const uf=.985+.067*i/37,s=total*mod1(uf),q=W.sample(s,9.55);
    tmp.position.copy(q.p);tmp.position.y+=1.50;tmp.rotation.set(0,Math.atan2(q.t.x,q.t.z),0);tmp.updateMatrix();posts.setMatrixAt(i,tmp.matrix);
  }
  posts.instanceMatrix.needsUpdate=true;pit.add(posts);

  const crews=[];
  const garageDepth=8.5,garageWidth=5.4;
  function signTexture(name,color){
    const c=document.createElement('canvas');c.width=512;c.height=128;const g=c.getContext('2d');
    g.fillStyle=`#${color.toString(16).padStart(6,'0')}`;g.fillRect(0,0,512,128);g.fillStyle='#fff';g.font='900 54px -apple-system,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(name,256,64);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
  }
  function crewMember(color){
    const root=new THREE.Group();
    const suit=new THREE.MeshStandardMaterial({color,roughness:.72}),skin=new THREE.MeshStandardMaterial({color:0xd7a57f,roughness:.9}),helmet=new THREE.MeshStandardMaterial({color:0xf0f0f0,roughness:.4,metalness:.08});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.17,.21,.72,7),suit);body.position.y=.55;
    const head=new THREE.Mesh(new THREE.SphereGeometry(.16,8,6),skin);head.position.y=1.02;
    const helm=new THREE.Mesh(new THREE.SphereGeometry(.18,8,6,0,Math.PI*2,0,Math.PI*.62),helmet);helm.position.y=1.07;
    root.add(body,head,helm);root.traverse(o=>{if(o.isMesh)o.castShadow=true;});return root;
  }
  for(let team=0;team<10;team++){
    const s=pitBoxS(team),q=W.sample(s,BOX),ang=Math.atan2(q.t.x,q.t.z),g=new THREE.Group();g.position.copy(q.p);g.rotation.y=ang;pit.add(g);
    const teamM=new THREE.MeshStandardMaterial({color:TEAM_COLORS[team],roughness:.55,metalness:.08});
    const box=new THREE.Mesh(new THREE.BoxGeometry(3.0,.024,5.5),whiteM);box.position.set(0,.10,0);g.add(box);
    const inset=new THREE.Mesh(new THREE.BoxGeometry(2.72,.027,5.18),apronM);inset.position.set(0,.115,0);g.add(inset);
    for(const x of[-1.12,1.12])for(const z of[-1.62,1.62]){const mark=new THREE.Mesh(new THREE.BoxGeometry(.38,.028,.72),teamM);mark.position.set(x,.132,z);g.add(mark);}
    const center=new THREE.Mesh(new THREE.BoxGeometry(.06,.03,4.7),yellowM);center.position.set(0,.137,0);g.add(center);

    const garage=new THREE.Group();garage.position.set(7.15,0,-.15);g.add(garage);
    const floor=new THREE.Mesh(new THREE.BoxGeometry(garageWidth,.16,garageDepth),darkM);floor.position.y=.08;garage.add(floor);
    const back=new THREE.Mesh(new THREE.BoxGeometry(garageWidth,3.8,.22),concreteM);back.position.set(0,1.9,-garageDepth*.5);garage.add(back);
    const left=new THREE.Mesh(new THREE.BoxGeometry(.20,3.8,garageDepth),concreteM);left.position.set(-garageWidth*.5,1.9,0);garage.add(left);
    const right=left.clone();right.position.x=garageWidth*.5;garage.add(right);
    const roof=new THREE.Mesh(new THREE.BoxGeometry(garageWidth+.4,.24,garageDepth+.4),roofM);roof.position.set(0,3.92,0);garage.add(roof);
    const fascia=new THREE.Mesh(new THREE.BoxGeometry(garageWidth+.05,.62,.32),teamM);fascia.position.set(0,3.38,garageDepth*.47);garage.add(fascia);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(3.8,.80),new THREE.MeshBasicMaterial({map:signTexture(TEAM_NAMES[team],TEAM_COLORS[team]),side:THREE.DoubleSide}));
    sign.position.set(0,3.35,garageDepth*.5+.18);garage.add(sign);
    const window=new THREE.Mesh(new THREE.PlaneGeometry(3.4,1.05),glass);window.position.set(0,2.15,-garageDepth*.5+.13);garage.add(window);

    const stand=new THREE.Mesh(new THREE.BoxGeometry(.12,2.5,.12),metalM);stand.position.set(-2.35,1.25,-1.2);g.add(stand);
    const board=new THREE.Mesh(new THREE.BoxGeometry(.82,.72,.09),teamM);board.position.set(-2.35,2.08,-1.2);g.add(board);

    for(const z of[-2.7,2.5]){
      const stack=new THREE.Group();stack.position.set(4.9,.43,z);g.add(stack);
      for(let k=0;k<3;k++){const tire=new THREE.Mesh(new THREE.TorusGeometry(.34,.13,8,14),tireM);tire.rotation.x=Math.PI/2;tire.position.y=k*.22;stack.add(tire);}
    }
    for(const z of[-1.6,1.6]){const gun=new THREE.Mesh(new THREE.BoxGeometry(.22,.20,.52),metalM);gun.position.set(3.35,.35,z);g.add(gun);}

    const memberData=[];
    const service=[[-1.75,0,-1.6],[1.75,0,-1.6],[-1.75,0,1.6],[1.75,0,1.6]];
    for(let k=0;k<4;k++){
      const cr=crewMember(TEAM_COLORS[team]),home=new THREE.Vector3(4.55,0,-2.4+k*1.6),svc=new THREE.Vector3(...service[k]);cr.position.copy(home);g.add(cr);memberData.push({root:cr,home,service:svc});
    }
    crews[team]={group:g,members:memberData,activity:0};
  }

  function boardAt(f,offset,text){
    const q=W.sample(total*mod1(f),offset),root=new THREE.Group();root.position.copy(q.p);root.rotation.y=Math.atan2(q.t.x,q.t.z);
    const pole=new THREE.Mesh(new THREE.BoxGeometry(.10,2.4,.10),metalM);pole.position.set(0,1.2,0);root.add(pole);
    const c=document.createElement('canvas');c.width=256;c.height=256;const gg=c.getContext('2d');gg.fillStyle='#fff';gg.fillRect(0,0,256,256);gg.strokeStyle='#e11';gg.lineWidth=18;gg.beginPath();gg.arc(128,128,92,0,Math.PI*2);gg.stroke();gg.fillStyle='#111';gg.font='900 86px sans-serif';gg.textAlign='center';gg.textBaseline='middle';gg.fillText(text,128,132);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.3,1.3),new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));sign.position.set(0,2.0,.05);root.add(sign);pit.add(root);
  }
  boardAt(FULL,LANE+3.8,'80');boardAt(EXIT_BEGIN,LANE+3.8,'80');

  const exitQ=W.sample(total*EXIT_BEGIN,LANE+3.3),lightRoot=new THREE.Group();lightRoot.position.copy(exitQ.p);lightRoot.rotation.y=Math.atan2(exitQ.t.x,exitQ.t.z);pit.add(lightRoot);
  const mast=new THREE.Mesh(new THREE.BoxGeometry(.12,2.6,.12),metalM);mast.position.y=1.3;lightRoot.add(mast);
  const greenM=new THREE.MeshStandardMaterial({color:0x003500,emissive:0x35ff5c,emissiveIntensity:1.8}),redM=new THREE.MeshStandardMaterial({color:0x350000,emissive:0xff1a1a,emissiveIntensity:.15});
  const lg=new THREE.Mesh(new THREE.SphereGeometry(.17,10,8),greenM);lg.position.set(0,2.15,.12);const lr=new THREE.Mesh(new THREE.SphereGeometry(.17,10,8),redM);lr.position.set(0,2.55,.12);lightRoot.add(lg,lr);

  function updatePitCrews(activeTeams,dt){
    for(let team=0;team<crews.length;team++){
      const c=crews[team];if(!c)continue;
      const target=activeTeams?.has(team)?1:0;c.activity=THREE.MathUtils.lerp(c.activity,target,1-Math.exp(-5*dt));
      for(const m of c.members)m.root.position.copy(m.home).lerp(m.service,c.activity);
    }
  }

  W.pitLaneOffset=LANE;W.pitBoxOffset=BOX;W.pitSpeedLimit=PIT_LIMIT;W.pitEntryFraction=ENTRY;W.pitExitFraction=EXIT_END;
  W.pitOffsetAtS=pitOffsetAtS;W.inPitWindow=inPitWindow;W.inPitSpeedZone=inPitSpeedZone;W.pitBoxS=pitBoxS;W.pitPose=pitPose;W.updatePitCrews=updatePitCrews;W.pitComplex=pit;
  return W;
}
