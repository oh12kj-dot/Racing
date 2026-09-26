import {buildWorld as buildV12World} from './v12-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV12World(THREE,TRACK,settings,circuitName);
  const baseMake=W.makeCar;
  const fineMat=new THREE.MeshStandardMaterial({color:0x24282c,metalness:.45,roughness:.34});
  const beltMat=new THREE.MeshStandardMaterial({color:0xe52b2f,roughness:.72});
  const orangeMat=new THREE.MeshStandardMaterial({color:0xff7a1a,roughness:.68});
  const yellowMat=new THREE.MeshStandardMaterial({color:0xf4ca26,roughness:.55,metalness:.05});
  const steelMat=new THREE.MeshStandardMaterial({color:0x8c969b,metalness:.78,roughness:.28});
  const darkMat=new THREE.MeshStandardMaterial({color:0x101316,metalness:.14,roughness:.62});
  const tyreMats=[];
  const fineGroups=[];

  const add=(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  function tube(parent,a,b,r=.035,mat=fineMat){const mid=a.clone().add(b).multiplyScalar(.5),dir=b.clone().sub(a),len=dir.length(),m=add(parent,new THREE.CylinderGeometry(r,r,len,8),mat);m.position.copy(mid);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());return m;}
  function driverRig(type){const g=new THREE.Group();const suit=new THREE.MeshStandardMaterial({color:0x202a35,roughness:.72}),skin=new THREE.MeshStandardMaterial({color:0xc99370,roughness:.9}),helmet=new THREE.MeshPhysicalMaterial({color:0xf2f2f2,roughness:.23,metalness:.1,clearcoat:.7});add(g,new THREE.BoxGeometry(.46,.54,.34),suit,0,.38,0,0.18);add(g,new THREE.SphereGeometry(.18,10,8),skin,0,.78,.04);add(g,new THREE.SphereGeometry(.205,12,8,0,Math.PI*2,0,Math.PI*.62),helmet,0,.82,.04);add(g,new THREE.BoxGeometry(.28,.06,.10),darkMat,0,.83,.21);if(type==='formula')g.scale.set(.86,.86,.86);return g;}
  function addInterior(root,type){
    const d=root.userData.dims||{length:7,width:3},A=root.userData.cameraAnchors||{},cock=A.cockpit||[0,1.1,.3],g=new THREE.Group();g.name='V13_FINE_INTERIOR';root.add(g);fineGroups.push(g);
    const open=type==='formula';
    add(g,new THREE.BoxGeometry(open?.62:d.width*.48,.16,d.length*.26),darkMat,0,.52,-d.length*.04);
    const seat=add(g,new THREE.BoxGeometry(open?.48:.62,.64,.72),darkMat,-(open?0:d.width*.09),.76,-d.length*.08,-.12);seat.name='SEAT';
    for(const x of[-.18,.18])add(g,new THREE.BoxGeometry(.055,.035,.86),beltMat,x-(open?0:d.width*.09),.91,-d.length*.02,-.18);
    const wheel=add(g,new THREE.TorusGeometry(.25,.035,8,18),fineMat,cock[0],cock[1]-.05,cock[2]+.28,Math.PI/2);wheel.name='STEERING_WHEEL';
    add(g,new THREE.BoxGeometry(.44,.20,.13),darkMat,0,cock[1]-.02,cock[2]+.10,-.12);
    const screen=add(g,new THREE.PlaneGeometry(.26,.10),new THREE.MeshBasicMaterial({color:0x40d8ff}),0,cock[1]+.01,cock[2]+.035,-.12);screen.name='DASH_SCREEN';
    const drv=driverRig(type);drv.position.set(open?0:-d.width*.09,.55,-d.length*.06);g.add(drv);
    if(!open){
      const cage=new THREE.Group();g.add(cage);const w=d.width*.48,z=d.length*.18,y0=.58,y1=1.55;for(const sx of[-1,1]){tube(cage,new THREE.Vector3(sx*w*.5,y0,-z),new THREE.Vector3(sx*w*.5,y1,-z));tube(cage,new THREE.Vector3(sx*w*.5,y1,-z),new THREE.Vector3(sx*w*.42,y1,z));tube(cage,new THREE.Vector3(sx*w*.5,y0,-z),new THREE.Vector3(-sx*w*.42,y1,z));}tube(cage,new THREE.Vector3(-w*.5,y1,-z),new THREE.Vector3(w*.5,y1,-z));
      add(g,new THREE.BoxGeometry(d.width*.52,.06,.07),fineMat,0,.47,d.length*.13);add(g,new THREE.BoxGeometry(.08,.20,.18),fineMat,-.12,.45,d.length*.16);
    }
    root.userData.v13Fine=g;
  }
  function addDamageParts(root,color,type){
    const d=root.userData.dims||{length:7,width:3},m=new THREE.MeshPhysicalMaterial({color,metalness:.16,roughness:.24,clearcoat:.8}),g=new THREE.Group();g.name='V13_DAMAGE_PARTS';root.add(g);
    const front=add(g,new THREE.BoxGeometry(d.width*.70,.12,.32),m,0,.48,d.length*.43);front.userData.base=front.position.clone();
    const rear=add(g,new THREE.BoxGeometry(d.width*.64,.15,.30),m,0,.54,-d.length*.43);rear.userData.base=rear.position.clone();
    const ml=add(g,new THREE.BoxGeometry(.18,.13,.30),m,-d.width*.47,.92,d.length*.10);ml.userData.base=ml.position.clone();
    const mr=ml.clone();mr.position.x*=-1;mr.userData.base=mr.position.clone();g.add(mr);
    const splitter=add(g,new THREE.BoxGeometry(d.width*.76,.07,.45),darkMat,0,.28,d.length*.455);splitter.userData.base=splitter.position.clone();
    root.userData.damageParts={group:g,front,rear,mirrors:[ml,mr],splitter};
  }
  function prepareTyres(root){
    const mats=[];for(const w of root.userData.wheels||[]){const tyre=w.children?.[0];if(tyre?.material){tyre.material=tyre.material.clone();mats.push(tyre.material);}}root.userData.v13TyreMats=mats;tyreMats.push(...mats);
  }
  W.makeCar=(color,type)=>{const r=baseMake(color,type);addInterior(r,type);addDamageParts(r,color,type);prepareTyres(r);return r;};

  W.updateVehicleLOD=(cars=[])=>{for(const c of cars){if(!c?.mesh)continue;const d=W.camera.position.distanceTo(c.mesh.position),fine=c.mesh.userData.v13Fine; if(fine)fine.visible=d<85; const wheels=c.mesh.userData.wheels||[];for(const w of wheels){for(let i=1;i<w.children.length;i++)w.children[i].visible=d<150;}c.mesh.userData.lodLevel=d<85?'HIGH':d<150?'MEDIUM':'LOW';}};
  W.updateTyreVisual=c=>{if(!c?.mesh)return;const wear=Math.max(0,Math.min(1,c.wear||0));for(const m of c.mesh.userData.v13TyreMats||[]){m.color.setRGB(.025+wear*.12,.025+wear*.105,.025+wear*.085);m.roughness=.90+wear*.08;}const ws=c.mesh.userData.wheels||[];if(c.flatSpot&&ws[0])ws[0].scale.y=.955;else if(ws[0])ws[0].scale.y=1;};
  W.updateCarDamage=c=>{const p=c?.mesh?.userData?.damageParts;if(!p)return;const d=Math.max(0,Math.min(1,c.damage||0));p.front.rotation.x=-d*.35;p.front.position.y=p.front.userData.base.y-d*.10;p.splitter.rotation.z=d>.35?.12:0;p.rear.rotation.x=d>.55?.18:0;p.mirrors[0].rotation.z=d>.25?-.55:0;p.mirrors[1].rotation.z=d>.48?.55:0;if(d>.72)p.mirrors[0].visible=false;};

  W.setupGridTheatre=cars=>{for(const c of cars){if(c.mesh.userData.gridTheatre)continue;const g=new THREE.Group(),blankets=[];for(const w of c.mesh.userData.wheels||[]){const b=new THREE.Mesh(new THREE.TorusGeometry(.46,.11,8,16),new THREE.MeshStandardMaterial({color:0x30343a,roughness:.86}));b.position.copy(w.position);b.rotation.y=Math.PI/2;g.add(b);blankets.push(b);}const mech=new THREE.Group();add(mech,new THREE.BoxGeometry(.35,.7,.24),new THREE.MeshStandardMaterial({color:c.teamColor||0x446688,roughness:.7}),0,.55,0);add(mech,new THREE.SphereGeometry(.16,8,6),new THREE.MeshStandardMaterial({color:0xd3a17c}),0,1.02,0);mech.position.set(2.7,0,-1.2);g.add(mech);c.mesh.add(g);c.mesh.userData.gridTheatre={g,blankets,mech};}};
  W.updateGridTheatre=(cars,phase,t,green)=>{for(const c of cars){const x=c.mesh.userData.gridTheatre;if(!x)continue;const visible=phase!=='QUALIFYING'&&phase!=='FORMATION'&&t<green;x.g.visible=visible;if(!visible)continue;const k=Math.max(0,Math.min(1,t/Math.max(.1,green)));x.mech.position.x=2.7+Math.max(0,(k-.45)/.55)*4.5;x.mech.rotation.y=Math.sin(t*9)*.08;const off=k>.55;for(const b of x.blankets)b.visible=!off;}};

  const serviceRigs=[];for(let team=0;team<10;team++){const q=W.pitPose?.(0,team,'STOP');if(!q)continue;const g=new THREE.Group();g.position.copy(q.p);g.rotation.y=q.rotationY;g.visible=false;W.scene.add(g);add(g,new THREE.BoxGeometry(.13,2.7,.13),steelMat,3.0,1.35,-.4);add(g,new THREE.BoxGeometry(2.4,.10,.10),steelMat,1.85,2.55,-.4);const hose=[];for(let i=0;i<7;i++){const s=add(g,new THREE.CylinderGeometry(.035,.035,.62,8),darkMat,1.0-i*.18,2.3-i*.27,-.4+i*.05,0,0,.55);hose.push(s);}const lamp=add(g,new THREE.SphereGeometry(.12,8,6),new THREE.MeshStandardMaterial({color:0x083608,emissive:0x31ff5c,emissiveIntensity:1.2}),3.0,2.82,-.4);serviceRigs[team]={g,hose,lamp};}
  W.updatePitService=(stops=[])=>{const map=new Map(stops.map(s=>[s.teamId,s]));for(let i=0;i<serviceRigs.length;i++){const r=serviceRigs[i];if(!r)continue;const s=map.get(i);r.g.visible=!!s;if(!s)continue;const p=Math.max(0,Math.min(1,s.progress||0)),active=p>.24&&p<.78;r.lamp.material.emissiveIntensity=active?2.4:.3;for(let k=0;k<r.hose.length;k++){r.hose[k].rotation.z=.55+(active?Math.sin(p*18+k)*.12:0);r.hose[k].position.x=1.0-k*.18-(active?.10*k:0);}}};

  const recoveries=[];function marshal(){const g=new THREE.Group();add(g,new THREE.BoxGeometry(.34,.66,.22),orangeMat,0,.54,0);add(g,new THREE.SphereGeometry(.15,8,6),new THREE.MeshStandardMaterial({color:0xd0a07b}),0,1.01,0);return g;}function truck(){const g=new THREE.Group();add(g,new THREE.BoxGeometry(2.4,.8,4.0),yellowMat,0,.65,0);add(g,new THREE.BoxGeometry(2.1,1.2,1.6),yellowMat,0,1.45,1.0);for(const x of[-1.0,1.0])for(const z of[-1.25,1.25])add(g,new THREE.CylinderGeometry(.38,.38,.28,12),darkMat,x,.38,z,0,0,Math.PI/2);return g;}
  W.spawnRecovery=(car,reason='INCIDENT')=>{if(!car)return;const q=W.sample(car.s,15),g=new THREE.Group();g.position.copy(q.p);g.position.y+=.1;g.rotation.y=Math.atan2(q.t.x,q.t.z);const tr=truck();tr.position.set(5.5,0,-4);g.add(tr);const m1=marshal(),m2=marshal();m1.position.set(1.8,0,-1);m2.position.set(2.4,0,1.0);g.add(m1,m2);W.scene.add(g);recoveries.push({g,tr,m1,m2,age:0,reason});};
  W.updateRecoveries=dt=>{for(let i=recoveries.length-1;i>=0;i--){const r=recoveries[i];r.age+=dt;const a=Math.min(1,r.age/5);r.tr.position.x=5.5-a*3.4;r.m1.rotation.y=Math.sin(r.age*4)*.25;r.m2.rotation.y=-Math.sin(r.age*3.5)*.25;if(r.age>16){W.scene.remove(r.g);recoveries.splice(i,1);}}};
  return W;
}
