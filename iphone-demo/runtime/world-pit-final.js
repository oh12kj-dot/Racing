import {buildWorld as buildPitApronWorld} from './world-pit-apron.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildPitApronWorld(THREE,TRACK,settings,circuitName),pit=W.runtimePit,garages=pit?.serviceBuilding?.children||[];
  if(!pit?.root||garages.length<10)return W;

  // The ten rebuilt modules intentionally follow each pit box independently.
  // Their previous 17.5 m bay width left a thin longitudinal grass slit between
  // neighbouring 18 m centres. Bridge those seams with permanent structural
  // dividers and floor strips so no terrain can be seen through the pit building.
  const seams=new THREE.Group();seams.name='PIT_SERVICE_BUILDING_SEAMS_RUNTIME';pit.root.add(seams);
  const concrete=new THREE.MeshStandardMaterial({color:0xd7d9d7,roughness:.84,metalness:.02});
  const roofMat=new THREE.MeshStandardMaterial({color:0xe7e9e6,roughness:.76,metalness:.08});
  const floorMat=new THREE.MeshStandardMaterial({color:0x3f4447,roughness:.92,metalness:.015});
  const GARAGE_DEPTH=7.2,OPENING_HEIGHT=3.35,UPPER_CENTER_Y=5.10,ROOF_Y=6.52;
  const rows=[];

  function add(parent,geo,mat,x,y,z){
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.receiveShadow=true;m.userData.pitBuildingSeam=true;parent.add(m);return m;
  }

  W.scene.updateMatrixWorld(true);
  for(let i=0;i<garages.length-1;i++){
    const a=garages[i],b=garages[i+1],pa=new THREE.Vector3(),pb=new THREE.Vector3();
    a.getWorldPosition(pa);b.getWorldPosition(pb);
    const tangent=pb.clone().sub(pa).setY(0),centreDistance=tangent.length();
    if(centreDistance<.01)continue;tangent.normalize();
    const mid=pa.clone().lerp(pb,.5),yaw=Math.atan2(tangent.x,tangent.z),g=new THREE.Group();
    g.name=`PIT_BUILDING_SEAM_${String(i+1).padStart(2,'0')}`;g.position.copy(mid);g.rotation.y=yaw;seams.add(g);
    // 0.9 m safely overlaps the former 0.5 m nominal gap without approaching
    // the 8 m usable garage openings.
    const seamWidth=.90;
    add(g,new THREE.BoxGeometry(GARAGE_DEPTH,.12,seamWidth),floorMat,-GARAGE_DEPTH*.5,.06,0);
    add(g,new THREE.BoxGeometry(GARAGE_DEPTH,OPENING_HEIGHT,seamWidth),concrete,-GARAGE_DEPTH*.5,OPENING_HEIGHT*.5,0);
    add(g,new THREE.BoxGeometry(GARAGE_DEPTH+.55,2.55,seamWidth),concrete,-GARAGE_DEPTH*.5-.22,UPPER_CENTER_Y,0);
    add(g,new THREE.BoxGeometry(GARAGE_DEPTH+.85,.24,seamWidth+.08),roofMat,-GARAGE_DEPTH*.5-.30,ROOF_Y,0);
    g.userData={pitBuildingSeam:true,index:i,centreDistance,seamWidth};
    rows.push({index:i,centreDistance,seamWidth});
  }
  W.scene.updateMatrixWorld(true);

  pit.serviceBuildingSeams=seams;
  pit.serviceBuildingSeamAudit={owner:'runtime-pit-building-seams-v1',count:rows.length,rows};
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{},runtimePit={...(a.runtimePit||{})};
    return{
      ...a,
      version:'runtime-2026.09.15-r10',
      runtimePit:{...runtimePit,persistentPitBuildingSeams:rows.length,persistentPitBuildingSeamOwner:'runtime-pit-building-seams-v1'},
      notes:[...(a.notes||[]),'adjacent permanent pit-building bays are bridged with structural/floor seam fillers so no grass slit remains']
    };
  };
  W.circuitAudit=W.auditCircuit();
  return W;
}
