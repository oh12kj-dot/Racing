import {buildWorld as buildV11World} from './v11-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV11World(THREE,TRACK,settings,circuitName);
  const originalMakeCar=W.makeCar;
  const TEAM_COLORS=[0xe3312d,0x287de1,0xf2c52f,0xf3f3f3,0x20bd7b,0x9362df,0xed7b27,0x22aab8,0xe04a90,0xaeb6c1];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function wedge(L,Wd,H,front=.78,rear=1){
    const zf=L*.5,zr=-L*.5,wf=Wd*.5*front,wr=Wd*.5*rear,h=H;
    const v=[-wr,0,zr,wr,0,zr,-wf,0,zf,wf,0,zf,-wr*.82,h,zr*.76,wr*.82,h,zr*.76,-wf*.76,h,zf*.74,wf*.76,h,zf*.74];
    const ix=[0,2,1,1,2,3,4,5,6,5,7,6,0,1,4,1,5,4,2,6,3,3,6,7,0,4,2,2,4,6,1,3,5,3,7,5];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();return g;
  }
  function paint(color){return new THREE.MeshPhysicalMaterial({color,metalness:.18,roughness:.20,clearcoat:1,clearcoatRoughness:.10,envMapIntensity:1.3});}
  const carbon=new THREE.MeshStandardMaterial({color:0x0c0e10,metalness:.48,roughness:.28});
  const dark=new THREE.MeshStandardMaterial({color:0x171a1d,metalness:.18,roughness:.55});
  const glass=new THREE.MeshPhysicalMaterial({color:0x142533,roughness:.07,clearcoat:1,transparent:true,opacity:.88});

  function addSolidBody(root,color,type){
    const visual=root.userData.visual||root,d=root.userData.dims||{length:7,width:3},L=d.length,Wd=d.width,m=paint(color);
    const add=(geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{const o=new THREE.Mesh(geo,mat);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.castShadow=true;o.receiveShadow=true;visual.add(o);return o;};
    add(new THREE.BoxGeometry(Wd*.82,.16,L*.82),carbon,0,.22,-.02);
    add(wedge(L*.72,Wd*(type==='formula'?.46:.76),type==='formula'?.48:.62,.78,.98),m,0,.42,.00);
    add(new THREE.BoxGeometry(Wd*.70,.28,L*.44),m,0,.48,-L*.08);
    add(wedge(L*.20,Wd*.66,.30,.60,.96),m,0,.47,L*.35);
    add(wedge(L*.18,Wd*.70,.32,.94,.68),m,0,.46,-L*.36);
    for(const s of[-1,1]){
      add(new THREE.BoxGeometry(Wd*.13,.34,L*.54),m,s*Wd*.355,.43,-.03);
      add(wedge(L*.24,Wd*.16,.36,.78,1),m,s*Wd*.36,.50,L*.23);
      add(wedge(L*.22,Wd*.17,.34,1,.78),m,s*Wd*.36,.50,-L*.25);
    }
    add(new THREE.BoxGeometry(Wd*.58,.22,L*.08),m,0,.45,L*.43);
    add(new THREE.BoxGeometry(Wd*.62,.24,L*.09),m,0,.47,-L*.43);
    for(const s of[-1,0,1])add(wedge(L*.12,Wd*.18,.13,.95,.45),carbon,s*Wd*.22,.24,-L*.40);

    if(type==='formula'){
      add(wedge(L*.38,Wd*.36,.58,.62,.92),m,0,.62,-L*.06);
      add(wedge(L*.22,Wd*.22,.38,.38,.88),m,0,.55,L*.27);
      for(const s of[-1,1])add(wedge(L*.28,Wd*.18,.44,.78,1),m,s*Wd*.24,.58,-.01);
      const seat=add(new THREE.BoxGeometry(.52,.54,.86),dark,0,.77,-.15);seat.rotation.x=-.15;
      add(new THREE.BoxGeometry(.48,.18,.10),dark,0,.95,.33);
    }else{
      const axleZ=L*.26;
      for(const z of[-axleZ,axleZ])for(const s of[-1,1])add(wedge(L*.24,Wd*.20,.48,.82,.98),m,s*Wd*.34,.57,z);
      add(wedge(L*.33,Wd*.54,.42,.82,.96),m,0,.73,-L*.02);
      add(new THREE.BoxGeometry(Wd*.46,.30,L*.25),dark,0,.69,-L*.03);
      const dash=add(new THREE.BoxGeometry(Wd*.44,.22,.35),dark,0,.91,L*.10);dash.rotation.x=-.08;
      const seat=add(new THREE.BoxGeometry(.62,.62,.76),dark,-Wd*.10,.83,-L*.08);seat.rotation.x=-.12;
      add(new THREE.BoxGeometry(.12,.18,.44),dark,0,.78,.14);
      add(new THREE.BoxGeometry(Wd*.50,.08,L*.30),carbon,0,.31,.00);
      for(const z of[-axleZ,axleZ])for(const s of[-1,1])add(new THREE.BoxGeometry(.18,.64,L*.16),dark,s*Wd*.40,.55,z);
      if(type==='gt'||type==='touring'||type==='supercar')add(wedge(L*.30,Wd*.52,.62,.86,.92),glass,0,.91,-L*.03,-.03);
    }
    root.userData.solidBodyV12=true;return root;
  }
  W.makeCar=(color,type)=>addSolidBody(originalMakeCar(color,type),color,type);

  const crewSets=[],pitAnimRoot=new THREE.Group();pitAnimRoot.name='PIT_ANIMATION_V12';W.scene.add(pitAnimRoot);
  const skinM=new THREE.MeshStandardMaterial({color:0xd5a27c,roughness:.9}),helmetM=new THREE.MeshStandardMaterial({color:0xf4f4f4,roughness:.38,metalness:.08}),toolM=new THREE.MeshStandardMaterial({color:0x60696f,roughness:.36,metalness:.72}),tyreM=new THREE.MeshStandardMaterial({color:0x070707,roughness:.96});
  function crewRig(color){
    const root=new THREE.Group(),suit=new THREE.MeshStandardMaterial({color,roughness:.72});
    const torso=new THREE.Mesh(new THREE.BoxGeometry(.34,.58,.22),suit);torso.position.y=.74;root.add(torso);
    const pelvis=new THREE.Mesh(new THREE.BoxGeometry(.30,.22,.20),suit);pelvis.position.y=.40;root.add(pelvis);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.15,9,7),skinM);head.position.y=1.18;root.add(head);
    const helmet=new THREE.Mesh(new THREE.SphereGeometry(.18,10,7,0,Math.PI*2,0,Math.PI*.64),helmetM);helmet.position.y=1.22;root.add(helmet);
    const limbs={};
    for(const side of[-1,1]){
      const arm=new THREE.Group(),upper=new THREE.Mesh(new THREE.BoxGeometry(.13,.42,.13),suit),fore=new THREE.Mesh(new THREE.BoxGeometry(.11,.38,.11),suit);upper.position.y=-.20;fore.position.y=-.56;arm.add(upper,fore);arm.position.set(side*.24,1.00,0);root.add(arm);limbs[side<0?'la':'ra']=arm;
      const leg=new THREE.Group(),thigh=new THREE.Mesh(new THREE.BoxGeometry(.14,.44,.16),suit),shin=new THREE.Mesh(new THREE.BoxGeometry(.13,.42,.14),suit);thigh.position.y=-.22;shin.position.y=-.62;leg.add(thigh,shin);leg.position.set(side*.11,.39,0);root.add(leg);limbs[side<0?'ll':'rl']=leg;
    }
    root.userData.limbs=limbs;root.traverse(o=>{if(o.isMesh)o.castShadow=true;});return root;
  }
  function wheelProp(){const g=new THREE.Group(),t=new THREE.Mesh(new THREE.TorusGeometry(.32,.13,8,18),tyreM),hub=new THREE.Mesh(new THREE.CylinderGeometry(.14,.14,.12,12),toolM);t.rotation.y=Math.PI/2;hub.rotation.z=Math.PI/2;g.add(t,hub);return g;}
  function wrenchProp(){const g=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.42),toolM),nose=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.20,10),toolM);nose.rotation.x=Math.PI/2;nose.position.z=-.28;g.add(body,nose);return g;}
  function jackProp(){const g=new THREE.Group(),beam=new THREE.Mesh(new THREE.BoxGeometry(.18,.12,1.10),toolM),handle=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,1.0,8),toolM);handle.rotation.x=Math.PI/2;handle.position.set(0,.35,.35);g.add(beam,handle);return g;}

  for(let team=0;team<10;team++){
    const q=W.pitPose?.(0,team,'STOP');if(!q)continue;
    const g=new THREE.Group();g.position.copy(q.p);g.rotation.y=q.rotationY;g.visible=false;pitAnimRoot.add(g);const roles=[];
    const service=[[-1.58,0,-1.62],[1.58,0,-1.62],[-1.58,0,1.62],[1.58,0,1.62]];
    for(let i=0;i<4;i++){
      const rig=crewRig(TEAM_COLORS[team]),home=new THREE.Vector3(4.8,0,-2.5+i*1.65),target=new THREE.Vector3(...service[i]);rig.position.copy(home);g.add(rig);const wheel=wheelProp();wheel.position.set(home.x-.35,.38,home.z);g.add(wheel);const gun=wrenchProp();gun.position.set(home.x-.20,.65,home.z);g.add(gun);roles.push({kind:'wheel',rig,home,target,wheel,gun,index:i});
    }
    for(const [kind,z] of [['frontJack',2.55],['rearJack',-2.55]]){
      const rig=crewRig(TEAM_COLORS[team]),home=new THREE.Vector3(5.2,0,z),target=new THREE.Vector3(0,0,z);rig.position.copy(home);g.add(rig);const jack=jackProp();jack.position.set(home.x-.4,.16,z);g.add(jack);roles.push({kind,rig,home,target,jack});
    }
    const release=crewRig(TEAM_COLORS[team]),releaseHome=new THREE.Vector3(4.4,0,.2),releaseTarget=new THREE.Vector3(-2.6,0,.1);release.position.copy(releaseHome);g.add(release);const paddle=new THREE.Mesh(new THREE.BoxGeometry(.72,.05,.38),new THREE.MeshStandardMaterial({color:TEAM_COLORS[team],roughness:.6}));paddle.position.set(releaseHome.x,.95,.2);g.add(paddle);roles.push({kind:'release',rig:release,home:releaseHome,target:releaseTarget,paddle});crewSets[team]={group:g,roles};
  }

  function ease(t){t=clamp(t,0,1);return t*t*(3-2*t);}
  function moveRig(role,pos,lean=0){role.rig.position.lerp(pos,.24);role.rig.rotation.x=lean;const L=role.rig.userData.limbs||{},walk=Math.sin(performance.now()*.018+(role.index||0))*.35;for(const k of['la','rl'])if(L[k])L[k].rotation.x=walk;for(const k of['ra','ll'])if(L[k])L[k].rotation.x=-walk;}
  W.updateDetailedPitCrews=(details=[],dt=.016)=>{
    const byTeam=new Map(details.map(d=>[d.teamId,d]));
    for(let team=0;team<crewSets.length;team++){
      const set=crewSets[team];if(!set)continue;const d=byTeam.get(team),active=!!d;set.group.visible=active;if(!active)continue;
      const p=clamp(d.progress??0,0,1),rush=ease(p/.16),clear=ease((p-.82)/.18);
      for(const role of set.roles){
        if(role.kind==='wheel'){
          const svc=role.target.clone(),approach=role.home.clone().lerp(svc,rush);if(clear>0)approach.lerp(role.home,clear);moveRig(role,approach,p>.18&&p<.82?.28:0);
          const side=role.target.x<0?-1:1,wheelOut=clamp((p-.34)/.12,0,1)*(1-clamp((p-.64)/.13,0,1));role.wheel.position.set(role.rig.position.x-side*.34,.38,role.rig.position.z+.05);role.wheel.visible=p>.28&&p<.78;role.wheel.rotation.z+=dt*5;role.gun.position.set(role.rig.position.x-side*.18,.66,role.rig.position.z);role.gun.visible=(p>.18&&p<.35)||(p>.70&&p<.84);const arms=role.rig.userData.limbs;for(const a of['la','ra'])if(arms?.[a])arms[a].rotation.x=(p>.18&&p<.84)?-1.05:0;role.wheel.position.x+=side*wheelOut*.32;
        }else if(role.kind==='frontJack'||role.kind==='rearJack'){
          const approach=role.home.clone().lerp(role.target,rush);if(clear>0)approach.lerp(role.home,clear);moveRig(role,approach,p>.10&&p<.86?.18:0);role.jack.position.set(role.rig.position.x-.30,.16,role.rig.position.z);role.jack.visible=p>.08&&p<.90;
        }else{
          const approach=role.home.clone().lerp(role.target,ease(p/.12));if(p>.86)approach.lerp(role.home,ease((p-.86)/.14));moveRig(role,approach,0);role.paddle.position.set(role.rig.position.x,.96,role.rig.position.z);role.paddle.rotation.z=p>.82?-.85:0;
        }
      }
    }
  };
  W.animatePitStopCar=(car,progress=0)=>{
    if(!car?.mesh)return;const wheels=car.mesh.userData.wheels||[];if(!car.mesh.userData.v12WheelBase)car.mesh.userData.v12WheelBase=wheels.map(w=>w.position.clone());const bases=car.mesh.userData.v12WheelBase,p=clamp(progress,0,1);
    for(let i=0;i<wheels.length;i++){const w=wheels[i],b=bases[i];if(!b)continue;const sign=b.x<0?-1:1;let out=0;if(p>.28&&p<.76)out=ease(clamp((p-.28)/.10,0,1))*(1-ease(clamp((p-.64)/.12,0,1)))*.34;w.position.copy(b);w.position.x+=sign*out;w.rotation.z+=out*.6;}
  };
  W.resetPitStopCar=car=>{const wheels=car?.mesh?.userData?.wheels||[],bases=car?.mesh?.userData?.v12WheelBase||[];for(let i=0;i<wheels.length;i++)if(bases[i])wheels[i].position.copy(bases[i]);};
  return W;
}
