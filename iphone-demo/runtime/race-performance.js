import {createRace as createBaseRace} from './race-strategy-dynamics.js';
import {installRuntimeOptimizations} from './performance-runtime.js';
import {atlasRuntimeCanvasTextures} from './texture-atlas.js';

export function createRace(W,statusEl,settings={}){
  const R=createBaseRace(W,statusEl,settings),mobile=matchMedia?.('(pointer:coarse)')?.matches||innerWidth<760,textureAtlas=atlasRuntimeCanvasTextures(W),O=installRuntimeOptimizations(W,R,{mobile}),baseUpdate=R.update;
  W.runtimeTextureAtlas=textureAtlas;
  function update(dt){O.beforeRace();return baseUpdate(dt);}
  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='runtimeOptimizations')return{...O.diagnostics(),textureAtlas:{...textureAtlas}};
    return Reflect.get(target,prop,target);
  }});
}
