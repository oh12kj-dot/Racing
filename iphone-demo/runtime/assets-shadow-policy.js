import {createRenderAssetManager as createBaseRenderAssetManager} from './assets.js';

// GLB vehicle upgrades arrive asynchronously. Keep them out of the shadow map by
// default, then let the hybrid selector re-enable only the few cars nearest camera.
export function createRenderAssetManager(W,options={}){
  const base=createBaseRenderAssetManager(W,options);
  const prepareHybrid=cars=>{
    for(const car of cars||[]){
      const root=car?.mesh,contact=root?.userData?.contactShadow,meshes=[];
      root?.traverse?.(o=>{if(o?.isMesh&&o!==contact){o.castShadow=false;meshes.push(o);}});
      if(root?.userData){root.userData.hybridShadowMeshes=meshes;root.userData.vehicleShadowPolicy='hybrid-contact-only';}
    }
    W.updateHybridVehicleShadows?.(cars,true);
  };
  return new Proxy(base,{get(target,prop){
    if(prop==='upgradeCars')return async(cars=[])=>{const r=await target.upgradeCars(cars);prepareHybrid(cars);return r;};
    return Reflect.get(target,prop,target);
  }});
}
