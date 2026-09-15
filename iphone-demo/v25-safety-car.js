export function createSafetyCar(W,R){
  const T=W.THREE,mesh=W.makeCar(0xcfff00,'supercar');
  mesh.visible=false;W.scene.add(mesh);
  const visual=mesh.userData.visual||mesh,d=mesh.userData.dims||{length:6.5,width:3};
  const black=new T.MeshStandardMaterial({color:0x080b0d,roughness:.30,metalness:.24});
  const white=new T.MeshStandardMaterial({color:0xf4f7f5,roughness:.34,metalness:.12});
  const amberA=new T.MeshStandardMaterial({color:0x5a2800,emissive:0xff9d00,emissiveIntensity:.3,roughness:.24});
  const amberB=amberA.clone();
  const add=(geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;visual.add(m);return m;};
  add(new T.BoxGeometry(d.width*.72,.045,d.length*.54),black,0,.86,-.05);
  add(new T.BoxGeometry(d.width*.12,.052,d.length*.78),white,0,.90,.02);
  for(const s of[-1,1]){const stripe=add(new T.BoxGeometry(d.width*.16,.05,d.length*.44),black,s*d.width*.31,.74,.12,0,s*.18,0);stripe.rotation.y=s*.12;add(new T.BoxGeometry(d.width*.12,.055,.75),white,s*d.width*.27,.76,d.length*.30,0,s*.28,0);}
  const bar=new T.Group();bar.position.set(0,1.72,-.10);visual.add(bar);bar.add(new T.Mesh(new T.BoxGeometry(1.62,.10,.28),black));
  const lights=[];for(let i=0;i<6;i++){const mat=i%2?amberA:amberB,l=new T.Mesh(new T.BoxGeometry(.22,.14,.24),mat);l.position.set((i-2.5)*.25,.10,0);bar.add(l);lights.push(l);}
  for(const s of[-1,1]){add(new T.BoxGeometry(.22,.11,.06),amberA,s*.72,.65,d.length*.46);add(new T.BoxGeometry(.22,.11,.06),amberB,s*.72,.72,-d.length*.46);}
  const c=document.createElement('canvas');c.width=512;c.height=160;const g=c.getContext('2d');g.fillStyle='#090b0c';g.fillRect(0,0,512,160);g.strokeStyle='#d7ff00';g.lineWidth=10;g.strokeRect(6,6,500,148);g.fillStyle='#fff';g.font='900 62px -apple-system,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('SAFETY CAR',256,82);const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
  const sign=new T.Mesh(new T.PlaneGeometry(1.92,.60),new T.MeshBasicMaterial({map:tex,side:T.DoubleSide}));sign.position.set(0,1.34,-d.length*.25);sign.rotation.y=Math.PI;visual.add(sign);
  let time=0;
  function update(dt=.016){
    time+=Math.min(.05,Math.max(0,dt));
    if(R.flag!=='SC'){mesh.visible=false;return;}
    const leader=R.getStandings()[0];if(!leader){mesh.visible=false;return;}
    const q=W.sample(leader.s+38,0);mesh.visible=true;mesh.position.copy(q.p);mesh.position.y+=.12;mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
    const a=Math.sin(time*15)>0,b=Math.sin(time*15+Math.PI)>0;amberA.emissiveIntensity=a?4.8:.22;amberB.emissiveIntensity=b?4.8:.22;for(const l of lights)l.scale.y=.88+(l.material.emissiveIntensity>1?.20:0);
  }
  return{update,mesh};
}
