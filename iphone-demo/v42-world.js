import {buildWorld as buildV41World} from './v41-world.js';
import {SUZUKA_PIT,BUILDING_LAYOUT} from './v42-config.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV41World(THREE,TRACK,settings,circuitName),total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrapF=f=>((f%1)+1)%1;
  const pitOld=W.pitPose?.bind(W);
  const oldPitComplex=W.scene.getObjectByName?.('PIT_COMPLEX_V41');
  if(oldPitComplex)oldPitComplex.visible=false;

  const oldBarrier=W.trackBarriers?.root;
  if(oldBarrier?.parent){
    oldBarrier.parent.remove(oldBarrier);
    oldBarrier.traverse?.(o=>{
      o.geometry?.dispose?.();
      const mats=Array.isArray(o.material)?o.material:[o.material];
      for(const m of mats)m?.dispose?.();
    });
  }

  const obsolete=[];
  W.scene.traverse(o=>{
    if(!o?.isMesh||o.isInstancedMesh||o.geometry?.type!=='BoxGeometry')return;
    const p=o.geometry.parameters||{};
    if(Math.abs((p.width||0)-38)<.08&&Math.abs((p.height||0)-10)<.08&&Math.abs((p.depth||0)-18)<.08)obsolete.push(o);
  });
  for(const o of obsolete)o.parent?.remove(o);

  const home=W.sample(total*.012),legacyStand=[];
  for(const o of [...W.scene.children]){
    if(!o?.isGroup||o===oldPitComplex)continue;
    let tierCount=0;
    o.traverse?.(x=>{
      if(!x?.isMesh||x.geometry?.type!=='BoxGeometry')return;
      const p=x.geometry.parameters||{};
      if(Math.abs((p.width||0)-38)<.08&&Math.abs((p.height||0)-1.2)<.08&&Math.abs((p.depth||0)-5)<.08)tierCount++;
    });
    if(tierCount<5)continue;
    const d=o.position.clone().sub(home.p),lat=d.dot(home.side),along=d.dot(home.t);
    if(lat>40&&lat<85&&Math.abs(along)<120)legacyStand.push(o);
  }
  for(const o of legacyStand)o.parent?.remove(o);

  const boxUF=team=>SUZUKA_PIT.box0UF+clamp(Number(team)||0,0,9)*(SUZUKA_PIT.boxGapMeters/total);
  W.pitBoxFraction=team=>wrapF(boxUF(team));
  W.pitBoxS=team=>W.pitBoxFraction(team)*total;
  W.pitDistanceToBox=(s,team=0)=>((W.pitUnwrappedFraction?.(s)??wrapF(s/total))-boxUF(team))*-total;
  if(pitOld){
    W.pitPose=(s,team=0,state='ENTRY')=>{
      if(state!=='STOP')return pitOld(s,team,state);
      const bs=W.pitBoxS(team),q=pitOld(bs,team,'ENTRY');
      return {...q,s:bs};
    };
  }

  const oldAnim=W.scene.getObjectByName?.('PIT_ANIMATION_V12');
  if(oldAnim){
    for(let team=0;team<Math.min(10,oldAnim.children.length);team++){
      const q=W.pitPose(W.pitBoxS(team),team,'STOP'),g=oldAnim.children[team];
      g.position.copy(q.p);g.rotation.y=q.rotationY;
    }
  }

  const root=new THREE.Group();root.name='SUZUKA_HOME_COMPLEX_V42';W.scene.add(root);
  const asphalt=new THREE.MeshStandardMaterial({color:0x303438,roughness:.91});
  const concrete=new THREE.MeshStandardMaterial({color:0xe4e5e2,roughness:.84});
  const concreteDark=new THREE.MeshStandardMaterial({color:0xb8bbb9,roughness:.88});
  const glass=new THREE.MeshPhysicalMaterial({color:0x1e3b4c,roughness:.12,transparent:true,opacity:.68,clearcoat:.65});
  const roofMat=new THREE.MeshStandardMaterial({color:0xf1f2ef,roughness:.68,metalness:.08});
  const dark=new THREE.MeshStandardMaterial({color:0x171b1e,roughness:.72,metalness:.12});
  const blue=new THREE.MeshStandardMaterial({color:0x1683cc,roughness:.72});
  const pitWallMat=new THREE.MeshStandardMaterial({color:0xf2f2ee,roughness:.86});
  const railMat=new THREE.MeshStandardMaterial({color:0xb3babd,metalness:.70,roughness:.37,side:THREE.DoubleSide});
  const postMat=new THREE.MeshStandardMaterial({color:0x6b7376,metalness:.56,roughness:.48});
  const tireBlack=new THREE.MeshStandardMaterial({color:0x111111,roughness:.95});
  const tireRed=new THREE.MeshStandardMaterial({color:0xc8322d,roughness:.84});
  const teamColors=[0xe3312d,0x287de1,0xf2c52f,0xf3f3f3,0x20bd7b,0x9362df,0xed7b27,0x22aab8,0xe04a90,0xaeb6c1];

  function add(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0){
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);
    m.receiveShadow=true;parent.add(m);return m;
  }
  function signTexture(text,bg='#20262b'){
    const c=document.createElement('canvas');c.width=512;c.height=112;const g=c.getContext('2d');
    g.fillStyle=bg;g.fillRect(0,0,c.width,c.height);g.fillStyle='#fff';
    g.font='900 48px -apple-system,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(text,256,58);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
  }
  function poseUF(uf,offset=0){
    const s=wrapF(uf)*total,q=W.sample(s,offset);
    return {...q,rotationY:Math.atan2(q.t.x,q.t.z),uf};
  }
  function pitCenterUF(uf){
    const s=wrapF(uf)*total,q=pitOld?pitOld(s,0,'ENTRY'):W.pitPose(s,0,'ENTRY');
    return {...q,uf};
  }

  const pitSamples=300,pitPts=[],pitSides=[];
  for(let i=0;i<pitSamples;i++){
    const uf=SUZUKA_PIT.entryUF+(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.entryUF)*i/(pitSamples-1),q=pitCenterUF(uf);
    pitPts.push(q.p.clone());
  }
  for(let i=0;i<pitSamples;i++){
    const a=pitPts[Math.max(0,i-1)],b=pitPts[Math.min(pitSamples-1,i+1)],t=b.clone().sub(a).setY(0).normalize();
    pitSides.push(new THREE.Vector3(-t.z,0,t.x).normalize());
  }
  function pathRibbon(halfWidth,mat,y=.07,lateral=0){
    const pos=[],ind=[];
    for(let i=0;i<pitSamples;i++){
      const c=pitPts[i].clone().addScaledVector(pitSides[i],lateral),l=c.clone().addScaledVector(pitSides[i],-halfWidth),r=c.clone().addScaledVector(pitSides[i],halfWidth);
      l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);
    }
    for(let i=0;i<pitSamples-1;i++){const a=i*2,b=a+1,c=(i+1)*2,d=c+1;ind.push(a,b,c,b,d,c);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();
    const m=new THREE.Mesh(g,mat);m.receiveShadow=true;root.add(m);return m;
  }
  pathRibbon(5.15,concreteDark,.045);
  pathRibbon(SUZUKA_PIT.laneHalfWidth,asphalt,.068);
  pathRibbon(.42,blue,.086,-SUZUKA_PIT.laneHalfWidth-.55);

  const buildingStart=boxUF(0)-12/total,buildingEnd=boxUF(9)+12/total,buildingLength=(buildingEnd-buildingStart)*total;
  const bayPitch=8.2,bays=Math.max(18,Math.round(buildingLength/bayPitch));
  for(let i=0;i<bays;i++){
    const uf=buildingStart+(buildingEnd-buildingStart)*(i+.5)/bays,q=pitCenterUF(uf),g=new THREE.Group();
    g.position.copy(q.p);g.rotation.y=q.rotationY;root.add(g);
    const pitch=buildingLength/bays+0.22,x=-BUILDING_LAYOUT.garageCenterOffset;
    add(g,new THREE.BoxGeometry(BUILDING_LAYOUT.garageDepth,BUILDING_LAYOUT.garageHeight,pitch),concrete,x,BUILDING_LAYOUT.garageHeight/2,0);
    add(g,new THREE.PlaneGeometry(pitch*.76,2.70),dark,x+BUILDING_LAYOUT.garageDepth*.5+.012,1.58,0,0,Math.PI/2,0);
    add(g,new THREE.BoxGeometry(BUILDING_LAYOUT.garageDepth+.35,BUILDING_LAYOUT.hospitalityHeight,pitch),concrete,x-.10,5.62,0);
    add(g,new THREE.PlaneGeometry(pitch*.76,1.75),glass,x+BUILDING_LAYOUT.garageDepth*.5+.20,5.62,0,0,Math.PI/2,0);
    add(g,new THREE.BoxGeometry(10.6,.22,pitch+.12),roofMat,-7.65,BUILDING_LAYOUT.canopyHeight,0);
    const rail=add(g,new THREE.BoxGeometry(.09,1.05,pitch),dark,-6.20,6.98,0);rail.castShadow=false;
  }

  for(let team=0;team<10;team++){
    const uf=boxUF(team),q=pitCenterUF(uf),g=new THREE.Group();g.position.copy(q.p);g.rotation.y=q.rotationY;root.add(g);
    add(g,new THREE.BoxGeometry(2.9,.026,5.6),concrete,0,.10,0);
    add(g,new THREE.BoxGeometry(2.60,.028,5.25),asphalt,0,.116,0);
    const tm=new THREE.MeshStandardMaterial({color:teamColors[team],roughness:.58});
    add(g,new THREE.BoxGeometry(.08,.032,4.7),tm,0,.134,0);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(2.6,.62),new THREE.MeshBasicMaterial({map:signTexture(`PIT ${String(team+1).padStart(2,'0')}`,`#${teamColors[team].toString(16).padStart(6,'0')}`),side:THREE.DoubleSide}));
    sign.rotation.y=Math.PI/2;sign.position.set(-6.25,3.35,0);g.add(sign);
  }

  {
    const q=pitCenterUF(buildingStart-.004),g=new THREE.Group();g.position.copy(q.p);g.rotation.y=q.rotationY;root.add(g);
    add(g,new THREE.BoxGeometry(9.0,7.2,18),concrete,-11.6,3.6,0);
    add(g,new THREE.BoxGeometry(9.4,2.0,18.4),glass,-11.5,7.25,0);
    add(g,new THREE.BoxGeometry(10.2,.28,19.0),roofMat,-11.5,8.42,0);
    const s=new THREE.Mesh(new THREE.PlaneGeometry(7.5,1.35),new THREE.MeshBasicMaterial({map:signTexture('SUZUKA CIRCUIT','#20272d'),side:THREE.DoubleSide}));
    s.rotation.y=Math.PI/2;s.position.set(-6.92,6.6,0);g.add(s);
  }
  {
    const q=pitCenterUF(buildingEnd+.006),g=new THREE.Group();g.position.copy(q.p);g.rotation.y=q.rotationY;root.add(g);
    add(g,new THREE.BoxGeometry(4.2,19,4.2),dark,-BUILDING_LAYOUT.timingTowerOffset,9.5,0);
    add(g,new THREE.BoxGeometry(4.8,3.2,4.8),concrete,-BUILDING_LAYOUT.timingTowerOffset,20.6,0);
    const tex=signTexture('TIMING','#12171b'),p=new THREE.Mesh(new THREE.PlaneGeometry(3.4,10.5),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
    p.rotation.y=Math.PI/2;p.position.set(-BUILDING_LAYOUT.timingTowerOffset+2.13,11.0,0);g.add(p);
  }

  for(const meter of[35,92,149]){
    const uf=buildingStart+meter/Math.max(1,buildingLength)*(buildingEnd-buildingStart),q=pitCenterUF(uf),g=new THREE.Group();
    g.position.copy(q.p);g.rotation.y=q.rotationY;root.add(g);
    add(g,new THREE.BoxGeometry(12,5.2,32),concreteDark,-27,2.6,0);
    add(g,new THREE.BoxGeometry(12.5,.25,32.5),roofMat,-27,5.3,0);
  }

  const grandStart=.986,grandEnd=1.047,grandSections=11;
  for(let i=0;i<grandSections;i++){
    const uf=grandStart+(grandEnd-grandStart)*(i+.5)/grandSections,q=poseUF(uf,BUILDING_LAYOUT.mainGrandstandOffset),g=new THREE.Group();
    g.position.copy(q.p);g.rotation.y=q.rotationY+Math.PI;root.add(g);
    for(let r=0;r<7;r++)add(g,new THREE.BoxGeometry(38/grandSections,1.05,3.6),concreteDark,0,r*.92,5+r*2.6);
    add(g,new THREE.BoxGeometry(40/grandSections,.30,24),roofMat,0,9.1,11,-.10);
    add(g,new THREE.BoxGeometry(38/grandSections,3.0,5.0),glass,0,6.7,-.2);
  }

  const barrierRoot=new THREE.Group();barrierRoot.name='PHYSICAL_BARRIERS_V42';W.scene.add(barrierRoot);
  const count=Math.max(720,Math.min(1500,Math.round(total/4.3))),step=total/count,offset=SUZUKA_PIT.trackBarrierOffset,width=.34,height=.88,colliders=[],colliderBuckets=Array.from({length:count},()=>[null,null]);
  const inRange=(f,a,b)=>f>=a&&f<=b;
  const positiveGap=f=>inRange(f,SUZUKA_PIT.entryGap[0],SUZUKA_PIT.entryGap[1])||inRange(f,SUZUKA_PIT.exitGap[0],SUZUKA_PIT.exitGap[1]);
  const valid=(sideSign,f)=>sideSign<0||!positiveGap(f);
  const addTri=(a,p0,p1,p2)=>a.push(p0.x,p0.y,p0.z,p1.x,p1.y,p1.z,p2.x,p2.y,p2.z);

  function buildRail(sideSign){
    const pos=[];
    for(let i=0;i<count;i++){
      const j=(i+1)%count,f=i/count,fj=j/count;
      if(!valid(sideSign,f)||!valid(sideSign,fj))continue;
      const qa=W.sample(total*f),qb=W.sample(total*fj),ca=qa.p.clone().addScaledVector(qa.side,offset*sideSign),cb=qb.p.clone().addScaledVector(qb.side,offset*sideSign);
      const ia=ca.clone().addScaledVector(qa.side,-sideSign*width*.5),oa=ca.clone().addScaledVector(qa.side,sideSign*width*.5),ib=cb.clone().addScaledVector(qb.side,-sideSign*width*.5),ob=cb.clone().addScaledVector(qb.side,sideSign*width*.5);
      for(const p of[ia,oa,ib,ob])p.y+=.14;
      const tia=ia.clone(),toa=oa.clone(),tib=ib.clone(),tob=ob.clone();for(const p of[tia,toa,tib,tob])p.y+=height;
      addTri(pos,ia,ib,tia);addTri(pos,tia,ib,tib);addTri(pos,oa,toa,ob);addTri(pos,toa,tob,ob);addTri(pos,tia,tib,toa);addTri(pos,toa,tib,tob);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.computeVertexNormals();
    const m=new THREE.Mesh(geo,railMat);m.receiveShadow=true;m.name=sideSign>0?'V42_GUARDRAIL_PIT_SIDE':'V42_GUARDRAIL_OPPOSITE';barrierRoot.add(m);return m;
  }
  const railLeft=buildRail(-1),railRight=buildRail(1);

  const postGeo=new THREE.BoxGeometry(.13,1.10,.13),postDummy=new THREE.Object3D(),postMatrices=[];
  for(let i=0;i<count;i+=3){
    const f=i/count,q=W.sample(total*f),yaw=Math.atan2(q.t.x,q.t.z);
    for(const sideSign of[-1,1]){
      if(!valid(sideSign,f))continue;
      postDummy.position.copy(q.p).addScaledVector(q.side,offset*sideSign);postDummy.position.y+=.58;postDummy.rotation.set(0,yaw,0);postDummy.updateMatrix();postMatrices.push(postDummy.matrix.clone());
    }
  }
  const posts=new THREE.InstancedMesh(postGeo,postMat,Math.max(1,postMatrices.length));postMatrices.forEach((m,i)=>posts.setMatrixAt(i,m));posts.count=postMatrices.length;posts.instanceMatrix.needsUpdate=true;barrierRoot.add(posts);

  for(let i=0;i<count;i++){
    const f=i/count,s=total*f,q=W.sample(s);
    for(const sideSign of[-1,1]){
      if(!valid(sideSign,f))continue;
      const p=q.p.clone().addScaledVector(q.side,offset*sideSign);p.y+=.58;
      const c={index:i,sideSign,s,p,t:q.t.clone().setY(0).normalize(),side:q.side.clone().setY(0).normalize(),halfLength:step*.62,halfWidth:width*.5,height,material:(W.braking?.(s)||0)>.70?'TYRE':'GUARDRAIL'};
      colliders.push(c);colliderBuckets[i][sideSign>0?1:0]=c;
    }
  }

  const tyreGeo=new THREE.TorusGeometry(.33,.12,7,12);tyreGeo.rotateY(Math.PI/2);const tm=new THREE.Object3D(),blackM=[],redM=[];
  for(let i=0;i<count;i+=10){
    const f=i/count,s=total*f;if((W.braking?.(s)||0)<=.72)continue;const q=W.sample(s),yaw=Math.atan2(q.t.x,q.t.z);
    for(const sideSign of[-1,1]){
      if(!valid(sideSign,f))continue;
      for(let z=-2;z<=2;z++)for(let y=0;y<2;y++){
        tm.position.copy(q.p).addScaledVector(q.side,offset*sideSign-.30*sideSign);tm.position.y+=.34+y*.52;tm.position.addScaledVector(q.t,z*.58);tm.rotation.set(0,yaw,Math.PI/2);tm.updateMatrix();
        ((z+y)%3===0?redM:blackM).push(tm.matrix.clone());
      }
    }
  }
  const black=new THREE.InstancedMesh(tyreGeo,tireBlack,Math.max(1,blackM.length)),red=new THREE.InstancedMesh(tyreGeo,tireRed,Math.max(1,redM.length));
  blackM.forEach((m,i)=>black.setMatrixAt(i,m));redM.forEach((m,i)=>red.setMatrixAt(i,m));black.count=blackM.length;red.count=redM.length;black.instanceMatrix.needsUpdate=red.instanceMatrix.needsUpdate=true;barrierRoot.add(black,red);

  const wallGeo=new THREE.BoxGeometry(3.2,1.0,.38),wallDummy=new THREE.Object3D(),wallM=[];
  for(let uf=SUZUKA_PIT.fullUF+.003;uf<=SUZUKA_PIT.exitBeginUF-.004;uf+=3.2/total){
    const q=poseUF(uf,SUZUKA_PIT.pitWallOffset);wallDummy.position.copy(q.p);wallDummy.position.y+=.52;wallDummy.rotation.set(0,q.rotationY,0);wallDummy.updateMatrix();wallM.push(wallDummy.matrix.clone());
  }
  const pitWall=new THREE.InstancedMesh(wallGeo,pitWallMat,Math.max(1,wallM.length));wallM.forEach((m,i)=>pitWall.setMatrixAt(i,m));pitWall.count=wallM.length;pitWall.instanceMatrix.needsUpdate=true;root.add(pitWall);

  const hit={collider:null,inward:new THREE.Vector3(),penetration:0,long:0,normal:0,forwardX:0,forwardZ:1};
  W.barrierMaterialAt=s=>(W.braking?.(s)||0)>.70?'TYRE':'GUARDRAIL';
  W.barrierContact=car=>{
    if(!car?.mesh||car.retired||car.pitState!=='NONE')return null;
    const f=wrapF((car.s||0)/total),base=Math.round(f*count)%count,pos=car.mesh.position,yaw=car.mesh.rotation?.y||0,fx=Math.sin(yaw),fz=Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw),halfL=(car.length||car.mesh?.userData?.dims?.length||5.1)*.5,halfW=(car.width||car.mesh?.userData?.dims?.width||2)*.5;
    let best=null,bestPen=-1,bestLong=0,bestNormal=0;
    for(let di=-3;di<=3;di++){
      const idx=(base+di+count)%count,bucket=colliderBuckets[idx];
      for(let sideIndex=0;sideIndex<2;sideIndex++){
        const c=bucket[sideIndex];if(!c)continue;
        const dx=pos.x-c.p.x,dz=pos.z-c.p.z,long=dx*c.t.x+dz*c.t.z,normal=dx*c.side.x+dz*c.side.z,normalExtent=Math.abs(fx*c.side.x+fz*c.side.z)*halfL+Math.abs(rx*c.side.x+rz*c.side.z)*halfW,longExtent=Math.abs(fx*c.t.x+fz*c.t.z)*halfL+Math.abs(rx*c.t.x+rz*c.t.z)*halfW,penN=c.halfWidth+normalExtent-Math.abs(normal),penL=c.halfLength+longExtent-Math.abs(long);
        if(penN>=0&&penL>=0&&penN>bestPen){bestPen=penN;best=c;bestLong=long;bestNormal=normal;}
      }
    }
    if(!best)return null;
    hit.collider=best;hit.inward.copy(best.side).multiplyScalar(-best.sideSign);hit.penetration=Math.min(bestPen,1.2);hit.long=bestLong;hit.normal=bestNormal;hit.forwardX=fx;hit.forwardZ=fz;best.material=W.barrierMaterialAt(car.s||0);return hit;
  };
  W.trackBarriers={root:barrierRoot,rails:{left:railLeft,right:railRight},posts,tyres:{black,red},colliders,count,offset,step,smooth:true,pitGaps:true};

  function auditPitOpenings(){
    const test=(from,to)=>{
      let hits=0,min=Infinity;
      for(let n=0;n<=30;n++){
        const uf=from+(to-from)*n/30,q=pitCenterUF(uf),p=q.p;
        for(const c of colliders){
          const d=Math.hypot(p.x-c.p.x,p.z-c.p.z);if(d<min)min=d;if(d<3.3)hits++;
        }
      }
      return{hits,minClearance:Number.isFinite(min)?min:null};
    };
    return{entry:test(SUZUKA_PIT.entryUF-.004,SUZUKA_PIT.fullUF-.002),exit:test(SUZUKA_PIT.exitBeginUF+.002,SUZUKA_PIT.exitEndUF+.004)};
  }
  const buildingBoxes=[];
  root.traverse(o=>{if(o.isMesh&&o.geometry?.type==='BoxGeometry'){const b=new THREE.Box3().setFromObject(o);const size=new THREE.Vector3();b.getSize(size);if(size.y>2.5&&Math.max(size.x,size.z)>5)buildingBoxes.push(b);}});
  let laneBuildingMin=Infinity;
  for(let i=0;i<pitSamples;i+=3){
    const p=pitPts[i];
    for(const b of buildingBoxes){const d=b.distanceToPoint(p);if(d<laneBuildingMin)laneBuildingMin=d;}
  }
  W.circuitAudit={
    version:'v42',
    removedLegacyPitBoxes:obsolete.length,
    removedLegacyPitSideStands:legacyStand.length,
    pitOpenings:auditPitOpenings(),
    minimumPitLaneBuildingClearance:Number.isFinite(laneBuildingMin)?laneBuildingMin:null,
    logPersistence:'NONE',
    notes:['pit barriers use one geometry/collider mask','legacy home-straight pit buildings removed','main grandstand moved opposite pit building']
  };
  W.auditCircuit=()=>JSON.parse(JSON.stringify(W.circuitAudit));
  W.pitComplexV42={root,boxUF,buildingStart,buildingEnd,barrierRoot,pitWall};
  return W;
}
