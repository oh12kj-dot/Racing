import {createPerformanceManager as createBasePerformanceManager} from './performance-crisp.js';

export function createPerformanceManager(W,settings={},mobile=false){
  const P=createBasePerformanceManager(W,settings,mobile);
  function hybridHz(){
    if(P.mode==='BATTERY')return 0;
    if(P.mode==='COOL')return 3;
    if(P.level>=3)return 3;
    if(P.level>=2)return mobile?5:7;
    if(P.mode==='QUALITY')return mobile?12:18;
    return mobile?8:12;
  }
  return new Proxy(P,{get(target,prop){
    if(prop==='interval')return name=>name==='shadow'?(hybridHz()>0?1/hybridHz():Infinity):target.interval(name);
    if(prop==='hybridShadowHz')return hybridHz();
    if(prop==='hybridShadowPolicy')return{owner:'runtime-hybrid-shadow-budget-v1',hz:hybridHz(),maxCasters:W.hybridShadowPolicy?.maxCasters??(mobile?2:3)};
    return Reflect.get(target,prop,target);
  }});
}
