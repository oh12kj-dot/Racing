import {createRace as createBaseRace} from './race-strategy-dynamics.js';
import {installRuntimeOptimizations} from './performance-runtime.js';

export function createRace(W,statusEl,settings={}){
  const R=createBaseRace(W,statusEl,settings),mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760,O=installRuntimeOptimizations(W,R,{mobile}),baseUpdate=R.update;
  function update(dt){O.beforeRace();return baseUpdate(dt);}
  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='runtimeOptimizations')return O.diagnostics();
    return Reflect.get(target,prop,target);
  }});
}
