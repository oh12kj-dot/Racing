import {buildWorld as buildSceneWorld} from './world-scene-hygiene.js';
import {resolveCircuitPitProfile,resolveRacingLaneProfile} from './config.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

function applyRacingLanePolicy(W,circuitName){
  const total=Math.max(1,Number(W.total)||1),profile=resolveRacingLaneProfile(circuitName),baseAt=typeof W.racingLineAt==='function'?W.racingLineAt.bind(W):()=>0,baseFor=typeof W.racingLineFor==='function'?W.racingLineFor.bind(W):null;
  W.trackHalfWidth=Math.max(3.8,(Number(W.roadWidth)||14.4)*.5);
  W.racingLaneBoundsAt=s=>{
    const k=Math.abs(Number(W.racingCurvatureAt?.(s)??W.curvatureAt?.(s))||0),corner=clamp(k*80,0,1),usable=Math.min(W.trackHalfWidth-.55,Math.max(profile.min,profile.base-profile.cornerNarrowing*corner));
    return{min:-usable,max:usable,usable,corner,circuit:String(circuitName||'SUZUKA').toUpperCase()};
  };
  W.racingLineAt=s=>{const b=W.racingLaneBoundsAt(s);return clamp(baseAt(s),b.min,b.max);};
  if(baseFor)W.racingLineFor=(s,mode)=>{const b=W.racingLaneBoundsAt(s);return clamp(baseFor(s,mode),b.min,b.max);};
  W.racingLineProfile={...(W.racingLineProfile||{}),lanePolicy:{owner:'runtime-variable-lane-bounds-v1',circuit:String(circuitName||'SUZUKA').toUpperCase(),profile:{...profile}}};
}

function applyCircuitPitProfile(THREE,W,circuitName){
  const id=String(circuitName||'SUZUKA').toUpperCase();if(id==='SUZUKA')return;
  const p=resolveCircuitPitProfile(id),total=Math.max(1,Number(W.total)||1),wrap=f=>((f%1)+1)%1,exitWrap=wrap(p.exitEndUF),workingShift=3.55;
  const unwrap=s=>{const f=wrap((Number(s)||0)/total);return f<=exitWrap?f+1:f;};
  const boxUF=team=>p.box0UF+clamp(Number(team)||0,0,9)*p.boxGapMeters/total;
  function offsetUF(uf){const merge=p.mergeTrackOffset;if(uf<=p.entryUF)return merge;if(uf<p.fullUF)return merge+(p.laneOffset-merge)*smooth((uf-p.entryUF)/(p.fullUF-p.entryUF));if(uf<=p.exitBeginUF)return p.laneOffset;if(uf<p.exitEndUF)return p.laneOffset+(merge-p.laneOffset)*smooth((uf-p.exitBeginUF)/(p.exitEndUF-p.exitBeginUF));return merge;}
  function pointUF(uf,extra=0){const q=W.sample(wrap(uf)*total),off=offsetUF(uf)+extra;return{p:q.p.clone().addScaledVector(q.side,off),t:q.t.clone(),side:q.side.clone(),rotationY:Math.atan2(q.t.x,q.t.z),uf,offset:off};}
  function entryShift(uf,team){const d=(boxUF(team)-uf)*total;if(d>=24)return 0;if(d<=0)return workingShift;return workingShift*smooth(1-d/24);}
  function exitShift(uf,team){const d=(uf-boxUF(team))*total;if(d<=0)return workingShift;if(d>=20)return 0;return workingShift*(1-smooth(d/20));}

  const old=W.runtimePit?.root;if(old)old.visible=false;
  const root=new THREE.Group();root.name=`${id}_PIT_RUNTIME`;root.userData={owner:'runtime-circuit-pit-profile-v1',circuit:id};W.scene.add(root);
  const asphalt=new THREE.MeshStandardMaterial({color:0x34383b,roughness:.92,side:THREE.DoubleSide}),apron=new THREE.MeshStandardMaterial({color:0x62676a,roughness:.96,side:THREE.DoubleSide}),white=new THREE.MeshStandardMaterial({color:0xeeeeea,roughness:.78,side:THREE.DoubleSide}),garageMat=new THREE.MeshStandardMaterial({color:0xb5b9ba,roughness:.88});
  function ribbon(extra,width,material,y=.065){const n=190,pos=[],ind=[];for(let i=0;i<n;i++){const uf=p.entryUF+(p.exitEndUF-p.entryUF)*i/(n-1),q=W.sample(wrap(uf)*total),center=offsetUF(uf)+extra,c=q.p.clone().addScaledVector(q.side,center),l=c.clone().addScaledVector(q.side,-width),r=c.clone().addScaledVector(q.side,width);l.y+=y;r.y+=y;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);}for(let i=0;i<n-1;i++){const a=i*2,b=a+1,c=a+2,d=a+3;ind.push(a,b,c,b,d,c);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.receiveShadow=true;root.add(m);return m;}
  ribbon(0,p.laneHalfWidth,asphalt);ribbon(workingShift,p.laneHalfWidth*.72,apron,.072);
  const garages=[];
  for(let team=0;team<10;team++){const uf=boxUF(team),q=pointUF(uf,workingShift),g=new THREE.Group();g.name=`${id}_GARAGE_${team+1}`;g.position.copy(q.p).addScaledVector(q.side,p.laneHalfWidth+4.1);g.rotation.y=q.rotationY;const box=new THREE.Mesh(new THREE.BoxGeometry(7.2,3.8,Math.max(5.2,p.boxGapMeters*.76)),garageMat);box.position.y=1.9;g.add(box);const mark=new THREE.Mesh(new THREE.BoxGeometry(2.8,.025,5.4),white);mark.position.copy(q.side).multiplyScalar(-(p.laneHalfWidth+1.65));mark.position.y=.13;g.add(mark);root.add(g);garages.push(g);}

  W.pitUnwrappedFraction=unwrap;W.pitEntryFraction=wrap(p.entryUF);W.pitExitFraction=wrap(p.exitEndUF);W.pitExitEndUF=p.exitEndUF;W.pitMergeTrackOffset=p.mergeTrackOffset;W.pitOffsetAtS=s=>offsetUF(unwrap(s));W.pitWorkingOffsetAtS=s=>offsetUF(unwrap(s))+workingShift;
  W.inPitWindow=s=>{const uf=unwrap(s);return uf>=p.entryUF&&uf<=p.exitEndUF;};W.inPitSpeedZone=s=>{const uf=unwrap(s);return uf>=p.fullUF-.002&&uf<=p.exitBeginUF+.002;};W.pitBoxFraction=team=>wrap(boxUF(team));W.pitBoxS=team=>wrap(boxUF(team))*total;W.pitDistanceToBox=(s,team)=>{const d=(boxUF(team)-unwrap(s))*total;return d;};
  W.pitPose=(s,team=0,state='ENTRY')=>{const uf=state==='STOP'?boxUF(team):unwrap(s),extra=state==='STOP'?workingShift:state==='EXIT'?exitShift(uf,team):entryShift(uf,team),q=pointUF(uf,extra);return{...q,s:wrap(uf)*total,laneRole:state==='STOP'?'WORKING':extra>.35?'TRANSITION':'FAST'};};
  W.pitWorkingPose=s=>{const uf=unwrap(s),q=pointUF(uf,workingShift);return{...q,s:wrap(uf)*total};};W.pitFastPose=s=>{const uf=unwrap(s),q=pointUF(uf,0);return{...q,s:wrap(uf)*total};};
  W.realisticPitLayout={owner:'runtime-pit-realism-v2',circuit:id,...p,totalMeters:(p.exitEndUF-p.entryUF)*total,speedZoneMeters:(p.exitBeginUF-p.fullUF)*total,mergeAfterLineMeters:Math.max(0,(p.exitEndUF-1)*total),workingLaneShift:workingShift,profileDriven:true};
  W.pitCoordinateAudit={owner:'runtime-pit-coordinate-v3',circuit:id,entryUF:p.entryUF,exitEndUF:p.exitEndUF,wrapCutoff:exitWrap,continuousAcrossEntry:true};
  W.runtimePit={...(W.runtimePit||{}),root,garageOpenings:{children:garages},profile:W.realisticPitLayout};
}

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildSceneWorld(THREE,TRACK,settings,circuitName);applyRacingLanePolicy(W,circuitName);applyCircuitPitProfile(THREE,W,circuitName);
  if(String(circuitName||'').toUpperCase()!=='SUZUKA'){const priorAudit=W.auditCircuit?.bind(W);W.auditCircuit=()=>{const a=priorAudit?priorAudit():{};return{...a,version:'runtime-2026.09.19-r18',circuitProfile:{pit:W.realisticPitLayout,lane:W.racingLineProfile?.lanePolicy},notes:[...(a.notes||[]),'Circuit-specific pit geometry/kinematics and variable racing-lane bounds are active.']};};W.circuitAudit=W.auditCircuit();return W;}

  const total=Math.max(1,Number(W.total)||1),scene=W.scene,trackPts=[],pitPts=[];
  const trackHalf=Math.max(6.8,Number(W.trackHalfWidth)||7.2),trackLanes=[-trackHalf+.45,0,trackHalf-.45];
  for(let i=0;i<900;i++){
    const s=total*i/900;
    for(const lane of trackLanes){const p=W.sample(s,lane).p;trackPts.push(new THREE.Vector3(p.x,p.y,p.z));}
  }
  const layout=W.realisticPitLayout||{},entryUF=Number(layout.entryUF??W.pitCoordinateAudit?.entryUF),exitEndUF=Number(layout.exitEndUF??W.pitCoordinateAudit?.exitEndUF),poseUF=W.runtimePit?.poseUF;
  if(Number.isFinite(entryUF)&&Number.isFinite(exitEndUF)&&exitEndUF>entryUF){
    const n=Math.max(60,Math.min(260,Math.ceil((exitEndUF-entryUF)*total/3.5))),half=Math.max(2.2,Number(layout.laneHalfWidth)||3.2);
    for(let i=0;i<=n;i++){
      const uf=entryUF+(exitEndUF-entryUF)*i/n,s=((uf%1)+1)%1*total,q=typeof poseUF==='function'?poseUF(uf):(typeof W.pitFastPose==='function'?W.pitFastPose(s):W.pitPose?.(s,0,'ENTRY'));
      if(!q?.p)continue;const side=q.side||W.sample(s).side;
      for(const off of[-half+.25,0,half-.25]){const p=q.p.clone().addScaledVector(side,off);pitPts.push(new THREE.Vector3(p.x,p.y,p.z));}
    }
  }

  const overheadAllowed=/BRIDGE|START_LIGHT|START_SIGNAL|FLAG_TOWER|LEADER_TOWER|TUNNEL/i;
  const rows=[];let suppressed=0,suppressedTrack=0,suppressedPit=0,checked=0;
  function boxHitsPoints(box,points,clearance=.8,headroom=2.65){
    if(!box||box.isEmpty())return false;
    for(const p of points){
      if(p.x<box.min.x-clearance||p.x>box.max.x+clearance||p.z<box.min.z-clearance||p.z>box.max.z+clearance)continue;
      if(box.max.y<p.y-.45||box.min.y>p.y+headroom)continue;
      return true;
    }
    return false;
  }
  function objectHitsPoints(o,points,clearance){
    if(!o||!points.length)return false;let hit=false;
    o.traverse?.(x=>{
      if(hit||!x?.isMesh||x.visible===false||!x.geometry)return;
      const b=new THREE.Box3().setFromObject(x);if(boxHitsPoints(b,points,clearance))hit=true;
    });
    return hit;
  }
  function inspectObject(o,source='scene'){
    if(!o||o.visible===false)return;const name=String(o.name||'');if(!name)return;
    checked++;const trackHit=objectHitsPoints(o,trackPts,.85),pitHit=objectHitsPoints(o,pitPts,.65),protectedSpan=overheadAllowed.test(name),bad=!protectedSpan&&(trackHit||pitHit);
    if(bad){o.visible=false;o.userData.clearanceSuppressed=trackHit&&pitHit?'track+pit-corridor':trackHit?'track-corridor':'pit-corridor';suppressed++;if(trackHit)suppressedTrack++;if(pitHit)suppressedPit++;}
    const box=new THREE.Box3().setFromObject(o),center=new THREE.Vector3();if(!box.isEmpty())box.getCenter(center);
    rows.push({name,source,visible:o.visible,bad,trackHit,pitHit,protectedSpan,position:{x:o.position?.x||0,y:o.position?.y||0,z:o.position?.z||0},rotationY:o.rotation?.y||0,footprint:box.isEmpty()?null:{minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z}});
  }
  for(const o of W.suzukaFullScene?.root?.children||[])inspectObject(o,'full-scene');
  for(const row of W.suzukaFacilities?.facilities||[])inspectObject(row?.object,'facility');
  const legacyHome=scene.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');
  for(const o of legacyHome?.children||[])inspectObject(o,'legacy-home');
  scene.updateMatrixWorld(true);

  let remainingTrack=0,remainingPit=0;
  for(const r of rows){if(r.visible===false||r.protectedSpan)continue;if(r.trackHit)remainingTrack++;if(r.pitHit)remainingPit++;}

  W.tvCameraAnchors=[{name:'T1/T2',fraction:.035,side:-1,lateral:48,height:14,fov:42},{name:'S CURVES',fraction:.115,side:1,lateral:42,height:12,fov:46},{name:'DUNLOP',fraction:.215,side:1,lateral:46,height:13,fov:44},{name:'DEGNER',fraction:.315,side:-1,lateral:42,height:11,fov:45},{name:'HAIRPIN',fraction:.425,side:1,lateral:38,height:10,fov:43},{name:'SPOON',fraction:.615,side:-1,lateral:48,height:12,fov:46},{name:'130R',fraction:.845,side:-1,lateral:44,height:13,fov:44},{name:'CHICANE',fraction:.925,side:1,lateral:40,height:12,fov:42},{name:'MAIN STRAIGHT',fraction:.992,side:-1,lateral:55,height:15,fov:40}].map(x=>{const q=W.sample(total*x.fraction),p=q.p.clone().addScaledVector(q.side,x.side*x.lateral);p.y+=(x.height||12);return{...x,s:total*x.fraction,position:p};});
  const absoluteLandmarks={};for(const r of rows){if(!/FERRIS|HOTEL|GRANDSTAND|CONTROL_TOWER|POND|MAIN_GATE|GP_SQUARE|CENTER|PADDOCK/i.test(r.name))continue;absoluteLandmarks[r.name]={...r.position,rotationY:r.rotationY,source:r.source};}
  W.validateSceneryClearance=()=>({owner:'runtime-placement-validator-v2',checked,suppressed,suppressedTrack,suppressedPit,remainingTrack,remainingPit,valid:remainingTrack===0&&remainingPit===0,trackSamples:trackPts.length,pitSamples:pitPts.length,rows:rows.map(x=>({...x}))});
  W.suzukaPlacement={owner:'runtime-absolute-layout-registry-v2',absoluteLandmarks,tvCameras:W.tvCameraAnchors.map(({position,...x})=>({...x,x:position.x,y:position.y,z:position.z})),clearance:W.validateSceneryClearance()};
  const priorAudit=W.auditCircuit?.bind(W);W.auditCircuit=()=>{const a=priorAudit?priorAudit():{};return{...a,version:'runtime-2026.09.19-r18',placement:{owner:W.suzukaPlacement.owner,landmarkCount:Object.keys(absoluteLandmarks).length,tvCameraCount:W.tvCameraAnchors.length,clearance:{checked,suppressed,suppressedTrack,suppressedPit,remainingTrack,remainingPit,valid:remainingTrack===0&&remainingPit===0}},circuitProfile:{pit:W.realisticPitLayout,lane:W.racingLineProfile?.lanePolicy},notes:[...(a.notes||[]),'Major Suzuka landmarks are registered in absolute world coordinates; mesh-level main-track and pit-lane corridor validation suppresses accidental scenery intrusions while preserving overhead bridge/tunnel structures.','Variable racing-lane bounds are active.']};};W.circuitAudit=W.auditCircuit();scene.updateMatrixWorld(true);return W;
}
