export function createSceneQualityController(W,{mobile=false}={}){
  let level=-1,lastCars=[];
  const rubber=W.scene.getObjectByName?.('RUNTIME_VISUAL_ENHANCEMENTS');
  const garage=W.scene.getObjectByName?.('PIT_ALIGNED_ENTRANCES_RUNTIME');
  const braking=()=>W.scene.getObjectByName?.('BRAKING_RUBBER_TRACES');
  function apply(next,cars=lastCars){
    lastCars=cars||lastCars;next=Math.max(0,Math.min(3,Number(next)||0));if(next===level&&cars===lastCars)return;level=next;
    const b=braking();if(b)b.visible=level<3;
    if(garage)garage.traverse(o=>{if(o.isMesh&&o.material?.emissive)o.visible=level<3;});
    const maxContact=mobile?(level>=3?95:level>=2?135:185):(level>=3?170:level>=2?220:300);
    for(const c of lastCars||[]){const s=c?.mesh?.userData?.contactShadow;if(s)s.visible=W.camera.position.distanceTo(c.mesh.position)<maxContact;}
    if(rubber)rubber.userData.qualityLevel=level;
    W.runtimeSceneQuality={level,maxContactShadowDistance:maxContact,brakeMarksVisible:level<3,garagePracticalLights:level<3};
    return W.runtimeSceneQuality;
  }
  return{apply,get level(){return level},get state(){return W.runtimeSceneQuality}};
}
