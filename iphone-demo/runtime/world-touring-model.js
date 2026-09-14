import {buildWorld as buildV13World} from './v13-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV13World(THREE,TRACK,settings,circuitName);
  const baseMake=W.makeCar;

  function wedge(L,Wd,H,front=.78,rear=1){
    const zf=L*.5,zr=-L*.5,wf=Wd*.5*front,wr=Wd*.5*rear,h=H;
    const v=[-wr,0,zr, wr,0,zr, -wf,0,zf, wf,0,zf,
      -wr*.78,h,zr*.72, wr*.78,h,zr*.72, -wf*.72,h,zf*.72, wf*.72,h,zf*.72];
    const ix=[0,2,1,1,2,3,4,5,6,5,7,6,0,1,4,1,5,4,2,6,3,3,6,7,0,4,2,2,4,6,1,3,5,3,7,5];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();return g;
  }

  function sculptTouring(root,color){
    const visual=root.userData.visual||root;
    while(visual.children.length)visual.remove(visual.children[visual.children.length-1]);

    const paint=new THREE.MeshPhysicalMaterial({color,metalness:.17,roughness:.19,clearcoat:1,clearcoatRoughness:.08,envMapIntensity:1.35});
    const accent=new THREE.MeshPhysicalMaterial({color:new THREE.Color(color).offsetHSL(.01,.06,-.10),metalness:.18,roughness:.25,clearcoat:.75});
    const carbon=new THREE.MeshStandardMaterial({color:0x0c0f12,metalness:.48,roughness:.28});
    const glass=new THREE.MeshPhysicalMaterial({color:0x132b3a,roughness:.055,metalness:0,clearcoat:1,clearcoatRoughness:.04,transparent:true,opacity:.88,envMapIntensity:1.25});
    const tire=new THREE.MeshStandardMaterial({color:0x050505,roughness:.97});
    const rim=new THREE.MeshStandardMaterial({color:0x9ca5aa,metalness:.92,roughness:.20});
    const lampF=new THREE.MeshStandardMaterial({color:0xffffef,emissive:0xfff0c0,emissiveIntensity:1.7});
    const lampR=new THREE.MeshStandardMaterial({color:0x450000,emissive:0xff1608,emissiveIntensity:1.15});
    const add=(geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;visual.add(m);return m;};

    add(wedge(5.55,2.38,.48,.78,.97),paint,0,.48,-.02);
    add(wedge(1.65,2.18,.30,.62,.94),paint,0,.64,2.18,-.035);
    add(wedge(1.30,2.02,.34,.94,.70),paint,0,.63,-2.32,.035);
    add(wedge(2.72,1.82,.74,.78,.93),paint,0,.80,-.12,-.035);
    add(wedge(2.35,1.62,.64,.76,.90),glass,0,1.00,-.05,-.055);
    add(wedge(.72,1.55,.22,.86,.94),paint,0,1.20,-1.05,.07);

    for(const s of[-1,1]){
      add(wedge(1.58,.46,.34,.72,.96),paint,s*1.16,.63,1.70);
      add(wedge(1.58,.48,.36,.96,.72),paint,s*1.16,.63,-1.70);
      add(wedge(3.30,.24,.22,.92,.92),accent,s*1.22,.39,-.02);
      add(wedge(.90,.26,.26,.66,.94),carbon,s*1.16,.31,2.28);
    }

    add(wedge(.72,2.12,.22,.56,.98),paint,0,.46,2.64);
    add(new THREE.BoxGeometry(2.18,.065,.42),carbon,0,.27,2.93);
    add(wedge(.70,2.05,.24,.98,.58),paint,0,.49,-2.63);
    add(new THREE.BoxGeometry(1.82,.075,.55),carbon,0,.25,-2.94);
    for(const x of[-.52,0,.52])add(wedge(.55,.34,.14,.92,.40),carbon,x,.24,-2.78);
    add(new THREE.BoxGeometry(2.10,.075,.48),carbon,0,1.46,-2.38);
    for(const x of[-.82,.82])add(new THREE.BoxGeometry(.07,.48,.08),carbon,x,1.22,-2.38);

    for(const x of[-.70,.70]){add(wedge(.42,.30,.13,.72,.94),lampF,x,.69,2.75);add(new THREE.BoxGeometry(.42,.13,.10),lampR,x,.72,-2.77);}
    for(const x of[-1.09,1.09]){add(new THREE.SphereGeometry(.135,9,7),carbon,x,1.14,.65);add(new THREE.BoxGeometry(.23,.045,.08),carbon,x*.91,1.10,.62);}
    add(new THREE.BoxGeometry(1.05,.22,.06),carbon,0,.48,2.96);
    for(const x of[-.67,.67])add(new THREE.BoxGeometry(.42,.17,.07),carbon,x,.43,2.93);

    add(new THREE.BoxGeometry(1.82,.16,4.90),carbon,0,.22,-.02);
    for(const s of[-1,1])for(const z of[-1.69,1.69])add(wedge(1.28,.34,.46,.88,.96),carbon,s*1.00,.48,z);

    const wheels=[],brakeMats=[],tyreMats=[];
    function wheel(x,z){
      const g=new THREE.Group(),tm=tire.clone();tyreMats.push(tm);
      const t=new THREE.Mesh(new THREE.CylinderGeometry(.47,.47,.52,22),tm),r=new THREE.Mesh(new THREE.CylinderGeometry(.285,.285,.54,18),rim);
      const bm=new THREE.MeshStandardMaterial({color:0x4a4b48,metalness:.75,roughness:.40,emissive:0xff2600,emissiveIntensity:0});
      const disc=new THREE.Mesh(new THREE.CylinderGeometry(.205,.205,.56,18),bm),hub=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.58,12),rim);
      for(const o of[t,r,disc,hub])o.rotation.z=Math.PI/2;t.castShadow=true;g.add(t,r,disc,hub);g.position.set(x,.42,z);visual.add(g);wheels.push(g);brakeMats.push(bm);
    }
    wheel(-1.28,1.70);wheel(1.28,1.70);wheel(-1.28,-1.70);wheel(1.28,-1.70);

    root.userData.dims={length:6.65,width:3.04};
    root.userData.wheels=wheels;root.userData.brakeMats=brakeMats;root.userData.v13TyreMats=tyreMats;
    root.userData.cameraAnchors={cockpit:[0,1.20,.28],nose:[0,.67,2.82],bumper:[0,.43,3.02],rear:[0,1.02,-2.76],wheel:[-1.10,.54,1.62]};
    root.userData.v14Touring=true;
    return root;
  }

  W.makeCar=(color,type)=>{
    const root=baseMake(color,type);
    if(type==='touring')sculptTouring(root,color);
    return root;
  };
  return W;
}
