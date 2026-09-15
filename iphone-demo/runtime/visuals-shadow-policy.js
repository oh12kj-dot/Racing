import {enhanceVisuals as enhanceBaseVisuals} from './visuals.js';

// Vehicle shadows used to be rendered into the global directional-light shadow
// map. On mobile that map intentionally updates only a few times per second, so
// the shadow appeared to stamp along behind a 60 fps car. Keep static-world
// shadows, but use the existing per-car contact shadow for moving vehicles.
export function enhanceVisuals(W,settings={},mobile=false){
  const result=enhanceBaseVisuals(W,settings,mobile);
  const baseMakeCar=W.makeCar?.bind(W);
  if(baseMakeCar){
    W.makeCar=(color,type)=>{
      const car=baseMakeCar(color,type),contact=car?.userData?.contactShadow;
      car?.traverse?.(o=>{if(o?.isMesh&&o!==contact)o.castShadow=false;});
      if(contact){
        contact.castShadow=false;contact.receiveShadow=false;
        contact.position.y=-.025;
        contact.scale.x*=1.03;contact.scale.y*=1.035;
        if(contact.material){contact.material.opacity=Math.max(.27,Number(contact.material.opacity)||0);contact.material.needsUpdate=true;}
      }
      car.userData.vehicleShadowPolicy='contact-shadow-live-v1';
      return car;
    };
  }
  W.vehicleShadowPolicy={owner:'runtime-contact-shadow-live-v1',dynamicVehicleShadowMap:false,contactShadow:true,mobileShadowMapHz:mobile?Number(settings?.shadowHz)||null:null};
  return result;
}
