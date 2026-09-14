export function createSafetyCar(W,R){
  const T=W.THREE,mesh=W.makeCar(0x111417,'supercar');
  mesh.visible=false;W.scene.add(mesh);
  const visual=mesh.userData.visual||mesh,d=mesh.userData.dims||{length:6.5,width:3};
  const black=new T.MeshStandardMaterial({color:0x080a0c,roughness:.24,metalness:.48});
  const graphite=new T.MeshStandardMaterial({color:0x191d21,roughness:.28,metalness:.42});
  const white=new T.MeshStandardMaterial({color:0xf1f3f4,roughness:.36,metalness:.10});
  const red=new T.MeshStandardMaterial({color:0xb51018,emissive:0x430000,emissiveIntensity:.35,roughness:.28,metalness:.22});
  const amberA=new T.MeshStandardMaterial({color:0x7a3900,emissive:0xffa000,emissiveIntensity:.25,roughness:.20});
  const amberB=amberA.clone();
  const green=new T.MeshStandardMaterial({color:0x005d28,emissive:0x2dff79,emissiveIntensity:.35,roughness:.18});
  const add=(geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;visual.add(m);return m;};
  add(new T.BoxGeometry(d.width*.74,.055,d.length*.58),graphite,0,.86,-.02);
  for(const s of[-1,1]){add(new T.BoxGeometry(d.width*.11,.060,d.length*.72),red,s*d.width*.30,.89,.00,0,s*.08,0);add(new T.BoxGeometry(d.width*.055,.062,d.length*.48),white,s*d.width*.20,.91,.02,0,s*.05,0);}
  add(new T.BoxGeometry(d.width*.60,.060,.20),red,0,.92,d.length*.39);add(new T.BoxGeometry(d.width*.58,.060,.18),red,0,.92,-d.length*.39);
  const bar=new T.Group();bar.position.set(0,1.78,-.06);visual.add(bar);bar.add(new T.Mesh(new T.BoxGeometry(1.78,.10,.32),black));
  const lights=[];for(let i=0;i<8;i++){const mat=i%2?amberA:amberB,l=new T.Mesh(new T.BoxGeometry(.18,.16,.27),mat);l.position.set((i-3.5)*.215,.11,0);bar.add(l);lights.push(l);}
  const frontLed=[];for(let i=0;i<6;i++){const l=new T.Mesh(new T.BoxGeometry(.19,.055,.035),green);l.position.set((i-2.5)*.22,1.38,d.length*.45);visual.add(l);frontLed.push(l);}
  for(const s of[-1,1]){add(new T.BoxGeometry(.28,.13,.07),amberA,s*d.width*.34,.76,d.length*.47);add(new T.BoxGeometry(.28,.13,.07),amberB,s*d.width*.34,.76,-d.length*.47);}
  const c=document.createElement('canvas');c.width=512;c.height=160;const g=c.getContext('2d');g.fillStyle='#080a0c';g.fillRect(0,0,512,160);g.strokeStyle='#e41f2b';g.lineWidth=10;g.strokeRect(6,6,500,148);g.fillStyle='#fff';g.font='900 60px -apple-system,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('SAFETY CAR',256,82);
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;const sign=new T.Mesh(new T.PlaneGeometry(2.08,.64),new T.MeshBasicMaterial({map:tex,side:T.DoubleSide,transparent:false}));sign.position.set(0,1.38,-d.length*.27);sign.rotation.y=Math.PI;visual.add(sign);
  let time=0;function update(dt=.016){time+=Math.min(.05,Math.max(0,dt));if(R.flag!=='SC'){mesh.visible=false;return;}const leader=R.getStandings()[0];if(!leader){mesh.visible=false;return;}const q=W.sample(leader.s+38,0);mesh.visible=true;mesh.position.copy(q.p);mesh.position.y+=.12;mesh.rotation.y=Math.atan2(q.t.x,q.t.z);const a=Math.sin(time*17)>0,b=Math.sin(time*17+Math.PI)>0;amberA.emissiveIntensity=a?8.0:.18;amberB.emissiveIntensity=b?8.0:.18;green.emissiveIntensity=(Math.sin(time*10)>.45)?3.0:.28;for(const l of lights)l.scale.y=.86+(l.material.emissiveIntensity>1?.34:0);for(const l of frontLed)l.scale.x=.92+(green.emissiveIntensity>1?.18:0);}
  return{update,mesh};
}
