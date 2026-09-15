import {buildWorld as buildV33World} from './v33-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV33World(THREE,TRACK,settings,circuitName),baseMake=W.makeCar.bind(W);
  const target={
    formula:{length:5.50,width:1.90,heightScale:.86},
    gt:{length:5.05,width:2.05,heightScale:.90},
    proto:{length:5.10,width:2.00,heightScale:.90},
    hyper:{length:5.05,width:2.00,heightScale:.90},
    lmh:{length:5.05,width:2.00,heightScale:.90},
    touring:{length:4.80,width:1.95,heightScale:.92},
    supercar:{length:4.75,width:2.00,heightScale:.92}
  };
  W.makeCar=(color,type)=>{
    const car=baseMake(color,type),d=car.userData?.dims,t=target[type]||target.gt;
    if(!d)return car;
    const sx=t.width/d.width,sz=t.length/d.length,sy=t.heightScale;
    car.scale.set(sx,sy,sz);
    car.userData.originalDims={...d};car.userData.dims={length:t.length,width:t.width};
    const a=car.userData.cameraAnchors;if(a){for(const k of Object.keys(a)){const v=a[k];if(Array.isArray(v)&&v.length>=3)a[k]=[v[0]*sx,v[1]*sy,v[2]*sz];}}
    car.userData.realScale={sx,sy,sz,target:{...t}};
    return car;
  };
  W.roadWidth=14.4;
  W.vehicleDimensionTargets=target;
  return W;
}
