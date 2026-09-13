import {createAudio as createV38Audio} from './v38-audio.js';

export function createAudio(R){
  const A=createV38Audio(R),session=typeof navigator!=='undefined'?navigator.audioSession:null;
  let speechSession=false,previousType=null;
  function setSpeechSession(on){
    if(!session)return false;
    try{
      if(on&&!speechSession){previousType=session.type||'auto';session.type='transient';speechSession=true;}
      else if(!on&&speechSession){session.type=previousType||'auto';speechSession=false;previousType=null;}
      return true;
    }catch{return false;}
  }
  const baseUpdate=A.update.bind(A),baseTest=A.testRadio.bind(A),baseSet=A.setEnabled.bind(A);
  function update(dt){baseUpdate(dt);setSpeechSession(!!A.speaking);}
  function testRadio(){setSpeechSession(true);const ok=baseTest();if(!ok)setSpeechSession(false);return ok;}
  function setEnabled(on){const v=baseSet(on);if(!v)setSpeechSession(false);return v;}
  function toggle(){return setEnabled(!A.enabled);}
  addEventListener('pagehide',()=>setSpeechSession(false),{passive:true});
  return new Proxy(A,{get(target,prop){if(prop==='update')return update;if(prop==='testRadio')return testRadio;if(prop==='setEnabled')return setEnabled;if(prop==='toggle')return toggle;if(prop==='silentModeRespectSupported')return !!session;if(prop==='speechAudioSession')return speechSession?'transient':(session?.type||'unavailable');return Reflect.get(target,prop,target);}});
}
