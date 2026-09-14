import {createAudio as createStableAudio} from './audio.js';

export function createAudio(R,settings={}){
  const session=typeof navigator!=='undefined'?navigator.audioSession:null,synth=typeof window!=='undefined'?window.speechSynthesis:null;
  let patched=false;
  const forceAmbient=()=>{if(!session)return false;try{session.type='ambient';return session.type==='ambient'||true;}catch{return false;}};
  forceAmbient();

  // iOS WebAudio is an ambient session and therefore follows the hardware silent
  // switch. Web Speech can select its own route, so force the aggregate page
  // session back to ambient immediately before every utterance is submitted.
  if(session&&synth&&typeof synth.speak==='function'&&!synth.__racingAmbientSpeakPatched){
    const nativeSpeak=synth.speak.bind(synth),wrapped=utterance=>{forceAmbient();return nativeSpeak(utterance);};
    try{synth.speak=wrapped;patched=synth.speak===wrapped;}catch{}
    if(!patched){try{Object.defineProperty(synth,'speak',{configurable:true,value:wrapped});patched=synth.speak===wrapped;}catch{}}
    if(patched){try{Object.defineProperty(synth,'__racingAmbientSpeakPatched',{configurable:true,value:true});}catch{synth.__racingAmbientSpeakPatched=true;}}
  }

  const A=createStableAudio(R,settings);
  return new Proxy(A,{get(target,prop){
    if(prop==='sessionPolicy')return{desired:'ambient',supported:!!session,speechHook:patched,current:session?.type||'unsupported'};
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
}
