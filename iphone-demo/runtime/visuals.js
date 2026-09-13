export function enhanceVisuals(W,settings={},mobile=false){
  const T=W.THREE,scene=W.scene,renderer=W.renderer,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const root=new T.Group();root.name='RUNTIME_VISUAL_ENHANCEMENTS';scene.add(root);

  // --- Texture clarity -----------------------------------------------------
  // Oblique asphalt/grass textures are a major source of blur in broadcast shots.
  // Moderate anisotropy is inexpensive compared with increasing render scale.
  const maxAniso=renderer.capabilities?.getMaxAnisotropy?.()||1;
  const desiredAniso=Math.min(maxAniso,mobile?4:8),seenTextures=new Set();
  const textureKeys=['map','normalMap','roughnessMap','metalnessMap','bumpMap','alphaMap','emissiveMap'];
  scene.traverse(o=>{
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const m of mats){
      if(!m)continue;
      for(const key of textureKeys){const tex=m[key];if(!tex||seenTextures.has(tex))continue;seenTextures.add(tex);tex.anisotropy=Math.max(tex.anisotropy||1,desiredAniso);}
    }
  });

  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  if('environmentIntensity' in scene)scene.environmentIntensity=.92;

  // Keep the shadow camera centred on the broadcast subject (runtime/camera.js)
  // and use a smaller projection than the original +/-420 m box. This improves
  // the visible contact/shadow definition without increasing shadow-map size.
  if(W.sun?.shadow?.camera){
    const c=W.sun.shadow.camera;c.left=-185;c.right=185;c.top=185;c.bottom=-185;c.near=45;c.far=950;c.updateProjectionMatrix?.();
    W.sun.shadow.bias=-.00012;W.sun.shadow.normalBias=.030;
  }

  // --- Road material response ---------------------------------------------
  const roadRecords=[],seenMaterials=new Set();
  scene.traverse(o=>{
    if(!o?.isMesh)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const m of mats){
      if(!m||seenMaterials.has(m)||(!m.isMeshStandardMaterial&&!m.isMeshPhysicalMaterial))continue;
      const hex=m.color?.getHex?.()??-1;
      const isMainAsphalt=!!m.bumpMap&&m.roughness>=.72;
      const isPitAsphalt=hex===0x303438&&m.roughness>=.80;
      if(!isMainAsphalt&&!isPitAsphalt)continue;
      seenMaterials.add(m);roadRecords.push({m,rough:m.roughness,metal:m.metalness||0,env:Number.isFinite(m.envMapIntensity)?m.envMapIntensity:1});
    }
  });

  // --- Racing-line rubber and braking traces ------------------------------
  function ribbon(sideOffset,halfWidth=.16){
    const N=clamp(Math.round(W.total/7),560,980),pos=[],ind=[];
    for(let i=0;i<N;i++){
      const s=W.total*i/N,line=W.racingLineFor?.(s,'OPTIMAL')??W.racingLineAt?.(s)??0,q=W.sample(s,line+sideOffset),l=q.p.clone().addScaledVector(q.side,-halfWidth),r=q.p.clone().addScaledVector(q.side,halfWidth);
      l.y+=.058;r.y+=.058;pos.push(l.x,l.y,l.z,r.x,r.y,r.z);
    }
    for(let i=0;i<N;i++){const j=(i+1)%N,a=i*2,b=a+1,c=j*2,d=c+1;ind.push(a,b,c,b,d,c);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();
    const m=new T.MeshStandardMaterial({color:0x111315,roughness:.78,transparent:true,opacity:.15,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,side:T.DoubleSide});
    const mesh=new T.Mesh(g,m);mesh.name='RUBBERED_RACING_LINE';mesh.receiveShadow=true;mesh.renderOrder=1;root.add(mesh);return mesh;
  }
  ribbon(-.73,.17);ribbon(.73,.17);

  const markGeo=new T.BoxGeometry(.22,.012,3.3),markMat=new T.MeshStandardMaterial({color:0x090a0b,roughness:.72,transparent:true,opacity:.22,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});
  const markData=[];
  for(let s=0;s<W.total&&markData.length<260;s+=8.5){
    const brake=W.braking?.(s)||0;if(brake<.62)continue;
    const line=W.racingLineFor?.(s,'OPTIMAL')??W.racingLineAt?.(s)??0;
    for(const off of[-.73,.73]){const q=W.sample(s,line+off);markData.push({p:q.p.clone(),yaw:Math.atan2(q.t.x,q.t.z)});}
  }
  if(markData.length){
    const inst=new T.InstancedMesh(markGeo,markMat,markData.length),tmp=new T.Object3D();inst.name='BRAKING_RUBBER_TRACES';
    markData.forEach((x,i)=>{tmp.position.copy(x.p);tmp.position.y+=.061;tmp.rotation.set(0,x.yaw,0);tmp.updateMatrix();inst.setMatrixAt(i,tmp.matrix);});
    inst.instanceMatrix.needsUpdate=true;inst.receiveShadow=true;inst.renderOrder=1;root.add(inst);
  }

  // --- Cheap per-car contact shadow ---------------------------------------
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;
  const sg=shadowCanvas.getContext('2d'),grad=sg.createRadialGradient(64,64,5,64,64,62);grad.addColorStop(0,'rgba(0,0,0,.82)');grad.addColorStop(.48,'rgba(0,0,0,.48)');grad.addColorStop(1,'rgba(0,0,0,0)');sg.fillStyle=grad;sg.fillRect(0,0,128,128);
  const shadowTex=new T.CanvasTexture(shadowCanvas);shadowTex.colorSpace=T.NoColorSpace;
  const contactMat=new T.MeshBasicMaterial({map:shadowTex,transparent:true,opacity:.25,depthWrite:false,toneMapped:false,side:T.DoubleSide});
  const contactGeo=new T.PlaneGeometry(1,1),baseMakeCar=W.makeCar?.bind(W);
  if(baseMakeCar){
    W.makeCar=(color,type)=>{
      const car=baseMakeCar(color,type),d=car.userData?.dims||{width:3,length:6.8},s=new T.Mesh(contactGeo,contactMat);
      s.name='CAR_CONTACT_SHADOW';s.rotation.x=-Math.PI/2;s.position.y=-.035;s.scale.set(d.width*1.16,d.length*.80,1);s.castShadow=false;s.receiveShadow=false;s.renderOrder=0;car.add(s);car.userData.contactShadow=s;return car;
    };
  }
  const baseLOD=W.updateVehicleLOD?.bind(W);
  W.updateVehicleLOD=(cars=[])=>{
    baseLOD?.(cars);
    const maxDist=mobile?185:280;
    for(const c of cars){const s=c?.mesh?.userData?.contactShadow;if(s)s.visible=W.camera.position.distanceTo(c.mesh.position)<maxDist;}
  };

  // --- Pit-garage practical lighting --------------------------------------
  const garageLightMat=new T.MeshStandardMaterial({color:0xfff6df,emissive:0xffe7b5,emissiveIntensity:1.2,roughness:.42});
  const garageLightGeo=new T.BoxGeometry(.09,.12,5.6),aligned=scene.getObjectByName?.('PIT_ALIGNED_ENTRANCES_RUNTIME');
  if(aligned){
    for(const g of aligned.children){
      const door=g.children.find(x=>x.geometry?.type==='PlaneGeometry'&&Math.abs((x.geometry.parameters?.height||0)-2.72)<.08);
      const x=door?.position?.x??-6.68,light=new T.Mesh(garageLightGeo,garageLightMat);light.position.set(x+.12,2.98,0);light.castShadow=false;g.add(light);
    }
  }

  function updateVisualWeather(){
    const wet=clamp(Math.max(Number(W.env?.wetness)||0,(Number(W.env?.rain)||0)*.50),0,1),rain=clamp(Number(W.env?.rain)||0,0,1),cloud=clamp(Number(W.env?.cloud)||0,0,1),day=clamp(Number(W.env?.skyState?.day??1),0,1);
    for(const r of roadRecords){
      r.m.roughness=lerp(r.rough,.46,wet*.82);
      r.m.metalness=clamp(r.metal+wet*.035,0,.12);
      r.m.envMapIntensity=Math.max(.35,r.env)+wet*.72;
    }
    contactMat.opacity=clamp(.14+day*.12-rain*.065,.10,.27);
    garageLightMat.emissiveIntensity=.55+(1-day)*2.3+cloud*.30;
    if(scene.fog){scene.fog.near=lerp(900,520,rain);scene.fog.far=lerp(3300,1850,rain*.86+cloud*.10);}
  }
  W.updateVisualWeather=updateVisualWeather;updateVisualWeather();
  W.visualEnhancements={root,roadMaterialCount:roadRecords.length,anisotropy:desiredAniso,rubberStrips:2,brakeMarks:markData.length,contactShadows:true,garageLights:aligned?.children?.length||0};
  return W.visualEnhancements;
}
