import {buildWorld as buildAuditedWorld} from '../v42-world.js';
import {SUZUKA_PIT,BUILDING_LAYOUT} from './config.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildAuditedWorld(THREE,TRACK,settings,circuitName),total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=f=>((f%1)+1)%1,smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  const unwrap=s=>{let f=wrap(s/total);if(f<SUZUKA_PIT.entryUF)f+=1;return f;};
  const boxUF=team=>{let f=W.pitBoxFraction?.(team)??SUZUKA_PIT.box0UF;if(f<SUZUKA_PIT.entryUF)f+=1;return f;};

  // The pit lane now has two functional paths in the fully separated section:
  // a clear fast lane on the pit-wall side and a working lane on the garage side.
  // The garage-side edge is widened without moving the track-side edge back onto
  // the racing surface, preserving the clipped entry/exit merge from r2.
  const WORK_LANE_SHIFT=3.55;
  const OUTER_EXTENSION=2.35;
  const PIT_APPROACH_METERS=24;
  const PIT_EXIT_BLEND_METERS=18;
  const LANE_DIVIDER_SHIFT=1.72;

  const oldRoot=W.scene.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');
  const hidden=[];
  oldRoot?.traverse?.(o=>{
    const pos=o?.geometry?.getAttribute?.('position');
    if(o?.isMesh&&o.geometry?.type==='BufferGeometry'&&pos?.count===600){
      o.visible=false;hidden.push(o.name||'pit-ribbon');
      return;
    }
    // v42 drew generic garage doors at an independent ~8 m pitch and pit boxes
    // on the lane centre. Hide only those decorative pieces; replacements below
    // use the exact same longitudinal datum as each team's pit box.
    const p=o?.geometry?.parameters||{};
    if(o?.isMesh&&o.geometry?.type==='PlaneGeometry'&&Math.abs((p.height||0)-2.70)<.05){
      o.visible=false;hidden.push(o.name||'generic-garage-door');
    }
    if(o?.isMesh&&o.geometry?.type==='BoxGeometry'){
      const oldBox=(Math.abs((p.width||0)-2.9)<.06&&Math.abs((p.height||0)-.026)<.01&&Math.abs((p.depth||0)-5.6)<.08)
        ||(Math.abs((p.width||0)-2.60)<.06&&Math.abs((p.height||0)-.028)<.01&&Math.abs((p.depth||0)-5.25)<.08)
        ||(Math.abs((p.width||0)-.08)<.025&&Math.abs((p.height||0)-.032)<.012&&Math.abs((p.depth||0)-4.7)<.08);
      if(oldBox){o.visible=false;hidden.push(o.name||'legacy-pit-box');}
    }
    if(o?.isMesh&&o.geometry?.type==='PlaneGeometry'&&Math.abs((p.width||0)-2.6)<.06&&Math.abs((p.height||0)-.62)<.05){
      o.visible=false;hidden.push(o.name||'legacy-pit-sign');
    }
  });

  function offsetUF(uf){
    const merge=SUZUKA_PIT.mergeTrackOffset;
    if(uf<=SUZUKA_PIT.entryUF)return merge;
    if(uf<SUZUKA_PIT.fullUF)return merge+(SUZUKA_PIT.laneOffset-merge)*smooth((uf-SUZUKA_PIT.entryUF)/(SUZUKA_PIT.fullUF-SUZUKA_PIT.entryUF));
    if(uf<=SUZUKA_PIT.exitBeginUF)return SUZUKA_PIT.laneOffset;
    if(uf<SUZUKA_PIT.exitEndUF)return SUZUKA_PIT.laneOffset+(merge-SUZUKA_PIT.laneOffset)*smooth((uf-SUZUKA_PIT.exitBeginUF)/(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.exitBeginUF));
    return merge;
  }
  function widthUF(uf){
    const merge=SUZUKA_PIT.mergeHalfWidth,full=SUZUKA_PIT.laneHalfWidth;
    if(uf<=SUZUKA_PIT.entryUF)return merge;
    if(uf<SUZUKA_PIT.fullUF)return merge+(full-merge)*smooth((uf-SUZUKA_PIT.entryUF)/(SUZUKA_PIT.fullUF-SUZUKA_PIT.entryUF));
    if(uf<=SUZUKA_PIT.exitBeginUF)return full;
    if(uf<SUZUKA_PIT.exitEndUF)return full+(merge-full)*smooth((uf-SUZUKA_PIT.exitBeginUF)/(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.exitBeginUF));
    return merge;
  }
  function outerExtraUF(uf){
    if(uf<=SUZUKA_PIT.entryUF||uf>=SUZUKA_PIT.exitEndUF)return 0;
    if(uf<SUZUKA_PIT.fullUF)return OUTER_EXTENSION*smooth((uf-SUZUKA_PIT.entryUF)/(SUZUKA_PIT.fullUF-SUZUKA_PIT.entryUF));
    if(uf<=SUZUKA_PIT.exitBeginUF)return OUTER_EXTENSION;
    return OUTER_EXTENSION*(1-smooth((uf-SUZUKA_PIT.exitBeginUF)/(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.exitBeginUF)));
  }
  function pointUF(uf){return W.sample(wrap(uf)*total,offsetUF(uf)).p;}
  function poseUF(uf){
    const eps=1.4/total,p=pointUF(uf),a=pointUF(uf-eps),b=pointUF(uf+eps),t=b.sub(a).setY(0).normalize(),side=new THREE.Vector3(-t.z,0,t.x).normalize();
    return{p,t,side,rotationY:Math.atan2(t.x,t.z),uf,offset:offsetUF(uf)};
  }
  function lanePoseUF(uf,lateral=0){
    const q=poseUF(uf),p=q.p.clone().addScaledVector(q.side,lateral);
    return{...q,p,lateral,offset:q.offset+lateral};
  }
  function entryShift(uf,team){
    const toBox=(boxUF(team)-uf)*total;
    if(toBox>=PIT_APPROACH_METERS)return 0;
    if(toBox<=0)return WORK_LANE_SHIFT;
    return WORK_LANE_SHIFT*smooth(1-toBox/PIT_APPROACH_METERS);
  }
  function exitShift(uf,team){
    const after=(uf-boxUF(team))*total;
    if(after<=0)return WORK_LANE_SHIFT;
    if(after>=PIT_EXIT_BLEND_METERS)return 0;
    return WORK_LANE_SHIFT*(1-smooth(after/PIT_EXIT_BLEND_METERS));
  }

  W.pitUnwrappedFraction=unwrap;
  W.pitOffsetAtS=s=>offsetUF(unwrap(s));
  W.pitWorkingOffsetAtS=s=>offsetUF(unwrap(s))+WORK_LANE_SHIFT;
  W.inPitWindow=s=>{const f=unwrap(s);return f>=SUZUKA_PIT.entryUF&&f<=SUZUKA_PIT.exitEndUF;};
  W.inPitSpeedZone=s=>{const f=unwrap(s);return f>=SUZUKA_PIT.fullUF-.002&&f<=SUZUKA_PIT.exitBeginUF+.002;};
  W.pitFastPose=s=>{const uf=unwrap(s),q=lanePoseUF(uf,0);return{...q,s:wrap(uf)*total};};
  W.pitWorkingPose=s=>{const uf=unwrap(s),q=lanePoseUF(uf,WORK_LANE_SHIFT);return{...q,s:wrap(uf)*total};};
  W.pitPose=(s,team=0,state='ENTRY')=>{
    const uf=state==='STOP'?boxUF(team):unwrap(s);
    const lateral=state==='STOP'?WORK_LANE_SHIFT:state==='EXIT'?exitShift(uf,team):entryShift(uf,team);
    const q=lanePoseUF(uf,lateral);
    return{...q,s:wrap(uf)*total,laneRole:state==='STOP'?'WORKING':lateral>.35?'TRANSITION':'FAST'};
  };

  // Re-seat the detailed per-team crews after the new STOP pose exists.
  // Each child is independent, so different teams can service cars concurrently.
  const oldAnim=W.scene.getObjectByName?.('PIT_ANIMATION_V12');
  if(oldAnim){
    for(let team=0;team<Math.min(10,oldAnim.children.length);team++){
      const q=W.pitPose(W.pitBoxS(team),team,'STOP'),g=oldAnim.children[team];
      g.position.copy(q.p);g.rotation.y=q.rotationY;
    }
  }

  const root=new THREE.Group();root.name='SUZUKA_PIT_LANE_RUNTIME';W.scene.add(root);
  const asphalt=new THREE.MeshStandardMaterial({color:0x303438,roughness:.91,side:THREE.DoubleSide});
  const apron=new THREE.MeshStandardMaterial({color:0x65696b,roughness:.94,side:THREE.DoubleSide});
  const white=new THREE.MeshStandardMaterial({color:0xf3f1e8,roughness:.76,side:THREE.DoubleSide});
  const blue=new THREE.MeshStandardMaterial({color:0x1683cc,roughness:.72,side:THREE.DoubleSide});
  const concrete=new THREE.MeshStandardMaterial({color:0xd9dbd8,roughness:.86});
  const dark=new THREE.MeshStandardMaterial({color:0x171b1e,roughness:.72,metalness:.12});
  const teamColors=[0xe3312d,0x287de1,0xf2c52f,0xf3f3f3,0x20bd7b,0x9362df,0xed7b27,0x22aab8,0xe04a90,0xaeb6c1];
  const N=320,ufs=new Float32Array(N),pts=new Array(N),sides=new Array(N),roadEdge=(W.roadWidth||14.4)*.5+.04;
  for(let i=0;i<N;i++){const uf=SUZUKA_PIT.entryUF+(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.entryUF)*i/(N-1);ufs[i]=uf;pts[i]=pointUF(uf);}
  for(let i=0;i<N;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(N-1,i+1)],t=b.clone().sub(a).setY(0).normalize();sides[i]=new THREE.Vector3(-t.z,0,t.x).normalize();}

  function clippedRibbon(extraHalf,material,y=.07){
    const pos=[],ind=[];
    for(let i=0;i<N;i++){
      const uf=ufs[i],base=W.sample(wrap(uf)*total),d=offsetUF(uf),hw=widthUF(uf)+extraHalf,outerExtra=outerExtraUF(uf);
      const inner=Math.max(roadEdge,d-hw),outer=Math.max(roadEdge,d+hw+outerExtra),l=base.p.clone().addScaledVector(base.side,inner),r=base.p.clone().addScaledVector(base.side,outer);
      l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);
    }
    for(let i=0;i<N-1;i++){const a=i*2,b=a+1,c=(i+1)*2,d=c+1;ind.push(a,b,c,b,d,c);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.receiveShadow=true;root.add(m);return m;
  }
  function lineRibbon(offsetFn,material,y=.108,half=.075,fullOnly=false){
    const pos=[],ind=[];let previous=-1;
    for(let i=0;i<N;i++){
      const uf=ufs[i];if(fullOnly&&(uf<SUZUKA_PIT.fullUF||uf>SUZUKA_PIT.exitBeginUF)){previous=-1;continue;}
      const q=W.sample(wrap(uf)*total),off=Math.max(roadEdge+.015,offsetFn(uf)),l=q.p.clone().addScaledVector(q.side,off-half),r=q.p.clone().addScaledVector(q.side,off+half);l.y+=y;r.y+=y;
      const base=pos.length/3;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);
      if(previous>=0){const a=previous,b=a+1,c=base,d=c+1;ind.push(a,b,c,b,d,c);}
      previous=base;
    }
    if(!pos.length)return null;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.receiveShadow=true;root.add(m);return m;
  }
  clippedRibbon(1.15,apron,.047);
  clippedRibbon(0,asphalt,.070);
  lineRibbon(uf=>offsetUF(uf)-widthUF(uf)+.18,white);
  lineRibbon(uf=>offsetUF(uf)+widthUF(uf)+outerExtraUF(uf)-.18,white);
  // Divider between the pass-through fast lane and the garage-side working lane.
  lineRibbon(uf=>offsetUF(uf)+LANE_DIVIDER_SHIFT,blue,.112,.095,true);

  function add(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0){
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.receiveShadow=true;parent.add(m);return m;
  }
  function signTexture(text,bg='#20262b'){
    const c=document.createElement('canvas');c.width=512;c.height=112;const g=c.getContext('2d');
    g.fillStyle=bg;g.fillRect(0,0,c.width,c.height);g.fillStyle='#fff';
    g.font='900 48px -apple-system,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(text,256,58);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
  }

  // One visible garage entrance per team, longitudinally tied to the same
  // boxUF(team) used by vehicle stopping logic. This eliminates visual drift
  // between a team's door and its actual stopping point.
  const alignedEntrances=new THREE.Group();alignedEntrances.name='PIT_ALIGNED_ENTRANCES_RUNTIME';root.add(alignedEntrances);
  const garageFrontLocal=-BUILDING_LAYOUT.garageCenterOffset+BUILDING_LAYOUT.garageDepth*.5+.022;
  for(let team=0;team<10;team++){
    const uf=boxUF(team),fast=lanePoseUF(uf,0),work=lanePoseUF(uf,WORK_LANE_SHIFT);
    const entrance=new THREE.Group();entrance.position.copy(fast.p);entrance.rotation.y=fast.rotationY;alignedEntrances.add(entrance);
    const color=teamColors[team],tm=new THREE.MeshStandardMaterial({color,roughness:.58});
    const doorMat=new THREE.MeshStandardMaterial({color:0x11171b,roughness:.76});
    add(entrance,new THREE.PlaneGeometry(7.0,2.72),doorMat,garageFrontLocal,1.58,0,0,Math.PI/2,0);
    add(entrance,new THREE.BoxGeometry(.28,.72,7.15),tm,garageFrontLocal-.03,3.37,0);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(5.8,.62),new THREE.MeshBasicMaterial({map:signTexture(`PIT ${String(team+1).padStart(2,'0')}`,`#${color.toString(16).padStart(6,'0')}`),side:THREE.DoubleSide}));
    sign.rotation.y=-Math.PI/2;sign.position.set(garageFrontLocal+.16,3.38,0);entrance.add(sign);

    const box=new THREE.Group();box.position.copy(work.p);box.rotation.y=work.rotationY;root.add(box);
    add(box,new THREE.BoxGeometry(3.15,.026,7.1),concrete,0,.10,0);
    add(box,new THREE.BoxGeometry(2.86,.028,6.78),asphalt,0,.116,0);
    add(box,new THREE.BoxGeometry(.09,.032,6.18),tm,0,.134,0);
  }

  function auditRuntimePit(){
    const colliders=W.trackBarriers?.colliders||[],test=(a,b)=>{let hits=0,min=Infinity;for(let n=0;n<=36;n++){const uf=a+(b-a)*n/36,p=poseUF(uf).p;for(const c of colliders){const d=Math.hypot(p.x-c.p.x,p.z-c.p.z);min=Math.min(min,d);if(d<3.0)hits++;}}return{hits,minClearance:Number.isFinite(min)?min:null};};
    const raceHalf=(W.roadWidth||14.4)*.5,centerInside=Math.max(0,raceHalf-SUZUKA_PIT.mergeTrackOffset),fullWidth=SUZUKA_PIT.laneHalfWidth*2+OUTER_EXTENSION;
    return{
      entry:test(SUZUKA_PIT.entryUF,SUZUKA_PIT.fullUF),
      exit:test(SUZUKA_PIT.exitBeginUF,SUZUKA_PIT.exitEndUF),
      mergeTrackOffset:SUZUKA_PIT.mergeTrackOffset,
      mergeHalfWidth:SUZUKA_PIT.mergeHalfWidth,
      mainTrackEdgeOverlapAtMerge:0,
      mergeCenterInsideMainTrack:centerInside,
      surfaceInnerClamp:roadEdge,
      hiddenLegacyPieces:hidden.length,
      fastLaneCenterOffset:SUZUKA_PIT.laneOffset,
      workingLaneCenterOffset:SUZUKA_PIT.laneOffset+WORK_LANE_SHIFT,
      fastToWorkingCenterGap:WORK_LANE_SHIFT,
      fullPitAsphaltWidth:fullWidth,
      alignedGarageEntrances:10
    };
  }
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{};
    return{
      ...a,
      version:'runtime-2026.09.14-r3',
      pitGeometry:a.pitGeometry,
      runtimePit:auditRuntimePit(),
      notes:[
        ...(a.notes||[]),
        'pit lane split into a clear fast lane and garage-side working lane',
        'all ten pit-stop centres share the exact longitudinal datum of their garage entrances',
        'garage-side pavement widened without moving the clipped track-side merge edge'
      ]
    };
  };
  W.circuitAudit=W.auditCircuit();
  W.runtimePit={
    root,offsetUF,widthUF,outerExtraUF,poseUF,lanePoseUF,roadEdge,
    workLaneShift:WORK_LANE_SHIFT,approachMeters:PIT_APPROACH_METERS,
    exitBlendMeters:PIT_EXIT_BLEND_METERS,alignedEntrances
  };
  return W;
}
