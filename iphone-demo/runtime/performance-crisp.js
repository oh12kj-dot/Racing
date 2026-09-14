import {createPerformanceManager as createBasePerformanceManager} from './performance.js';

export function createPerformanceManager(W,settings={},mobile=false){
  const P=createBasePerformanceManager(W,settings,mobile),renderer=W.renderer;
  function floor(){
    if(P.mode==='BATTERY'||P.mode==='COOL')return Number(P.config.targetDpr)||renderer.getPixelRatio();
    if(P.level>=3)return mobile?1.05:1.15;
    if(P.level>=2)return mobile?1.20:1.30;
    if(P.mode==='QUALITY')return mobile?1.55:1.75;
    return mobile?1.35:1.50;
  }
  function sharpen(){
    const device=Number(globalThis.devicePixelRatio)||1,max=mobile?1.75:2.0,base=Number(P.config.targetDpr)||renderer.getPixelRatio(),target=Math.min(device,max,Math.max(base,floor()));
    if(Math.abs(renderer.getPixelRatio()-target)>.02)renderer.setPixelRatio(target);
    return target;
  }
  sharpen();
  return new Proxy(P,{get(target,prop){
    if(prop==='observe')return(...args)=>{const r=target.observe(...args);sharpen();return r;};
    if(prop==='resize')return(...args)=>{const r=target.resize(...args);sharpen();return r;};
    if(prop==='apply')return(...args)=>{const r=target.apply(...args);sharpen();return r;};
    if(prop==='config')return{...target.config,targetDpr:renderer.getPixelRatio(),crispFloor:floor()};
    if(prop==='crispPolicy')return{owner:'runtime-crisp-distant-v1',targetDpr:renderer.getPixelRatio(),floor:floor(),max:mobile?1.75:2.0};
    return Reflect.get(target,prop,target);
  }});
}
