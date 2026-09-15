import {buildWorld as buildPitApronWorld} from './world-pit-apron.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildPitApronWorld(THREE,TRACK,settings,circuitName),pit=W.runtimePit,garages=pit?.serviceBuilding?.children||[];
  if(!pit?.root||garages.length<10)return W;

  // The rebuilt bays follow the curved pit lane independently. A rectangular
  // filler still leaves a triangular slit where neighbouring bay front planes
  // meet at slightly different angles. Bridge the exact world-space bay edges
  // with a closed wedge (floor/front/back/roof) so no terrain is visible.
  const seams=new THREE.Group();seams.name='PIT_SERVICE_BUILDING_SEAMS_RUNTIME';pit.root.add(seams);
  const concrete=new THREE.MeshStandardMaterial({color:0xd7d9d7,roughness:.84,metalness:.02,side:THREE.DoubleSide});
  const roofMat=new THREE.MeshStandardMaterial({color:0xe7e9e6,roughness:.76,metalness:.08,side:THREE.DoubleSide});
  const floorMat=new THREE.MeshStandardMaterial({color:0x3f4447,roughness:.92,metalness:.015,side:THREE.DoubleSide});
  const GARAGE_DEPTH=7.2,GARAGE_HALF_WIDTH=8.75,BUILDING_HEIGHT=6.64;
  const rows=[];

  function localWorld(garage,x,z){
    garage.updateWorldMatrix?.(true,false);
    return garage.localToWorld(new THREE.Vector3(x,0,z));
  }
  function quad(parent,name,a,b,c,d,mat){
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute([
      a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,d.x,d.y,d.z
    ],3));
    geo.setIndex([0,1,2,1,3,2]);geo.computeVertexNormals();geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,mat);mesh.name=name;mesh.receiveShadow=true;mesh.userData.pitBuildingSeam=true;parent.add(mesh);return mesh;
  }
  const lifted=(p,dy)=>p.clone().add(new THREE.Vector3(0,dy,0));

  W.scene.updateMatrixWorld(true);
  for(let i=0;i<garages.length-1;i++){
    const a=garages[i],b=garages[i+1];
    const af=localWorld(a,0,GARAGE_HALF_WIDTH),bf=localWorld(b,0,-GARAGE_HALF_WIDTH);
    const ab=localWorld(a,-GARAGE_DEPTH,GARAGE_HALF_WIDTH),bb=localWorld(b,-GARAGE_DEPTH,-GARAGE_HALF_WIDTH);
    const frontGap=af.distanceTo(bf),backGap=ab.distanceTo(bb),g=new THREE.Group();
    g.name=`PIT_BUILDING_SEAM_${String(i+1).padStart(2,'0')}`;seams.add(g);

    // Slightly raise the seam floor to ensure the legacy grass/terrain can never
    // win depth testing at the connection between two adjacent garage modules.
    quad(g,'floor',lifted(af,.10),lifted(bf,.10),lifted(ab,.10),lifted(bb,.10),floorMat);
    quad(g,'front',lifted(af,.02),lifted(bf,.02),lifted(af,BUILDING_HEIGHT),lifted(bf,BUILDING_HEIGHT),concrete);
    quad(g,'back',lifted(ab,.02),lifted(bb,.02),lifted(ab,BUILDING_HEIGHT),lifted(bb,BUILDING_HEIGHT),concrete);
    quad(g,'roof',lifted(af,BUILDING_HEIGHT),lifted(bf,BUILDING_HEIGHT),lifted(ab,BUILDING_HEIGHT),lifted(bb,BUILDING_HEIGHT),roofMat);

    g.userData={pitBuildingSeam:true,index:i,frontGap,backGap,closedWedge:true};
    rows.push({index:i,frontGap,backGap,closedWedge:true});
  }
  W.scene.updateMatrixWorld(true);

  pit.serviceBuildingSeams=seams;
  pit.serviceBuildingSeamAudit={owner:'runtime-pit-building-seams-v2',count:rows.length,closedCount:rows.filter(r=>r.closedWedge).length,rows};
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{},runtimePit={...(a.runtimePit||{})};
    return{
      ...a,
      version:'runtime-2026.09.15-r11',
      runtimePit:{...runtimePit,persistentPitBuildingSeams:rows.length,persistentPitBuildingClosedSeams:rows.filter(r=>r.closedWedge).length,persistentPitBuildingSeamOwner:'runtime-pit-building-seams-v2'},
      notes:[...(a.notes||[]),'adjacent curved pit-building bays are joined by closed world-space wedge geometry so no grass slit remains between modules']
    };
  };
  W.circuitAudit=W.auditCircuit();
  return W;
}
