import {createAudio as createStableAudio} from './audio.js';

export const RADIO_SPEECH_RATE=Object.freeze({driver:1.08,engineer:1.12});

export function applyNaturalRadioRate(utterance){
  if(!utterance)return utterance;
  const sourceRate=Number(utterance.rate);
  // audio.js intentionally distinguishes driver (.98) from engineer (1.0).
  // Preserve that role signal, but submit the final utterance at the brisk,
  // intelligible cadence heard in real race-team radio. Speech priming uses
  // rate=2 and is deliberately left untouched.
  if(Number.isFinite(sourceRate)&&sourceRate>=.90&&sourceRate<=1.05){
    utterance.rate=sourceRate<.99?RADIO_SPEECH_RATE.driver:RADIO_SPEECH_RATE.engineer;
  }
  return utterance;
}

export function createAudio(R,settings={}){
  const session=typeof navigator!=='undefined'?navigator.audioSession:null,synth=typeof window!=='undefined'?window.speechSynthesis:null;
  let patched=false;
  const forceAmbient=()=>{if(!session)return false;try{session.type='ambient';return session.type==='ambient'||true;}catch{return false;}};
  forceAmbient();

  // Patch the actual submission point so the cadence applies on every browser,
  // while iOS additionally forces the ambient audio-session policy immediately
  // before speech. This leaves the rate=2 silent priming utterance unchanged.
  if(synth&&typeof synth.speak==='function'&&!synth.__racingAmbientSpeakPatched){
    const nativeSpeak=synth.speak.bind(synth),wrapped=utterance=>{forceAmbient();applyNaturalRadioRate(utterance);return nativeSpeak(utterance);};
    try{synth.speak=wrapped;patched=synth.speak===wrapped;}catch{}
    if(!patched){try{Object.defineProperty(synth,'speak',{configurable:true,value:wrapped});patched=synth.speak===wrapped;}catch{}}
    if(patched){try{Object.defineProperty(synth,'__racingAmbientSpeakPatched',{configurable:true,value:true});}catch{synth.__racingAmbientSpeakPatched=true;}}
  }

  const A=createStableAudio(R,settings);
  return new Proxy(A,{get(target,prop){
    if(prop==='sessionPolicy')return{desired:'ambient',supported:!!session,speechHook:patched,current:session?.type||'unsupported'};
    if(prop==='speechProfile')return{owner:'runtime-natural-radio-v1',driverRate:RADIO_SPEECH_RATE.driver,engineerRate:RADIO_SPEECH_RATE.engineer,primeRate:2};
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
}
