import {buildWorld as buildV39World} from './v39-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV39World(THREE,TRACK,settings,circuitName),total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);},wrapF=f=>((f%1)+1)%1;

  // --- Multiple race lines -------------------------------------------------
  // v39's line is the dry qualifying/optimal line. Build a small family of
  // alternatives once at load time; race AI can then choose a line without
  // allocating or solving a new path every frame.
  const lineCount=Math.max(900,Math.min(1500,Math.round(total/4.2))),lineStep=total/lineCount;
  const lineModes={OPTIMAL:new Float32Array(lineCount),WET:new Float32Array(lineCount),DEFEND:new Float32Array(lineCount),ATTACK_LEFT:new Float32Array(lineCount),ATTACK_RIGHT:new Float32Array(lineCount)};
  const lineCurv={};
  const idx=i=>(i%lineCount+lineCount)%lineCount;
  for(let i=0;i<lineCount;i++){
    const s=i*lineStep,opt=clamp(W.racingLineAt?.(s)||0,-3.05,3.05),k=W.curvatureAt?.(s+55)||0,sign=Math.sign(k)||1,str=clamp(Math.abs(k)*70,0,1);
    lineModes.OPTIMAL[i]=opt;
    lineModes.WET[i]=clamp(opt-sign*(.75+str*.65),-3.20,3.20);
    lineModes.DEFEND[i]=clamp(opt+sign*(.55+str*.90),-3.20,3.20);
    lineModes.ATTACK_LEFT[i]=clamp(opt-1.05,-3.25,3.25);
    lineModes.ATTACK_RIGHT[i]=clamp(opt+1.05,-3.25,3.25);
  }
  const field=(arr,s)=>{const u=((((s%total)+total)%total)/total)*lineCount,i=Math.floor(u),f=u-i;return arr[idx(i)]*(1-f)+arr[idx(i+1)]*f;};
  for(const [name,arr] of Object.entries(lineModes)){
    const pts=new Array(lineCount),raw=new Float32Array(lineCount),curv=new Float32Array(lineCount);
    for(let i=0;i<lineCount;i++)pts[i]=W.sample(i*lineStep,arr[i]).p;
    for(let i=0;i<lineCount;i++){
      const p0=pts[idx(i-1)],p1=pts[i],p2=pts[idx(i+1)],ax=p1.x-p0.x,az=p1.z-p0.z,bx=p2.x-p1.x,bz=p2.z-p1.z,l1=Math.hypot(ax,az)||1,l2=Math.hypot(bx,bz)||1,dot=clamp((ax*bx+az*bz)/(l1*l2),-1,1),cross=(ax*bz-az*bx)/(l1*l2);
      raw[i]=Math.atan2(cross,dot)/Math.max(.5,(l1+l2)*.5);
    }
    for(let i=0;i<lineCount;i++)curv[i]=raw[idx(i-2)]*.08+raw[idx(i-1)]*.18+raw[i]*.48+raw[idx(i+1)]*.18+raw[idx(i+2)]*.08;
    lineCurv[name]=curv;
  }
  W.racingLineFor=(s,mode='OPTIMAL')=>field(lineModes[mode]||lineModes.OPTIMAL,s);
  W.racingCurvatureFor=(s,mode='OPTIMAL')=>field(lineCurv[mode]||lineCurv.OPTIMAL,s);
  W.racingLineModes=Object.keys(lineModes);

  // --- Real pit lane geometry ---------------------------------------------
  // The old pit was only the main track shifted 13.6 m sideways. At Suzuka's
  // start/finish complex that visually overlapped the race surface, and the
  // garage local +X direction pointed inward. Replace it with a separate,
  // wider-offset continuous lane and position garages on the actual outside.
  const oldPit=W.scene.getObjectByName?.('PIT_COMPLEX_V11');if(oldPit)oldPit.visible=false;
  const pitRoot=new THREE.Group();pitRoot.name='PIT_COMPLEX_V41';W.scene.add(pitRoot);
  const ENTRY=.942,FULL=.978,BOX0=.994,BOX_GAP=.00545,EXIT_BEGIN=1.062,EXIT_END=1.095,PIT_CENTER=21.5,PIT_LIMIT=22.22;
  const span=EXIT_END-ENTRY,pitN=300,pitP=new Array(pitN),pitT=new Array(pitN),pitSide=new Array(pitN),pitF=new Float32Array(pitN);
  function unwrapFracFromS(s){let f=wrapF(s/total);if(f<ENTRY)f+=1;return f;}
  function offsetAtUF(uf){if(uf<=ENTRY||uf>=EXIT_END)return 0;if(uf<FULL)return PIT_CENTER*smooth((uf-ENTRY)/(FULL-ENTRY));if(uf<=EXIT_BEGIN)return PIT_CENTER;return PIT_CENTER*(1-smooth((uf-EXIT_BEGIN)/(EXIT_END-EXIT_BEGIN)));}
  for(let i=0;i<pitN;i++){
    const uf=ENTRY+span*i/(pitN-1),s=wrapF(uf)*total,off=offsetAtUF(uf),q=W.sample(s,off);pitF[i]=uf;pitP[i]=q.p.clone();
  }
  for(let i=0;i<pitN;i++){
    const a=pitP[Math.max(0,i-1)],b=pitP[Math.min(pitN-1,i+1)],t=b.clone().sub(a).setY(0).normalize(),side=new THREE.Vector3(-t.z,0,t.x).normalize();pitT[i]=t;pitSide[i]=side;
  }
  function pitSampleUF(uf){
    const u=clamp((uf-ENTRY)/span,0,1)*(pitN-1),i=Math.min(pitN-2,Math.floor(u)),f=u-i,p=pitP[i].clone().lerp(pitP[i+1],f),t=pitT[i].clone().lerp(pitT[i+1],f).normalize(),side=new THREE.Vector3(-t.z,0,t.x).normalize();
    return{p,t,side,rotationY:Math.atan2(t.x,t.z),uf};
  }
  const boxUF=team=>BOX0+clamp(Number(team)||0,0,9)*BOX_GAP;
  W.pitBoxFraction=team=>wrapF(boxUF(team));
  W.pitBoxS=team=>W.pitBoxFraction(team)*total;
  W.pitUnwrappedFraction=s=>unwrapFracFromS(s);
  W.pitOffsetAtS=s=>offsetAtUF(unwrapFracFromS(s));
  W.inPitWindow=s=>{const f=unwrapFracFromS(s);return f>=ENTRY&&f<=EXIT_END;};
  W.inPitSpeedZone=s=>{const f=unwrapFracFromS(s);return f>=FULL-.002&&f<=EXIT_BEGIN+.002;};
  W.pitSpeedLimit=PIT_LIMIT;
  W.pitPose=(s,teamId=0,state='ENTRY')=>{
    const uf=state==='STOP'?boxUF(teamId):unwrapFracFromS(s),q=pitSampleUF(uf);return{...q,s:wrapF(uf)*total,offset:offsetAtUF(uf)};
  };
  W.pitDistanceToBox=(s,teamId=0)=>{const f=unwrapFracFromS(s),b=boxUF(teamId);return(b-f)*total;};
  W.pitEntryFraction=ENTRY;W.pitExitFraction=wrapF(EXIT_END);

  const asphalt=new THREE.MeshStandardMaterial({color:0x303438,roughness:.90,metalness:.018,side:THREE.DoubleSide}),apron=new THREE.MeshStandardMaterial({color:0x65696b,roughness:.94,side:THREE.DoubleSide}),white=new THREE.MeshStandardMaterial({color:0xf3f1e8,roughness:.76,side:THREE.DoubleSide}),yellow=new THREE.MeshStandardMaterial({color:0xf0c72d,roughness:.72,side:THREE.DoubleSide}),concrete=new THREE.MeshStandardMaterial({color:0xb7bab8,roughness:.88}),dark=new THREE.MeshStandardMaterial({color:0x1c2125,roughness:.73,metalness:.12}),roof=new THREE.MeshStandardMaterial({color:0x51595e,roughness:.74,metalness:.2}),glass=new THREE.MeshPhysicalMaterial({color:0x213843,roughness:.12,transparent:true,opacity:.60,clearcoat:.6});
  function ribbon(halfWidth,mat,y=.07,lateral=0){const pos=[],ind=[];for(let i=0;i<pitN;i++){const c=pitP[i].clone().addScaledVector(pitSide[i],lateral),l=c.clone().addScaledVector(pitSide[i],-halfWidth),r=c.clone().addScaledVector(pitSide[i],halfWidth);l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);}for(let i=0;i<pitN-1;i++){const a=i*2,b=a+1,c=(i+1)*2,d=c+1;ind.push(a,b,c,b,d,c);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.receiveShadow=true;pitRoot.add(m);return m;}
  ribbon(6.0,apron,.045);ribbon(3.35,asphalt,.066);ribbon(.075,white,.108,-3.10);ribbon(.075,white,.108,3.10);ribbon(.065,yellow,.112,0);

  // Pit wall between racing surface and pit lane; leave entry/exit merges open.
  const wallGeo=new THREE.BoxGeometry(3.4,.82,.36),wallDummy=new THREE.Object3D(),wallSegments=[];
  for(let uf=.982;uf<=1.058;uf+=.0046){const q=W.sample(wrapF(uf)*total,13.1);wallSegments.push(q);}
  const walls=new THREE.InstancedMesh(wallGeo,concrete,wallSegments.length);
  wallSegments.forEach((q,i)=>{wallDummy.position.copy(q.p);wallDummy.position.y+=.45;wallDummy.rotation.set(0,Math.atan2(q.t.x,q.t.z),0);wallDummy.updateMatrix();walls.setMatrixAt(i,wallDummy.matrix);});walls.instanceMatrix.needsUpdate=true;walls.receiveShadow=true;pitRoot.add(walls);

  const teamColors=[0xe3312d,0x287de1,0xf2c52f,0xf3f3f3,0x20bd7b,0x9362df,0xed7b27,0x22aab8,0xe04a90,0xaeb6c1],teamNames=['APEX','VORTEX','ORION','SAKURA','TITAN','NOVA','FALCON','HELIX','VECTOR','PULSE'];
  function signTexture(name,color){const c=document.createElement('canvas');c.width=384;c.height=96;const g=c.getContext('2d');g.fillStyle=`#${color.toString(16).padStart(6,'0')}`;g.fillRect(0,0,c.width,c.height);g.fillStyle='#fff';g.font='900 40px -apple-system,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(name,c.width/2,c.height/2);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
  const garageGroups=[];
  for(let team=0;team<10;team++){
    const q=pitSampleUF(boxUF(team)),g=new THREE.Group();g.position.copy(q.p);g.rotation.y=q.rotationY;pitRoot.add(g);garageGroups.push(g);
    const teamMat=new THREE.MeshStandardMaterial({color:teamColors[team],roughness:.56});
    const box=new THREE.Mesh(new THREE.BoxGeometry(3.0,.025,5.1),white);box.position.y=.10;g.add(box);const inset=new THREE.Mesh(new THREE.BoxGeometry(2.72,.028,4.82),apron);inset.position.y=.118;g.add(inset);
    // local -X is the positive track-side vector for this yaw, i.e. farther away from the circuit.
    const garage=new THREE.Group();garage.position.set(-10.2,0,0);g.add(garage);
    const floor=new THREE.Mesh(new THREE.BoxGeometry(7.2,.16,5.1),dark);floor.position.y=.08;garage.add(floor);const back=new THREE.Mesh(new THREE.BoxGeometry(.22,3.9,5.1),concrete);back.position.set(-3.5,1.95,0);garage.add(back);const sideA=new THREE.Mesh(new THREE.BoxGeometry(7.2,3.9,.20),concrete);sideA.position.set(0,1.95,-2.45);garage.add(sideA);const sideB=sideA.clone();sideB.position.z=2.45;garage.add(sideB);const top=new THREE.Mesh(new THREE.BoxGeometry(7.5,.24,5.35),roof);top.position.set(0,4.0,0);garage.add(top);const fascia=new THREE.Mesh(new THREE.BoxGeometry(.34,.70,5.0),teamMat);fascia.position.set(3.45,3.45,0);garage.add(fascia);const sign=new THREE.Mesh(new THREE.PlaneGeometry(3.8,.78),new THREE.MeshBasicMaterial({map:signTexture(teamNames[team],teamColors[team]),side:THREE.DoubleSide}));sign.rotation.y=-Math.PI/2;sign.position.set(3.64,3.43,0);garage.add(sign);const window=new THREE.Mesh(new THREE.PlaneGeometry(3.0,1.05),glass);window.rotation.y=Math.PI/2;window.position.set(-3.37,2.25,0);garage.add(window);
  }

  // The v12 detailed crew groups are useful, but they were created at the old
  // pit coordinates. Re-seat each team on the new physical pit boxes.
  const oldAnim=W.scene.getObjectByName?.('PIT_ANIMATION_V12');
  if(oldAnim){oldAnim.visible=true;for(let team=0;team<Math.min(10,oldAnim.children.length);team++){const q=pitSampleUF(boxUF(team)),g=oldAnim.children[team];g.position.copy(q.p);g.rotation.y=q.rotationY;}}
  // v13's separate service rigs have no stable public handles and were anchored
  // to the obsolete lane. Disable only that decorative layer to avoid ghost rigs;
  // the detailed wheel/jack/release crew remains active through v12.
  if(W.updatePitService)W.updatePitService=()=>{};

  W.pitComplexV41={root:pitRoot,entry:ENTRY,full:FULL,exitBegin:EXIT_BEGIN,exitEnd:EXIT_END,centerOffset:PIT_CENTER,garageGroups};
  return W;
}
