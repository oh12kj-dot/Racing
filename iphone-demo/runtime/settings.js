import {AUDIO_DEFAULTS} from './config.js';

export const DEFAULT_SETTINGS={
  circuit:'CHAMPIONSHIP',laps:6,ai:1,weather:'DYNAMIC',time:14.2,
  failures:1,tyreWear:1,safetyCar:true,sound:true,raceClass:'MIXED',
  perfMode:'AUTO',fpsCap:'AUTO',renderScale:1,shadows:true,autoQuality:true,
  audioMaster:AUDIO_DEFAULTS.master,audioEngine:AUDIO_DEFAULTS.engine,audioEffects:AUDIO_DEFAULTS.effects,audioRadioVoice:AUDIO_DEFAULTS.radioVoice,audioRadioPtt:AUDIO_DEFAULTS.radioPtt
};
const KEY='racing_v10_settings';
export function loadSettings(){
  try{return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{return {...DEFAULT_SETTINGS};}
}
export function saveSettings(next){try{localStorage.setItem(KEY,JSON.stringify({...DEFAULT_SETTINGS,...next}));}catch{}}
export function resolveCircuit(settings){
  if(settings.circuit!=='CHAMPIONSHIP')return settings.circuit;
  let round=0;try{round=JSON.parse(localStorage.getItem('racing_suzuka_championship_v2')||'{}').round|0;}catch{}
  return ['SUZUKA','FUJI_STYLE','MONZA_STYLE','SPA_STYLE','SUZUKA'][Math.max(0,Math.min(4,round))];
}
