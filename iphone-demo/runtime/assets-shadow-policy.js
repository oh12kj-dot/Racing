import {createRenderAssetManager as createBaseRenderAssetManager} from './assets.js';

// GLB vehicle upgrades are attached after the procedural car has been created.
// Re-apply the moving-vehicle shadow policy after asynchronous asset replacement
// so imported meshes cannot re-enable the low-frequency directional shadow.
export function createRenderAssetManager(W,options={}){
  const base=createBaseRenderAssetManager(W,options);
  const disableDynamicVehicleShadows=cars=>{
    for(const car of cars||[]){
      const root=car?.mesh,contact=root?.userData?.contactShadow;
      root?.traverse?.(o=>{if(o?.isMesh&&o!==contact)o.castShadow=false;});
      if(root?.userData)root.userData.vehicleShadowPolicy='contact-shadow-live-v1';
    }
  };
  return new Proxy(base,{get(target,prop){
    if(prop==='upgradeCars')return async(cars=[])=>{const r=await target.upgradeCars(cars);disableDynamicVehicleShadows(cars);return r;};
    return Reflect.get(target,prop,target);
  }});
}
