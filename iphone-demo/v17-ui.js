import {createUI as createV16UI} from './v16-ui.js';

export function createUI(W,R,D,E,C,A,settings,saveSettings){
  const base=createV16UI(W,R,D,E,C,A,settings,saveSettings);
  function enhanceRadio(){
    const toggle=document.getElementById('audioToggle');
    if(!toggle||document.getElementById('radioTest'))return;
    const test=document.createElement('button');test.id='radioTest';test.className='wide';test.style.marginLeft='5px';test.textContent='TEST RADIO';
    const status=document.createElement('div');status.id='radioTestStatus';status.className='muted';status.style.marginTop='5px';
    status.textContent=A?.speechSupported===false?'Speech synthesis unavailable on this browser.':A?.speechUnlocked?'VOICE READY':'Tap ENABLE, then TEST RADIO.';
    toggle.insertAdjacentElement('afterend',test);test.insertAdjacentElement('afterend',status);
    test.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const ok=A?.testRadio?.();status.textContent=ok?'Radio check sent. You should hear a short engineer message.':'Speech synthesis is unavailable.';});
    toggle.addEventListener('click',()=>setTimeout(()=>{status.textContent=A?.enabled?(A?.speechUnlocked?'VOICE READY · radio check should be audible':'SOUND ON · tap TEST RADIO'):'RADIO / SOUND OFF';},0));
  }
  const obs=new MutationObserver(enhanceRadio);obs.observe(document.body,{childList:true,subtree:true});enhanceRadio();
  const oldUpdate=base.update;
  return new Proxy(base,{get(target,prop){if(prop==='update')return(dt,id)=>{oldUpdate(dt,id);enhanceRadio();};return Reflect.get(target,prop,target);}});
}
