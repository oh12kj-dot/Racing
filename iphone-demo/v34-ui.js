import {createUI as createV26UI} from './v26-ui.js';

export function createUI(W,R,D,E,C,A,settings,saveSettings){
  const base=createV26UI(W,R,D,E,C,A,settings,saveSettings),drawer=document.getElementById('v16Drawer');
  if(!drawer)return base;
  function soundFields(){return `<div id="v34SoundSettings" class="v24perf"><b>AUDIO</b><div class="setting"><span>Sound</span><select id="setSound"><option value="1">On</option><option value="0">Off</option></select></div><span class="muted">保存して次回起動時にも引き継ぎます。TEST RADIOを押さない限りテスト音声は再生しません。</span></div>`;}
  function enhance(){const apply=document.getElementById('applySettings');if(!apply||document.getElementById('v34SoundSettings'))return;apply.insertAdjacentHTML('beforebegin',soundFields());const e=document.getElementById('setSound');if(e)e.value=settings.sound===false?'0':'1';}
  drawer.addEventListener('click',e=>{
    if(e.target?.id==='applySettings'){const on=document.getElementById('setSound')?.value!=='0';settings.sound=on;A?.setEnabled?.(on);saveSettings(settings);}
    if(e.target?.id==='audioToggle')setTimeout(()=>{settings.sound=!!A?.enabled;saveSettings(settings);const s=document.getElementById('setSound');if(s)s.value=settings.sound?'1':'0';},0);
  },true);
  const obs=new MutationObserver(enhance);obs.observe(drawer,{subtree:true,childList:true});enhance();
  return base;
}
