export function createSelectiveGlow(W,cars=[],{mobile=false}={}){
  const T=W.THREE,items=[];
  if(mobile){
    W.runtimeSelectiveGlow={enabled:false,reason:'mobile-budget',count:0,state:{enabled:false,count:0,qualityLevel:0,maxDistance:0},update:()=>W.runtimeSelectiveGlow.state};
    return W.runtimeSelectiveGlow;
  }

  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const g=canvas.getContext('2d'),grad=g.createRadialGradient(32,32,2,32,32,31);
  grad.addColorStop(0,'rgba(255,255,255,.92)');grad.addColorStop(.18,'rgba(255,255,255,.60)');grad.addColorStop(.55,'rgba(255,255,255,.16)');grad.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=grad;g.fillRect(0,0,64,64);
  const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;

  function addGlow(mesh,kind='vehicle'){
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material],m=mats.find(x=>x?.emissive&&Number(x.emissiveIntensity)>0.22);if(!m)return;
    mesh.geometry?.computeBoundingSphere?.();const r=mesh.geometry?.boundingSphere?.radius||.2;if(kind==='vehicle'&&r>1.05)return;
    const color=m.emissive.clone?.()||new T.Color(0xffffff),mat=new T.SpriteMaterial({map:tex,color,transparent:true,opacity:kind==='vehicle'?.42:.24,depthWrite:false,depthTest:true,blending:T.AdditiveBlending,toneMapped:false});
    const s=new T.Sprite(mat),scale=kind==='vehicle'?Math.max(.72,Math.min(1.65,r*4.2)):Math.max(1.0,Math.min(2.2,r*1.1));
    s.name='RUNTIME_SELECTIVE_GLOW';s.scale.set(scale,scale,1);s.renderOrder=3;mesh.add(s);items.push({sprite:s,mesh,base:mat.opacity,kind});
  }
  for(const c of cars||[])c?.mesh?.traverse?.(o=>{if(o.isMesh)addGlow(o,'vehicle');});
  const pit=W.scene.getObjectByName?.('PIT_ALIGNED_ENTRANCES_RUNTIME');
  pit?.traverse?.(o=>{if(o.isMesh&&o.material?.emissive&&Number(o.material.emissiveIntensity)>.4)addGlow(o,'pit');});

  const runtime={enabled:true,count:items.length,texture:tex,state:null,update:null,dispose:()=>{for(const x of items)x.sprite.material.dispose?.();tex.dispose?.();}};
  W.runtimeSelectiveGlow=runtime;
  function update(level=0){
    const day=Math.max(0,Math.min(1,Number(W.env?.skyState?.day??1))),rain=Math.max(0,Math.min(1,Number(W.env?.rain)||0)),maxDist=level>=2?150:260;
    for(const x of items){
      const world=new T.Vector3();x.mesh.getWorldPosition(world);const d=W.camera.position.distanceTo(world),nightBoost=.75+(1-day)*.75+rain*.22;
      x.sprite.visible=level<3&&d<maxDist;x.sprite.material.opacity=x.base*nightBoost*Math.max(.18,1-d/maxDist*.55);
    }
    runtime.state={enabled:true,count:items.length,qualityLevel:level,maxDistance:maxDist};return runtime.state;
  }
  runtime.update=update;update(0);
  return runtime;
}
