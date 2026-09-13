import {createUI as createLegacyUI} from '../v34-ui.js';
import {readAudioSettings} from './config.js';

export function createUI(W,R,D,E,C,A,settings,saveSettings){
  const base=createLegacyUI(W,R,D,E,C,A,settings,saveSettings),drawer=document.getElementById('v16Drawer');
  if(!drawer)return base;
  const map={audioMaster:'master',audioEngine:'engine',audioEffects:'effects',audioRadioVoice:'radioVoice',audioRadioPtt:'radioPtt'};
  function current(){return A?.volumes||readAudioSettings(settings);}
  function mixerHtml(){const v=current(),row=(id,label,key)=>`<div class="setting"><span>${label} <small id="${id}Val">${Math.round(v[key]*100)}%</small></span><input id="${id}" type="range" min="0" max="100" step="1" value="${Math.round(v[key]*100)}"></div>`;return `<div id="runtimeAudioMixer" style="margin-top:8px"><b>MIXER</b>${row('audioMaster','Master','master')}${row('audioEngine','Engine','engine')}${row('audioEffects','Effects','effects')}${row('audioRadioVoice','Radio voice','radioVoice')}${row('audioRadioPtt','Radio PTT','radioPtt')}<span class="muted">各音量も設定と一緒に保存されます。</span></div>`;}
  function enhance(){const host=document.getElementById('v34SoundSettings');if(!host||document.getElementById('runtimeAudioMixer'))return;host.insertAdjacentHTML('beforeend',mixerHtml());}
  function readMixer(){const out={};for(const [id,key] of Object.entries(map)){const e=document.getElementById(id);if(e)out[key]=Math.max(0,Math.min(1,Number(e.value)/100));}return out;}
  function writeSettings(vol){settings.audioMaster=vol.master;settings.audioEngine=vol.engine;settings.audioEffects=vol.effects;settings.audioRadioVoice=vol.radioVoice;settings.audioRadioPtt=vol.radioPtt;}
  drawer.addEventListener('input',e=>{const key=map[e.target?.id];if(!key)return;const val=Math.max(0,Math.min(1,Number(e.target.value)/100)),label=document.getElementById(`${e.target.id}Val`);if(label)label.textContent=`${Math.round(val*100)}%`;const next={...current(),[key]:val};A?.setVolumes?.(next);writeSettings(next);},true);
  drawer.addEventListener('change',e=>{if(!map[e.target?.id])return;const next={...current(),...readMixer()};A?.setVolumes?.(next);writeSettings(next);saveSettings(settings);},true);
  drawer.addEventListener('click',e=>{if(e.target?.id!=='applySettings')return;const next={...current(),...readMixer()};A?.setVolumes?.(next);writeSettings(next);saveSettings(settings);},true);
  const obs=new MutationObserver(enhance);obs.observe(drawer,{subtree:true,childList:true});enhance();
  return base;
}
