import {createUI as createLegacyUI} from '../v26-ui.js';
import {readAudioSettings} from './config.js';

export function createUI(W,R,D,E,C,A,settings,saveSettings){
  const base=createLegacyUI(W,R,D,E,C,A,settings,saveSettings),drawer=document.getElementById('v16Drawer');
  if(!drawer)return base;
  const map={audioMaster:'master',audioEngine:'engine',audioEffects:'effects',audioRadioVoice:'radioVoice',audioRadioPtt:'radioPtt'};
  function current(){return A?.volumes||readAudioSettings(settings);}
  function soundFields(){return `<div id="v34SoundSettings" class="v24perf"><b>AUDIO</b><div class="setting"><span>Sound</span><select id="setSound"><option value="1">On</option><option value="0">Off</option></select></div><span class="muted">保存して次回起動時にも引き継ぎます。TEST RADIOを押さない限りテスト音声は再生しません。</span></div>`;}
  function mixerHtml(){const v=current(),row=(id,label,key)=>`<div class="setting"><span>${label} <small id="${id}Val">${Math.round(v[key]*100)}%</small></span><input id="${id}" type="range" min="0" max="100" step="1" value="${Math.round(v[key]*100)}"></div>`;return `<div id="runtimeAudioMixer" style="margin-top:8px"><b>MIXER</b>${row('audioMaster','Master','master')}${row('audioEngine','Engine','engine')}${row('audioEffects','Effects','effects')}${row('audioRadioVoice','Radio voice','radioVoice')}${row('audioRadioPtt','Radio PTT','radioPtt')}<span class="muted">各音量も設定と一緒に保存されます。</span></div>`;}
  function enhance(){
    const apply=document.getElementById('applySettings');
    if(apply&&!document.getElementById('v34SoundSettings')){apply.insertAdjacentHTML('beforebegin',soundFields());const e=document.getElementById('setSound');if(e)e.value=settings.sound===false?'0':'1';}
    const host=document.getElementById('v34SoundSettings');if(host&&!document.getElementById('runtimeAudioMixer'))host.insertAdjacentHTML('beforeend',mixerHtml());
  }
  function readMixer(){const out={};for(const [id,key] of Object.entries(map)){const e=document.getElementById(id);if(e)out[key]=Math.max(0,Math.min(1,Number(e.value)/100));}return out;}
  function writeSettings(vol){settings.audioMaster=vol.master;settings.audioEngine=vol.engine;settings.audioEffects=vol.effects;settings.audioRadioVoice=vol.radioVoice;settings.audioRadioPtt=vol.radioPtt;}
  drawer.addEventListener('input',e=>{const key=map[e.target?.id];if(!key)return;const val=Math.max(0,Math.min(1,Number(e.target.value)/100)),label=document.getElementById(`${e.target.id}Val`);if(label)label.textContent=`${Math.round(val*100)}%`;const next={...current(),[key]:val};A?.setVolumes?.(next);writeSettings(next);},true);
  drawer.addEventListener('change',e=>{if(!map[e.target?.id])return;const next={...current(),...readMixer()};A?.setVolumes?.(next);writeSettings(next);saveSettings(settings);},true);
  drawer.addEventListener('click',e=>{
    if(e.target?.id==='applySettings'){
      const on=document.getElementById('setSound')?.value!=='0';settings.sound=on;A?.setEnabled?.(on);
      const next={...current(),...readMixer()};A?.setVolumes?.(next);writeSettings(next);saveSettings(settings);
    }
    if(e.target?.id==='audioToggle')setTimeout(()=>{settings.sound=!!A?.enabled;saveSettings(settings);const s=document.getElementById('setSound');if(s)s.value=settings.sound?'1':'0';},0);
  },true);
  const obs=new MutationObserver(enhance);obs.observe(drawer,{subtree:true,childList:true});enhance();
  return base;
}
