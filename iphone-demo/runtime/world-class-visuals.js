import {buildWorld as buildVehicleDetailWorld} from './world-vehicle-detail.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildVehicleDetailWorld(THREE,TRACK,settings,circuitName);
  const baseMake=W.makeCar;
  const carbon=new THREE.MeshStandardMaterial({color:0x0b0e11,metalness:.62,roughness:.26});
  const metal=new THREE.MeshStandardMaterial({color:0x7d878e,metalness:.82,roughness:.28});
  const dark=new THREE.MeshStandardMaterial({color:0x171b1f,metalness:.34,roughness:.42});
  const tintCache=new Map();

  function tint(color){
    const key=color>>>0;
    if(!tintCache.has(key)){
      const c=new THREE.Color(key).offsetHSL(.005,.02,-.035);
      tintCache.set(key,new THREE.MeshPhysicalMaterial({color:c,metalness:.18,roughness:.21,clearcoat:.88,clearcoatRoughness:.12,envMapIntensity:1.2}));
    }
    return tintCache.get(key);
  }
  function add(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,scale=null){
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);if(scale)m.scale.set(scale[0],scale[1],scale[2]);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }
  function tube(parent,a,b,r=.026,mat=metal){
    const dir=b.clone().sub(a),len=dir.length();if(len<.001)return null;
    const m=add(parent,new THREE.CylinderGeometry(r,r,len,6),mat);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());return m;
  }
  function endplates(g,z,y,w,front=false){for(const x of[-w,w]){add(g,new THREE.BoxGeometry(.055,.48,.44),carbon,x,y,z);if(front)add(g,new THREE.BoxGeometry(.06,.18,.70),carbon,x*.985,y-.13,z-.02);}}
  function diffuser(g,z,width=1.55){add(g,new THREE.BoxGeometry(width,.07,.72),carbon,0,.23,z);for(const x of[-.62,-.31,0,.31,.62])add(g,new THREE.BoxGeometry(.035,.34,.72),carbon,x*(width/1.55),.37,z,0,0,-Math.sign(x||1)*.05);}
  function arch(g,mat,x,z,sx=.66,sy=.34,sz=1.05){return add(g,new THREE.SphereGeometry(1,10,7,0,Math.PI*2,0,Math.PI*.53),mat,x,.62,z,0,0,0,[sx,sy,sz]);}
  function upgradeFormula(g,body){
    let n=0;const A=(...args)=>{add(g,...args);n++;};const T=(a,b,r=.024,mat=metal)=>{if(tube(g,a,b,r,mat))n++;};
    T(new THREE.Vector3(0,.93,.82),new THREE.Vector3(0,1.39,.67),.035,carbon);T(new THREE.Vector3(0,1.37,.68),new THREE.Vector3(-.43,1.12,.48),.035,carbon);T(new THREE.Vector3(0,1.37,.68),new THREE.Vector3(.43,1.12,.48),.035,carbon);
    A(new THREE.BoxGeometry(3.02,.055,.30),carbon,0,.30,4.17,-.05);A(new THREE.BoxGeometry(2.72,.045,.24),carbon,0,.36,4.00,-.10);endplates(g,4.18,.39,1.52,true);n+=4;
    A(new THREE.BoxGeometry(2.48,.055,.30),carbon,0,1.02,-2.38,.05);endplates(g,-2.30,1.10,1.27,false);n+=2;
    for(const s of[-1,1]){const xf=1.39*s,xr=1.41*s;T(new THREE.Vector3(.52*s,.52,1.55),new THREE.Vector3(xf,.49,2.32),.022);T(new THREE.Vector3(.58*s,.76,1.25),new THREE.Vector3(xf,.63,2.32),.022);T(new THREE.Vector3(.61*s,.50,-1.00),new THREE.Vector3(xr,.51,-1.76),.024);T(new THREE.Vector3(.60*s,.75,-.86),new THREE.Vector3(xr,.65,-1.76),.024);}
    for(const s of[-1,1]){A(new THREE.BoxGeometry(.055,.08,2.95),carbon,.78*s,.29,-.12);A(new THREE.BoxGeometry(.09,.48,.62),body,.91*s,.57,1.04,0,0,.08*s);}
    return n;
  }
  function upgradePrototype(g,body,kind='proto'){
    let n=0;const A=(...args)=>{add(g,...args);n++;};const wide=kind==='lmh'?1.02:.96;
    for(const s of[-1,1]){arch(g,body,1.02*s,1.82,.62,.32,wide);n++;arch(g,body,1.02*s,-1.72,.64,.34,.94);n++;A(new THREE.BoxGeometry(.10,.25,2.85),carbon,1.13*s,.31,-.02);}
    // The base prototype/LMH shell already owns its class-correct dorsal fin.
    // Do not add a second overlapping fin here; from broadcast cameras the pair
    // looked like an exposed roll cage protruding through the canopy.
    A(new THREE.BoxGeometry(2.12,.055,.28),carbon,0,1.11,-2.84,.06);endplates(g,-2.80,1.13,1.08,false);n+=2;
    for(const s of[-1,1])A(new THREE.BoxGeometry(.52,.045,.24),carbon,.93*s,.42,2.58,0,0,.12*s);diffuser(g,-2.86,1.72);n+=6;
    if(kind==='lmh'){for(const s of[-1,1])A(new THREE.BoxGeometry(.07,.28,1.55),dark,1.08*s,.54,.40,0,0,.04*s);A(new THREE.BoxGeometry(1.30,.055,.35),carbon,0,.27,2.82);}
    return n;
  }
  function upgradeHyper(g,body){
    let n=0;const A=(...args)=>{add(g,...args);n++;};
    for(const s of[-1,1]){arch(g,body,1.08*s,1.67,.56,.28,.82);n++;arch(g,body,1.08*s,-1.62,.58,.30,.80);n++;A(new THREE.BoxGeometry(.08,.20,2.55),carbon,1.17*s,.31,-.02);A(new THREE.BoxGeometry(.12,.36,1.12),dark,.97*s,.55,.24,0,0,.09*s);}
    A(new THREE.BoxGeometry(.055,.46,1.12),carbon,0,1.02,-.70);A(new THREE.BoxGeometry(1.92,.05,.28),carbon,0,1.02,-2.63,.06);endplates(g,-2.60,1.03,.98,false);n+=2;diffuser(g,-2.76,1.66);n+=6;for(const s of[-1,1])A(new THREE.BoxGeometry(.42,.04,.20),carbon,.83*s,.39,2.42,0,0,.12*s);return n;
  }
  W.makeCar=(color,type)=>{
    const root=baseMake(color,type);
    if(!['formula','proto','hyper','lmh'].includes(type))return root;

    // V13's generic closed-car interior was designed around taller GT/touring
    // cabins. In the very low prototype/hypercar canopy it can place the cage
    // and driver's helmet through the roof. These classes use their opaque/
    // tinted procedural cockpit shell instead, so detach that incompatible rig.
    if(['proto','hyper','lmh'].includes(type)){
      const fine=root.userData?.v13Fine;
      if(fine){fine.visible=false;fine.parent?.remove(fine);root.userData.v13Fine=null;root.userData.closedCockpitInteriorSuppressed=true;}
    }

    const visual=root.userData?.visual||root,group=new THREE.Group();group.name='CLASS_VISUAL_UPGRADE_V1';visual.add(group);const body=tint(color);let parts=0;if(type==='formula')parts=upgradeFormula(group,body);else if(type==='hyper')parts=upgradeHyper(group,body);else parts=upgradePrototype(group,body,type);root.userData.classVisualUpgrade={version:2,type,parts,group};return root;
  };
  const baseLOD=W.updateVehicleLOD?.bind(W);W.updateVehicleLOD=(cars=[])=>{baseLOD?.(cars);const cp=W.camera?.position;if(!cp)return;for(const c of cars){const x=c?.mesh?.userData?.classVisualUpgrade;if(!x?.group)continue;const d=cp.distanceTo(c.mesh.position);x.group.visible=d<145&&c.mesh.visible!==false;}};
  return W;
}
