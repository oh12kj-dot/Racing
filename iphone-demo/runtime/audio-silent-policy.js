import {createAudio as createStableAudio} from './audio.js';

export const RADIO_SPEECH_RATE=Object.freeze({driver:1.08,engineer:1.12});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function resolveLaunchAudioPolicy({speedKmh=0,movementAllowed=true,launchAge=Infinity}={}){
  const kmh=Math.max(0,Number(speedKmh)||0),age=Number(launchAge),moving=!!movementAllowed&&kmh>=.45;
  if(!moving)return{moving:false,launchWindow:false,sourceKmh:kmh,audibleKmh:0,throttleFloor:0,boost:0};
  const launchWindow=Number.isFinite(age)&&age>=0&&age<1.25,pulse=launchWindow?1-clamp(age/1.25,0,1):0;
  // Below the old 3 km/h envelope threshold, emulate clutch slip only in the
  // audio input. During the first 1.25 s, launch revs are intentionally higher
  // than road speed so the car sounds loaded rather than muted off the line.
  const thresholdFloor=kmh<3.05?3.15:kmh;
  const launchFloor=launchWindow?8+9*pulse:0;
  return{moving:true,launchWindow,sourceKmh:kmh,audibleKmh:Math.max(kmh,thresholdFloor,launchFloor),throttleFloor:launchWindow?.74+.22*pulse:.32,boost:pulse};
}

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
  let patched=false,lastLaunchPolicy=resolveLaunchAudioPolicy();
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
  function updateWithLaunchPresence(...args){
    const focus=Number(A.radioFocus)||0,c=R.cars?.[focus]||R.getStandings?.()?.[0];
    if(!c)return A.update(...args);
    const gate=R.startGate||{},movementAllowed=gate.preStart!==true;
    const launchAge=gate.launchAt==null?Infinity:Math.max(0,(R.race?.t||0)-Number(gate.launchAt));
    const actualV=Number(c.v)||0,actualThrottle=Number(c.racingThrottle)||0;
    lastLaunchPolicy=resolveLaunchAudioPolicy({speedKmh:actualV*3.6,movementAllowed,launchAge});
    if(!lastLaunchPolicy.moving)return A.update(...args);
    // Audio-only clutch-slip proxy. Physics/HUD keep the real vehicle speed.
    // Restoring in finally guarantees this cannot alter race simulation state.
    c.v=Math.max(actualV,lastLaunchPolicy.audibleKmh/3.6);
    c.racingThrottle=Math.max(actualThrottle,lastLaunchPolicy.throttleFloor);
    try{return A.update(...args);}finally{c.v=actualV;c.racingThrottle=actualThrottle;}
  }
  return new Proxy(A,{get(target,prop){
    if(prop==='sessionPolicy')return{desired:'ambient',supported:!!session,speechHook:patched,current:session?.type||'unsupported'};
    if(prop==='speechProfile')return{owner:'runtime-natural-radio-v1',driverRate:RADIO_SPEECH_RATE.driver,engineerRate:RADIO_SPEECH_RATE.engineer,primeRate:2};
    if(prop==='launchAudioPolicy')return{owner:'runtime-launch-audio-v2',...lastLaunchPolicy};
    if(prop==='update')return updateWithLaunchPresence;
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
}
