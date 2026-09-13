export {LOG_POLICY,SUZUKA_PIT,BUILDING_LAYOUT} from '../v42-config.js';

export const RUNTIME_VERSION='2026.09.14';

export const AUDIO_DEFAULTS=Object.freeze({
  master:.78,
  engine:.74,
  effects:.72,
  radioVoice:1.00,
  radioPtt:1.00
});

export function readAudioSettings(settings={}){
  const clamp=v=>Math.max(0,Math.min(1,Number(v)));
  return{
    master:Number.isFinite(Number(settings.audioMaster))?clamp(settings.audioMaster):AUDIO_DEFAULTS.master,
    engine:Number.isFinite(Number(settings.audioEngine))?clamp(settings.audioEngine):AUDIO_DEFAULTS.engine,
    effects:Number.isFinite(Number(settings.audioEffects))?clamp(settings.audioEffects):AUDIO_DEFAULTS.effects,
    radioVoice:Number.isFinite(Number(settings.audioRadioVoice))?clamp(settings.audioRadioVoice):AUDIO_DEFAULTS.radioVoice,
    radioPtt:Number.isFinite(Number(settings.audioRadioPtt))?clamp(settings.audioRadioPtt):AUDIO_DEFAULTS.radioPtt
  };
}
