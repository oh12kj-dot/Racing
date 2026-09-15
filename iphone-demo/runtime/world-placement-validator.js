import {buildWorld as buildSceneWorld} from './world-scene-hygiene.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildSceneWorld(THREE,TRACK,settings,circuitName);
  if(String(circuitName||'').toUpperCase()!=='SUZUKA')return W;

  const total=Math.max(1,Number(W.total)||1),scene=W.scene,trackPts=[];
  for(let i=0;i<720;i++){const p=W.sample(total*i/720).p;trackPts.push(new THREE.Vector3(p.x,p.y,p.z));}
  const allowed=/BRIDGE|START_LIGHT|START_SIGNAL|FLAG_TOWER|LEADER_TOWER|PIT|TUNNEL/i;
  const rows=[];let suppressed=0,checked=0;

  function intersectsTrack(box,clearance=1.5){
    if(!box||box.isEmpty())return false;
    for(const p of trackPts){
      if(p.x>=box.min.x-clearance&&p.x<=box.max.x+clearance&&p.z>=box.min.z-clearance&&p.z<=box.max.z+clearance)return true;
    }
    return false;
  }
  function inspectObject(o,source='scene'){
    if(!o?.isGroup||!o.visible)return;
    const name=String(o.name||'');if(!name)return;
    const box=new THREE.Box3().setFromObject(o);if(box.isEmpty())return;
    const center=new THREE.Vector3();box.getCenter(center);checked++;
    const bad=!allowed.test(name)&&intersectsTrack(box,2.2);
    if(bad){o.visible=false;o.userData.clearanceSuppressed='track-corridor';suppressed++;}
    rows.push({name,source,visible:o.visible,bad,position:{x:o.position.x,y:o.position.y,z:o.position.z},rotationY:o.rotation.y,footprint:{minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z}});
  }

  for(const o of W.suzukaFullScene?.root?.children||[])inspectObject(o,'full-scene');
  for(const row of W.suzukaFacilities?.facilities||[])inspectObject(row?.object,'facility');

  // Stable fixed broadcast-camera registry. These are tied to named circuit
  // sectors, not generated ad-hoc around whichever car currently has focus.
  W.tvCameraAnchors=[
    {name:'T1/T2',fraction:.035,side:-1,lateral:48,height:14,fov:42},
    {name:'S CURVES',fraction:.115,side:1,lateral:42,height:12,fov:46},
    {name:'DUNLOP',fraction:.215,side:1,lateral:46,height:13,fov:44},
    {name:'DEGNER',fraction:.315,side:-1,lateral:42,height:11,fov:45},
    {name:'HAIRPIN',fraction:.425,side:1,lateral:38,height:10,fov:43},
    {name:'SPOON',fraction:.615,side:-1,lateral:48,height:12,fov:46},
    {name:'130R',fraction:.845,side:-1,lateral:44,height:13,fov:44},
    {name:'CHICANE',fraction:.925,side:1,lateral:40,height:12,fov:42},
    {name:'MAIN STRAIGHT',fraction:.992,side:-1,lateral:55,height:15,fov:40}
  ].map(x=>{const q=W.sample(total*x.fraction),p=q.p.clone().addScaledVector(q.side,x.side*x.lateral);p.y+=(x.height||12);return{...x,s:total*x.fraction,position:p};});

  const absoluteLandmarks={};
  for(const r of rows){
    if(!/FERRIS|HOTEL|GRANDSTAND|CONTROL_TOWER|POND|MAIN_GATE|GP_SQUARE|CENTER|PADDOCK/i.test(r.name))continue;
    absoluteLandmarks[r.name]={...r.position,rotationY:r.rotationY,source:r.source};
  }
  W.validateSceneryClearance=()=>({owner:'runtime-placement-validator-v1',checked,suppressed,valid:suppressed===0,rows:rows.map(x=>({...x}))});
  W.suzukaPlacement={owner:'runtime-absolute-layout-registry-v1',absoluteLandmarks,tvCameras:W.tvCameraAnchors.map(({position,...x})=>({...x,x:position.x,y:position.y,z:position.z})),clearance:W.validateSceneryClearance()};

  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{const a=priorAudit?priorAudit():{};return{...a,version:'runtime-2026.09.15-r16',placement:{owner:W.suzukaPlacement.owner,landmarkCount:Object.keys(absoluteLandmarks).length,tvCameraCount:W.tvCameraAnchors.length,clearance:{checked,suppressed,valid:suppressed===0}},notes:[...(a.notes||[]),'Major Suzuka landmarks are registered in absolute world coordinates; track-corridor validation suppresses accidental scenery intrusions and fixed TV cameras are sector-named.']};};
  W.circuitAudit=W.auditCircuit();scene.updateMatrixWorld(true);return W;
}
