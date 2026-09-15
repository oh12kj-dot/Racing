import {enhanceVisuals as enhanceBaseVisuals} from './visuals-hybrid-shadow.js';

export function enhanceVisuals(W,settings={},mobile=false){
  const result=enhanceBaseVisuals(W,settings,mobile),maxCasters=mobile?2:3,selected=new Set(),bestCars=new Array(maxCasters),bestDist=new Float64Array(maxCasters),stats={changed:false,casters:0,updates:0};
  let previousKey='';
  const setCaster=(car,on)=>{const root=car?.mesh;if(!root)return;const contact=root.userData?.contactShadow;root.traverse?.(o=>{if(o?.isMesh&&o!==contact)o.castShadow=!!on;});if(contact)contact.castShadow=false;root.userData.vehicleShadowPolicy=on?'hybrid-near-real+contact':'hybrid-contact-only';};
  W.updateHybridVehicleShadows=(cars=[],force=false)=>{
    for(let i=0;i<maxCasters;i++){bestCars[i]=null;bestDist[i]=Infinity;}
    for(const c of cars){if(c?.retired||c?.mesh?.visible===false||!c?.mesh)continue;const d=W.camera.position.distanceToSquared(c.mesh.position);let slot=-1;for(let i=0;i<maxCasters;i++)if(d<bestDist[i]){slot=i;break;}if(slot<0)continue;for(let i=maxCasters-1;i>slot;i--){bestDist[i]=bestDist[i-1];bestCars[i]=bestCars[i-1];}bestDist[slot]=d;bestCars[slot]=c;}
    let key='';for(let i=0;i<maxCasters;i++)if(bestCars[i])key+=`${bestCars[i].id??bestCars[i].mesh?.uuid??i},`;
    if(!force&&key===previousKey){stats.changed=false;stats.casters=selected.size;return stats;}
    previousKey=key;selected.clear();for(const c of bestCars)if(c)selected.add(c);for(const c of cars)setCaster(c,selected.has(c));stats.changed=true;stats.casters=selected.size;stats.updates++;return stats;
  };
  W.hybridShadowPolicy={...(W.hybridShadowPolicy||{}),owner:'runtime-hybrid-vehicle-shadow-v1',selectionPolicy:'allocation-free-nearest-v2',contactShadowAll:true,realDirectionalNear:true,maxCasters,selected};
  return{...result,hybridVehicleShadows:true,maxRealShadowCasters:maxCasters,allocationFreeSelection:true};
}
