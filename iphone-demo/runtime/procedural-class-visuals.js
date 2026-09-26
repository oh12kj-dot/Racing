export function enhanceProceduralClassVisuals(W,THREE,{mobile=false}={}){
  if(!W?.makeCar||!THREE)return{owner:'runtime-procedural-class-polish-v1',enabled:false};
  const base=W.makeCar.bind(W),target=new Set(['formula','proto','hyper','lmh']),counts={formula:0,proto:0,hyper:0,lmh:0};
  const carbon=new THREE.MeshStandardMaterial({color:0x101316,metalness:.58,roughness:.30});
  const dark=new THREE.MeshStandardMaterial({color:0x24292d,metalness:.42,roughness:.38});
  const lamp=new THREE.MeshStandardMaterial({color:0xf4f7ff,emissive:0xe9f2ff,emissiveIntensity:1.1,roughness:.28});
  const accentCache=new Map();
  const accent=color=>{const k=Number(color)>>>0;if(!accentCache.has(k)){const c=new THREE.Color(k).offsetHSL(.01,.08,-.08);accentCache.set(k,new THREE.MeshStandardMaterial({color:c,metalness:.28,roughness:.25}));}return accentCache.get(k);};
  function polish(root,color,type){
    if(!target.has(type)||root.getObjectByName?.('RUNTIME_CLASS_POLISH_V1'))return root;
    const visual=root.userData?.visual||root,g=new THREE.Group();g.name='RUNTIME_CLASS_POLISH_V1';visual.add(g);let parts=0;
    const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=!mobile;m.receiveShadow=true;g.add(m);parts++;return m;};
    const box=(w,h,l,mat,x,y,z,rx=0,ry=0,rz=0)=>add(new THREE.BoxGeometry(w,h,l),mat,x,y,z,rx,ry,rz);
    if(type==='formula'){
      for(const x of[-1.48,1.48]){box(.10,.55,.48,carbon,x,.52,4.40);box(.10,.44,.42,carbon,x*.86,1.08,-2.18);}
      for(const x of[-.79,.79])box(.06,.12,3.05,carbon,x,.25,-.15);
      for(const x of[-.58,.58])box(.32,.06,.18,accent(color),x,.49,3.55,0,0,x<0?.18:-.18);
      box(.08,.66,1.38,carbon,0,1.08,-.82,0,0,-.04);
    }else if(type==='proto'){
      for(const x of[-1.00,1.00]){box(.58,.055,.34,carbon,x,.47,2.52,0,0,x<0?.13:-.13);box(.08,.24,.72,carbon,x*.72,.28,-2.80);}
      box(.065,.72,1.82,carbon,0,1.03,-.72,0,0,-.10);
      for(const x of[-.75,.75])box(.36,.06,.22,accent(color),x,.58,2.76,0,0,x<0?.20:-.20);
      for(const x of[-.64,.64])box(.08,.30,.78,carbon,x,.31,-2.91);
    }else{
      const a=accent(color);
      for(const x of[-1.06,1.06]){box(.42,.06,.32,carbon,x,.48,2.48,0,0,x<0?.16:-.16);box(.12,.28,1.06,a,x,.63,1.66);}
      box(.07,.68,1.54,carbon,0,1.02,-.62,0,0,-.08);
      for(const x of[-.62,.62])box(.07,.28,.86,carbon,x,.29,-2.77);
      for(const x of[-.68,.68])box(.26,.08,.12,lamp,x,.58,2.68);
    }
    root.userData.proceduralClassPolish={owner:'runtime-procedural-class-polish-v1',type,parts,group:g};counts[type]=(counts[type]||0)+parts;return root;
  }
  W.makeCar=(color,type)=>polish(base(color,type),color,type);
  const state={owner:'runtime-procedural-class-polish-v1',enabled:true,targetTypes:[...target],counts,mobile};W.proceduralClassVisuals=state;return state;
}
