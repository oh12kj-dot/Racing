import {buildWorld as buildPitWorld} from './world-pit-final.js';

// Main-straight/paddock landmark layer based on Suzuka Circuit's published
// paddock map and grandstand/pit-building plan.  Geometry stays deliberately
// lightweight so the iPhone/WebKit target keeps the existing performance budget.
export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildPitWorld(THREE,TRACK,settings,circuitName);
  if(String(circuitName||'').toUpperCase()!=='SUZUKA')return W;

  const total=W.total,wrap=f=>((f%1)+1)%1,root=new THREE.Group();
  root.name='SUZUKA_FACILITIES_RUNTIME';root.userData={owner:'runtime-suzuka-facilities-v1',visualOnly:true};W.scene.add(root);

  const concrete=new THREE.MeshStandardMaterial({color:0xd9dcda,roughness:.82,metalness:.03});
  const concreteDark=new THREE.MeshStandardMaterial({color:0x9ea4a3,roughness:.88,metalness:.03});
  const roof=new THREE.MeshStandardMaterial({color:0xf1f2ef,roughness:.70,metalness:.08});
  const asphalt=new THREE.MeshStandardMaterial({color:0x4b5052,roughness:.94});
  const dark=new THREE.MeshStandardMaterial({color:0x171b1e,roughness:.72,metalness:.10});
  const glass=new THREE.MeshPhysicalMaterial({color:0x233f4d,roughness:.14,transparent:true,opacity:.72,metalness:.05,clearcoat:.55});
  const metal=new THREE.MeshStandardMaterial({color:0x81898d,roughness:.42,metalness:.68});
  const white=new THREE.MeshStandardMaterial({color:0xf3f3ef,roughness:.76});
  const red=new THREE.MeshStandardMaterial({color:0xd92f2f,roughness:.62});
  const green=new THREE.MeshStandardMaterial({color:0x365c3b,roughness:.88});
  const screenMat=new THREE.MeshStandardMaterial({color:0x0b1114,emissive:0x162631,emissiveIntensity:.34,roughness:.48});
  const facilityRows=[];

  function anchor(uf,offset,name){
    const q=W.sample(wrap(uf)*total,offset),g=new THREE.Group();g.name=name;g.position.copy(q.p);g.rotation.y=Math.atan2(q.t.x,q.t.z);root.add(g);return g;
  }
  function mesh(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,name=''){
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.receiveShadow=true;if(name)m.name=name;parent.add(m);return m;
  }
  function labelTexture(text,bg='#20262b',fg='#ffffff',w=640,h=128){
    const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,w,h);g.fillStyle=fg;g.font=`900 ${Math.round(h*.42)}px -apple-system,BlinkMacSystemFont,sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(text,w*.5,h*.53);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
  }
  function sign(parent,text,x,y,z,width=8,height=1.35,rotationY=Math.PI/2,bg='#20262b'){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:labelTexture(text,bg),side:THREE.DoubleSide}));m.position.set(x,y,z);m.rotation.y=rotationY;parent.add(m);return m;
  }
  function record(name,type,uf,offset,group){facilityRows.push({name,type,uf,offset,object:group?.name||name});}
  function building({name,type='building',uf,offset,width=12,height=6,length=24,mat=concrete,glassBand=true,label=name}){
    const g=anchor(uf,offset,`SUZUKA_${name.replace(/[^A-Z0-9]+/gi,'_').toUpperCase()}`);mesh(g,new THREE.BoxGeometry(width,height,length),mat,0,height*.5,0,0,0,0,`${name}_BODY`);mesh(g,new THREE.BoxGeometry(width+.35,.24,length+.45),roof,0,height+.12,0);
    if(glassBand)mesh(g,new THREE.BoxGeometry(.12,Math.min(1.8,height*.30),length*.76),glass,-width*.505,height*.67,0);
    if(label)sign(g,label,-width*.515,Math.min(height-.65,height*.73),0,Math.min(length*.72,13),1.05,Math.PI/2);
    record(name,type,uf,offset,g);return g;
  }
  function pavedPad(name,uf,offset,width,length){const g=anchor(uf,offset,`SUZUKA_${name.replace(/[^A-Z0-9]+/gi,'_').toUpperCase()}`);mesh(g,new THREE.BoxGeometry(width,.08,length),asphalt,0,.04,0);record(name,'paddock',uf,offset,g);return g;}

  // Pit-entry/final-corner end: Control Tower with Race Control/Time Keeping and
  // Medical Center on the lower level, followed by the Media Center.
  const control=building({name:'CONTROL_TOWER',type:'race-control',uf:.9865,offset:43,width:13,height:12.8,length:20,label:'CONTROL TOWER'});
  mesh(control,new THREE.BoxGeometry(13.4,2.2,15.5),glass,0,10.1,0);sign(control,'RACE CONTROL',-6.82,9.9,0,11,1.0,Math.PI/2,'#1b313d');
  const antenna=mesh(control,new THREE.CylinderGeometry(.10,.13,7,8),metal,0,16.3,0);antenna.castShadow=false;
  building({name:'MEDIA_CENTER',type:'media',uf:.9915,offset:49,width:15,height:8.2,length:28,label:'MEDIA CENTER'});

  // Published paddock map places the medical heliport/Paddock-E at the control
  // tower end and the large Paddock-A behind the pit building.
  const paddockE=pavedPad('PADDOCK_E',.9828,69,35,42);
  const heli=mesh(paddockE,new THREE.CylinderGeometry(8.5,8.5,.10,28),concreteDark,0,.10,0);heli.name='MEDICAL_HELIPORT_DISC';
  const hmark=mesh(paddockE,new THREE.BoxGeometry(.70,.035,9.0),white,0,.17,0);const hbar=mesh(paddockE,new THREE.BoxGeometry(5.5,.037,.72),white,0,.175,0);hmark.name='HELIPORT_H';hbar.name='HELIPORT_H_BAR';record('MEDICAL_HELIPORT','medical',.9828,69,paddockE);

  const paddockA=pavedPad('PADDOCK_A',1.003,69,62,82);
  const tentMat=new THREE.MeshStandardMaterial({color:0xe9e9e5,roughness:.84});
  for(let r=0;r<3;r++)for(let c=0;c<4;c++){const x=-20+r*19,z=-27+c*18;mesh(paddockA,new THREE.BoxGeometry(10,2.8,12),tentMat,x,1.4,z);mesh(paddockA,new THREE.ConeGeometry(7.9,2.1,4),roof,x,3.85,z,0,Math.PI*.25,0);}

  // Team offices sit directly behind the garages; use a repeated low-rise row
  // instead of generic large blocks so the paddock reads correctly from TV cams.
  const officeRoot=anchor(1.009,57,'SUZUKA_TEAM_OFFICES_RUNTIME');
  for(let i=0;i<8;i++){
    const z=(i-3.5)*12.5,g=new THREE.Group();g.position.z=z;officeRoot.add(g);mesh(g,new THREE.BoxGeometry(10,4.2,10.5),concrete,0,2.1,0);mesh(g,new THREE.BoxGeometry(10.4,.20,10.9),roof,0,4.28,0);mesh(g,new THREE.BoxGeometry(.10,1.45,6.8),glass,-5.06,2.55,0);sign(g,`TEAM OFFICE ${String.fromCharCode(65+i)}`,-5.12,3.42,0,7.6,.72,Math.PI/2,'#4b5357');
  }
  record('TEAM_OFFICES','team-office',1.009,57,officeRoot);

  // Center House / SMSC / Paddock-B cluster behind the pit-exit half.
  const center=anchor(1.0155,82,'SUZUKA_CENTER_HOUSE');
  mesh(center,new THREE.CylinderGeometry(9.5,9.5,4.8,20),concrete,0,2.4,0,0,0,Math.PI/2);mesh(center,new THREE.CylinderGeometry(10.0,10.0,.26,20),roof,0,4.92,0,0,0,Math.PI/2);mesh(center,new THREE.BoxGeometry(.10,1.55,12),glass,-9.56,2.85,0);sign(center,'CENTER HOUSE',-9.64,4.05,0,9.5,.86,Math.PI/2,'#27343a');record('CENTER_HOUSE','visitor',1.0155,82,center);
  const paddockB=pavedPad('PADDOCK_B',1.022,70,42,48);building({name:'SMSC_OFFICE',type:'office',uf:1.0215,offset:91,width:10,height:5.0,length:20,label:'SMSC OFFICE'});

  // Paddock entrance landmark and service road gate at the first-corner end.
  const gate=anchor(1.0315,80,'SUZUKA_MOTORSPORTS_GATE');
  mesh(gate,new THREE.BoxGeometry(1.0,7.0,1.0),concrete,0,3.5,-7);mesh(gate,new THREE.BoxGeometry(1.0,7.0,1.0),concrete,0,3.5,7);mesh(gate,new THREE.BoxGeometry(1.1,1.2,15),dark,0,6.55,0);sign(gate,'MOTORSPORTS GATE',-.58,6.55,0,12.8,.82,Math.PI/2,'#171b1e');record('MOTORSPORTS_GATE','gate',1.0315,80,gate);

  // Paddock tunnel portals: one on paddock side, one on grandstand side, aligned
  // to a common home-straight station to make the under-track connection legible.
  for(const [name,offset,face] of[['PADDOCK_TUNNEL_PADDOCK',47,1],['PADDOCK_TUNNEL_GRANDSTAND',-35,-1]]){
    const g=anchor(1.0175,offset,`SUZUKA_${name}`);mesh(g,new THREE.BoxGeometry(8.5,3.6,7.0),concreteDark,0,1.8,0);mesh(g,new THREE.BoxGeometry(6.2,2.55,.24),dark,face*4.14,1.48,0,0,Math.PI/2,0);sign(g,'PADDOCK TUNNEL',face*4.29,3.05,0,5.8,.62,Math.PI/2,'#343b3f');record(name,'tunnel',1.0175,offset,g);
  }

  // Podium/media-facing detail on the pit-building front.
  const podium=anchor(1.0015,34.9,'SUZUKA_PODIUM_RUNTIME');
  mesh(podium,new THREE.BoxGeometry(1.0,4.8,9.5),concrete,0,2.4,0);mesh(podium,new THREE.BoxGeometry(.10,2.55,7.2),glass,-.54,2.8,0);mesh(podium,new THREE.BoxGeometry(2.2,.28,10.0),roof,-.45,5.0,0);sign(podium,'PODIUM',-.58,4.25,0,6.8,.85,Math.PI/2,'#bd2026');record('PODIUM','ceremony',1.0015,34.9,podium);

  // Opposite side: main grandstand already exists in the underlying world; add
  // the VIP/commentary identity plus GP Square and large circuit-vision screens.
  building({name:'VIP_SUITE',type:'grandstand',uf:1.010,offset:-55,width:8,height:6.5,length:34,mat:concreteDark,label:'VIP SUITE'});
  building({name:'COMMENTARY_BOOTH',type:'broadcast',uf:1.002,offset:-53,width:7,height:4.6,length:18,mat:concreteDark,label:'COMMENTARY'});
  const gp=pavedPad('GP_SQUARE',1.019,-78,48,66);sign(gp,'GP SQUARE',0,2.2,-22,13,1.4,0,'#252d31');
  for(const [i,uf] of[.989,1.006,1.025].entries()){
    const g=anchor(uf,-31,`SUZUKA_GIANT_SCREEN_${i+1}`);mesh(g,new THREE.BoxGeometry(.22,8.8,14),screenMat,0,7.4,0);mesh(g,new THREE.BoxGeometry(.34,7.0,.34),metal,0,3.5,-5.7);mesh(g,new THREE.BoxGeometry(.34,7.0,.34),metal,0,3.5,5.7);record(`GIANT_SCREEN_${i+1}`,'screen',uf,-31,g);
  }

  // Start/finish equipment: start-light gantry, flag towers and a leader tower.
  const gantry=anchor(1.0075,0,'SUZUKA_START_LIGHT_GANTRY');
  const roadHalf=(W.roadWidth||14.4)*.5+2.4;
  mesh(gantry,new THREE.BoxGeometry(.38,7.2,.38),metal,-roadHalf,3.6,0);mesh(gantry,new THREE.BoxGeometry(.38,7.2,.38),metal,roadHalf,3.6,0);mesh(gantry,new THREE.BoxGeometry(roadHalf*2+.8,.38,.42),metal,0,6.95,0);
  for(let i=0;i<5;i++){const lamp=new THREE.Mesh(new THREE.SphereGeometry(.19,8,6),red);lamp.position.set(-1.3+i*.65,6.65,.31);gantry.add(lamp);}record('START_SIGNAL','race-equipment',1.0075,0,gantry);
  for(const [n,uf] of[[1,.9955],[2,1.0228]]){
    const g=anchor(uf,12.6,`SUZUKA_FLAG_TOWER_${n}`);mesh(g,new THREE.BoxGeometry(2.1,7.4,2.1),concreteDark,0,3.7,0);mesh(g,new THREE.BoxGeometry(2.3,2.0,2.3),glass,0,6.0,0);record(`FLAG_TOWER_${n}`,'race-equipment',uf,12.6,g);
  }
  const leader=anchor(1.0115,13.4,'SUZUKA_LEADER_TOWER');mesh(leader,new THREE.BoxGeometry(1.3,12.5,3.2),dark,0,6.25,0);sign(leader,'LEADER',-.68,9.8,0,2.5,.78,Math.PI/2,'#11181c');record('LEADER_TOWER','race-equipment',1.0115,13.4,leader);

  // Team radio masts and pit-wall technical points are visible vertical cues from
  // broadcast cameras and are explicitly documented in the facility guide.
  const mastRoot=new THREE.Group();mastRoot.name='SUZUKA_TEAM_RADIO_MASTS';root.add(mastRoot);
  for(let team=0;team<10;team++){
    const s=W.pitBoxS?.(team)??total*(.994+team*.0031),q=W.sample(s,29.5),g=new THREE.Group();g.position.copy(q.p);g.rotation.y=Math.atan2(q.t.x,q.t.z);mastRoot.add(g);mesh(g,new THREE.CylinderGeometry(.055,.075,9.5,6),metal,0,4.75,0);mesh(g,new THREE.BoxGeometry(.9,.08,.08),metal,0,9.15,0);mesh(g,new THREE.BoxGeometry(.06,.06,.72),metal,0,9.15,.32);
  }
  record('TEAM_RADIO_MASTS','race-equipment',1.006,29.5,mastRoot);

  // Service roads/paddock edges: visually connect the new buildings without
  // touching race/pit physics or adding colliders.
  const service=anchor(1.008,74,'SUZUKA_PADDOCK_SERVICE_ROAD');mesh(service,new THREE.BoxGeometry(12,.07,155),asphalt,0,.035,0);record('PADDOCK_SERVICE_ROAD','road',1.008,74,service);
  const treeRoot=anchor(1.019,106,'SUZUKA_PADDOCK_TREE_EDGE');
  for(let i=0;i<16;i++){const z=-64+i*8.4;mesh(treeRoot,new THREE.CylinderGeometry(.20,.28,2.6,6),dark,0,1.3,z);mesh(treeRoot,new THREE.ConeGeometry(2.2,5.0,7),green,0,4.7,z);}
  record('PADDOCK_TREE_EDGE','landscape',1.019,106,treeRoot);

  W.scene.updateMatrixWorld(true);
  const byType=facilityRows.reduce((a,x)=>(a[x.type]=(a[x.type]||0)+1,a),{});
  W.suzukaFacilities={root,owner:'runtime-suzuka-facilities-v1',count:facilityRows.length,byType,facilities:facilityRows.map(({object,...x})=>({...x,object})),visualOnly:true};
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{
    const a=priorAudit?priorAudit():{};
    return{...a,version:'runtime-2026.09.15-r12',suzukaFacilities:{owner:W.suzukaFacilities.owner,count:W.suzukaFacilities.count,byType:{...byType},names:facilityRows.map(x=>x.name)},notes:[...(a.notes||[]),'Suzuka main-straight and paddock landmarks follow the published paddock/facility plan: control tower, media/medical facilities, paddocks, team offices, Center House, tunnels, gate, VIP/commentary, GP Square and race-control equipment']};
  };
  W.circuitAudit=W.auditCircuit();
  return W;
}
