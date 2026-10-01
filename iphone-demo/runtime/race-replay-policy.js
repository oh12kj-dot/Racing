import {createRace as createV6Race} from './race-core.js';

export function createRace(W,statusEl){
  const base=createV6Race(W,statusEl);
  return new Proxy(base,{
    get(target,prop){
      if(prop==='startReplay')return()=>false;
      if(prop==='history'||prop==='replay')return undefined;
      return Reflect.get(target,prop,target);
    },
    has(target,prop){
      if(prop==='startReplay'||prop==='history'||prop==='replay')return false;
      return Reflect.has(target,prop);
    }
  });
}
