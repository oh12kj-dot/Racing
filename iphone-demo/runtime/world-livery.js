import {buildWorld as buildTouringWorld} from './world-touring-model.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildTouringWorld(THREE,TRACK,settings,circuitName),baseMake=W.makeCar;
  const accentPalette=[0xf4f4f0,0x111317,0xffd11a,0x19bfff,0xff593d,0x8c63ff,0x22d79a,0xff5fa2];
  const tertiaryPalette=[0x111317,0xf5f5f2,0x26364c,0x6d1724,0x0f5443,0x4a2a73];
  const sponsors=['VELOCITY','NOVA','APEX','QUANTUM','VECTOR','PULSE','ORBIT','HELIX','TITAN','VORTEX'];
  const materialCache=new Map(),decalCache=new Map();
  const typeCode={formula:11,proto:23,hyper:31,lmh:37,gt:43,supercar:53,touring:61};
  const hash=(color,type)=>(((color>>>0)*2654435761)^((typeCode[type]||71)*2246822519))>>>0;
  const css=n=>`#${(n>>>0).toString(16).padStart(6,'0')}`;

  function paint(color,metal=.12,rough=.24){
    const key=`${color>>>0}:${metal}:${rough}`;
    if(!materialCache.has(key))materialCache.set(key,new THREE.MeshPhysicalMaterial({color:color>>>0,metalness:metal,roughness:rough,clearcoat:.92,clearcoatRoughness:.10,envMapIntensity:1.18,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    return materialCache.get(key);
  }
  function rgbDistance(a,b){
    const dr=a.r-b.r,dg=a.g-b.g,db=a.b-b.b;
    return Math.sqrt(dr*dr+dg*dg+db*db);
  }
  function decalTexture(bg,fg,sponsor,number,variant){
    const key=`${bg}:${fg}:${sponsor}:${number}:${variant}`;if(decalCache.has(key))return decalCache.get(key);
    const c=document.createElement('canvas');c.width=512;c.height=192;const g=c.getContext('2d');
    g.fillStyle=css(bg);g.fillRect(0,0,c.width,c.height);
    if(variant%2===0){g.fillStyle=css(fg);g.beginPath();g.moveTo(0,142);g.lineTo(330,0);g.lineTo(512,0);g.lineTo(512,42);g.lineTo(170,192);g.lineTo(0,192);g.closePath();g.fill();}
    else{g.fillStyle=css(fg);g.fillRect(0,0,84,c.height);g.fillRect(108,0,18,c.height);}
    g.fillStyle='#ffffff';g.strokeStyle='#111111';g.lineWidth=8;g.font='900 74px -apple-system,BlinkMacSystemFont,sans-serif';g.textBaseline='middle';g.textAlign='left';g.strokeText(String(number).padStart(2,'0'),22,85);g.fillText(String(number).padStart(2,'0'),22,85);
    g.font='900 38px -apple-system,BlinkMacSystemFont,sans-serif';g.textAlign='right';g.strokeText(sponsor,490,145);g.fillText(sponsor,490,145);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;decalCache.set(key,t);return t;
  }
  function decalMaterial(texture){return new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});}
  function add(group,geo,mat,x,y,z,rx=0,ry=0,rz=0,name='LIVERY_PART'){
    const m=new THREE.Mesh(geo,mat);m.name=name;m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=false;m.receiveShadow=false;m.renderOrder=4;group.add(m);return m;
  }
  function attachLivery(root,color,type){
    const d=root.userData?.dims||{length:7,width:3},h=hash(color,type);
    let secondary=accentPalette[(h>>>3)%accentPalette.length];
    const tertiary=tertiaryPalette[(h>>>9)%tertiaryPalette.length],sponsor=sponsors[(h>>>15)%sponsors.length],number=1+((h>>>20)%99),variant=(h>>>28)%4;
    // Keep a visible contrast even when the generated accent lands too close to the base colour.
    const baseColor=new THREE.Color(color>>>0),secColor=new THREE.Color(secondary);
    if(rgbDistance(baseColor,secColor)<.28)secondary=secondary===0xf4f4f0?0x111317:0xf4f4f0;
    const group=new THREE.Group();group.name='RACING_LIVERY_V1';
    // Attach to the simulation root, not the procedural visual. Imported GLB cars
    // detach the old visual hierarchy after loading; the livery must survive that
    // replacement so GT/touring/supercar assets keep their team graphics too.
    root.add(group);
    const sec=paint(secondary,.10,.22),third=paint(tertiary,.08,.27),L=d.length,Wd=d.width;
    const sideX=Wd*.405,sideY=type==='formula'?.64:.67,sideZ=type==='formula'?.20:-.08;
    // Two paint graphics per side: a broad sweep plus a narrow tertiary pin-stripe.
    for(const s of[-1,1]){
      add(group,new THREE.PlaneGeometry(L*.56,.34),sec,s*sideX,sideY,sideZ,0,s*Math.PI/2,variant%2?.045*s:-.045*s,'LIVERY_SWEEP');
      add(group,new THREE.PlaneGeometry(L*.48,.065),third,s*(sideX+.008),sideY+.22,sideZ-.10,0,s*Math.PI/2,variant%2?-.025*s:.025*s,'LIVERY_PINSTRIPE');
      const tex=decalTexture(tertiary,secondary,sponsor,number,variant);add(group,new THREE.PlaneGeometry(Math.min(1.62,L*.24),.58),decalMaterial(tex),s*(sideX+.015),sideY+.12,-L*.10,0,s*Math.PI/2,0,'LIVERY_DECAL');
    }
    // A nose/bonnet stripe makes the livery readable from broadcast and chase cameras.
    const topY=type==='formula'?.79:type==='touring'?1.23:type==='gt'?1.02:.88,topZ=type==='formula'?L*.22:L*.18;
    add(group,new THREE.BoxGeometry(Wd*(variant%2?.16:.24),.022,L*.30),sec,0,topY,topZ,0,0,variant===3?.035:0,'LIVERY_TOP_STRIPE');
    add(group,new THREE.BoxGeometry(Wd*.045,.025,L*.34),third,(variant%2?1:-1)*Wd*.16,topY+.004,topZ,0,0,variant===2?-.025:0,'LIVERY_TOP_PIN');
    root.userData.livery={version:2,scheme:variant,primary:color>>>0,secondary:secondary>>>0,tertiary:tertiary>>>0,sponsor,number,parts:8,group};
    return root;
  }
  W.makeCar=(color,type)=>attachLivery(baseMake(color,type),color,type);
  const baseLOD=W.updateVehicleLOD?.bind(W);
  W.updateVehicleLOD=(cars=[])=>{
    baseLOD?.(cars);const cp=W.camera?.position;if(!cp)return;
    for(const c of cars){const g=c?.mesh?.userData?.livery?.group;if(g)g.visible=c.mesh.visible!==false&&cp.distanceTo(c.mesh.position)<180;}
  };
  return W;
}
