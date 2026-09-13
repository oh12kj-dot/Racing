import {buildWorld as buildAuditedWorld} from '../v42-world.js';
import {SUZUKA_PIT} from './config.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildAuditedWorld(THREE,TRACK,settings,circuitName),total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=f=>((f%1)+1)%1,smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  const unwrap=s=>{let f=wrap(s/total);if(f<SUZUKA_PIT.entryUF)f+=1;return f;};
  const boxUF=team=>{let f=W.pitBoxFraction?.(team)??SUZUKA_PIT.box0UF;if(f<SUZUKA_PIT.entryUF)f+=1;return f;};

  // v42 used the old pit path that started at track centre, so its full-width
  // surface visually painted across much of the racing surface. Keep the v42
  // architecture, but replace only those three pit-surface ribbons.
  const oldRoot=W.scene.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');
  const hidden=[];
  oldRoot?.traverse?.(o=>{
    const pos=o?.geometry?.getAttribute?.('position');
    if(o?.isMesh&&o.geometry?.type==='BufferGeometry'&&pos?.count===600){o.visible=false;hidden.push(o.name||'pit-ribbon');}
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
  function pointUF(uf){return W.sample(wrap(uf)*total,offsetUF(uf)).p;}
  function poseUF(uf){
    const eps=1.4/total,p=pointUF(uf),a=pointUF(uf-eps),b=pointUF(uf+eps),t=b.sub(a).setY(0).normalize(),side=new THREE.Vector3(-t.z,0,t.x).normalize();
    return{p,t,side,rotationY:Math.atan2(t.x,t.z),uf,offset:offsetUF(uf)};
  }
  W.pitUnwrappedFraction=unwrap;
  W.pitOffsetAtS=s=>offsetUF(unwrap(s));
  W.inPitWindow=s=>{const f=unwrap(s);return f>=SUZUKA_PIT.entryUF&&f<=SUZUKA_PIT.exitEndUF;};
  W.inPitSpeedZone=s=>{const f=unwrap(s);return f>=SUZUKA_PIT.fullUF-.002&&f<=SUZUKA_PIT.exitBeginUF+.002;};
  W.pitPose=(s,team=0,state='ENTRY')=>{const uf=state==='STOP'?boxUF(team):unwrap(s),q=poseUF(uf);return{...q,s:wrap(uf)*total};};

  const root=new THREE.Group();root.name='SUZUKA_PIT_LANE_RUNTIME';W.scene.add(root);
  const asphalt=new THREE.MeshStandardMaterial({color:0x303438,roughness:.91,side:THREE.DoubleSide}),apron=new THREE.MeshStandardMaterial({color:0x65696b,roughness:.94,side:THREE.DoubleSide}),white=new THREE.MeshStandardMaterial({color:0xf3f1e8,roughness:.76,side:THREE.DoubleSide}),blue=new THREE.MeshStandardMaterial({color:0x1683cc,roughness:.72,side:THREE.DoubleSide});
  const N=320,ufs=new Float32Array(N),pts=new Array(N),sides=new Array(N);
  for(let i=0;i<N;i++){const uf=SUZUKA_PIT.entryUF+(SUZUKA_PIT.exitEndUF-SUZUKA_PIT.entryUF)*i/(N-1);ufs[i]=uf;pts[i]=pointUF(uf);}
  for(let i=0;i<N;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(N-1,i+1)],t=b.clone().sub(a).setY(0).normalize();sides[i]=new THREE.Vector3(-t.z,0,t.x).normalize();}
  function ribbon(widthFn,material,y=.07,lateralFn=null){
    const pos=[],ind=[];
    for(let i=0;i<N;i++){const uf=ufs[i],side=sides[i],lat=lateralFn?lateralFn(uf):0,c=pts[i].clone().addScaledVector(side,lat),hw=widthFn(uf),l=c.clone().addScaledVector(side,-hw),r=c.clone().addScaledVector(side,hw);l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);}
    for(let i=0;i<N-1;i++){const a=i*2,b=a+1,c=(i+1)*2,d=c+1;ind.push(a,b,c,b,d,c);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.receiveShadow=true;root.add(m);return m;
  }
  ribbon(uf=>widthUF(uf)+1.15,apron,.047);
  ribbon(widthUF,asphalt,.070);
  ribbon(()=>.075,white,.108,uf=>-widthUF(uf)+.18);
  ribbon(()=>.075,white,.108,uf=> widthUF(uf)-.18);
  // Blue working-lane cue is shown only after the pit road has fully separated.
  const bluePos=[],blueInd=[];
  for(let i=0;i<N;i++){const uf=ufs[i];if(uf<SUZUKA_PIT.fullUF||uf>SUZUKA_PIT.exitBeginUF)continue;const side=sides[i],c=pts[i].clone().addScaledVector(side,-SUZUKA_PIT.laneHalfWidth-.48),l=c.clone().addScaledVector(side,-.34),r=c.clone().addScaledVector(side,.34);l.y+=.09;r.y+=.09;const base=bluePos.length/3;bluePos.push(l.x,l.y,l.z,r.x,r.y,r.z);if(base>=2){const a=base-2,b=a+1,cx=base,d=cx+1;blueInd.push(a,b,cx,b,d,cx);}}
  if(bluePos.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(bluePos,3));g.setIndex(blueInd);const m=new THREE.Mesh(g,blue);m.receiveShadow=true;root.add(m);}

  function auditRuntimePit(){
    const colliders=W.trackBarriers?.colliders||[],test=(a,b)=>{let hits=0,min=Infinity;for(let n=0;n<=36;n++){const uf=a+(b-a)*n/36,p=poseUF(uf).p;for(const c of colliders){const d=Math.hypot(p.x-c.p.x,p.z-c.p.z);min=Math.min(min,d);if(d<3.0)hits++;}}return{hits,minClearance:Number.isFinite(min)?min:null};};
    const raceHalf=(W.roadWidth||14.4)*.5,maxMergeOverlap=Math.max(0,raceHalf-(SUZUKA_PIT.mergeTrackOffset-SUZUKA_PIT.mergeHalfWidth));
    return{entry:test(SUZUKA_PIT.entryUF,SUZUKA_PIT.fullUF),exit:test(SUZUKA_PIT.exitBeginUF,SUZUKA_PIT.exitEndUF),mergeTrackOffset:SUZUKA_PIT.mergeTrackOffset,mergeHalfWidth:SUZUKA_PIT.mergeHalfWidth,mainTrackEdgeOverlapAtMerge:maxMergeOverlap,hiddenLegacyRibbons:hidden.length};
  }
  const priorAudit=W.auditCircuit?.bind(W);W.auditCircuit=()=>{const a=priorAudit?priorAudit():{};return{...a,version:'runtime-2026.09.14',pitGeometry:a.pitGeometry,runtimePit:auditRuntimePit(),notes:[...(a.notes||[]),'pit merge surface narrowed to the outer track edge; pit lane proper remains separated behind the pit wall']};};
  W.circuitAudit=W.auditCircuit();W.runtimePit={root,offsetUF,widthUF,poseUF};
  return W;
}
