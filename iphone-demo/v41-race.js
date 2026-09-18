import {createRace as createRuntimeRace} from './runtime/race-base.js';

export function createRace(W,statusEl,settings={}){
  if(typeof W?.racingCurvatureDemandFor!=='function')return createRuntimeRace(W,statusEl,settings);
  const planningWorld=new Proxy(W,{get(target,prop,receiver){
    if(prop==='racingCurvatureFor')return target.racingCurvatureDemandFor.bind(target);
    return Reflect.get(target,prop,receiver);
  }});
  return createRuntimeRace(planningWorld,statusEl,settings);
}
