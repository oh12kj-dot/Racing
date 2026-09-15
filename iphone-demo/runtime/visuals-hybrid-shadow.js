import {enhanceVisuals as enhanceBaseVisuals} from './visuals-shadow-policy.js';

// Contact shadows stay frame-synchronous for every car. A very small set of cars
// nearest the active camera may additionally cast the real directional shadow.
export function enhanceVisuals(W,settings={},mobile=false){
  const result=enhanceBaseVisuals(W,settings,mobile),baseMakeCar=W.makeCar?.bind(W);
  const selected=new Set();let selectionKey='';
  const maxCasters=mobile?2:3;

  function collect(root){
    const contact=root?.userData?.contactShadow,meshes=[];
    root?.traverse?.(o=>{if(o?.isMesh&&o!==contact)meshes.push(o);});
    if(root?.userData)root.userData.hybridShadowMeshes=meshes;
    return meshes;
  }
  function setCaster(car,on){
    const root=car?.mesh;if(!root)return;
    // Refresh the mesh list whenever the caster selection changes. Additional
    // procedural/LOD meshes can be attached after makeCar(), so a creation-time
    // cache alone can leave one stale castShadow=true mesh on every vehicle.
    const contact=root.userData?.contactShadow,meshes=collect(root);
    for(const m of meshes)m.castShadow=!!on;
    if(contact)contact.castShadow=false;
    root.userData.vehicleShadowPolicy=on?'hybrid-near-real+contact':'hybrid-contact-only';
  }
  if(baseMakeCar){
    W.makeCar=(color,type)=>{const car=baseMakeCar(color,type);setCaster({mesh:car},false);return car;};
  }

  W.updateHybridVehicleShadows=(cars=[],force=false)=>{
    const ranked=(cars||[]).filter(c=>!c.retired&&c.mesh?.visible!==false).map(c=>({c,d:W.camera.position.distanceToSquared(c.mesh.position)})).sort((a,b)=>a.d-b.d);
    const next=ranked.slice(0,maxCasters).map(x=>x.c);
    const key=next.map((c,i)=>String(c.id??c.driver?.id??c.mesh?.uuid??`slot-${i}`)).join(',');
    if(!force&&key===selectionKey)return{changed:false,casters:selected.size};
    selectionKey=key;selected.clear();for(const car of next)selected.add(car);
    for(const c of cars)setCaster(c,selected.has(c));
    return{changed:true,casters:selected.size,ids:next.map(c=>c.id??c.driver?.id??c.mesh?.uuid??null)};
  };
  W.hybridShadowPolicy={owner:'runtime-hybrid-vehicle-shadow-v1',contactShadowAll:true,realDirectionalNear:true,maxCasters,selected,selectionHz:8};
  return{...result,hybridVehicleShadows:true,maxRealShadowCasters:maxCasters};
}
