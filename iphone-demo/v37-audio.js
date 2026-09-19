import {createAudio as createV36Audio} from './v36-audio.js';

export function createAudio(R){
  const A=createV36Audio(R);
  let stableFocus=0,pendingFocus=0,pendingSince=0,lastUpdateT=0,primeArmed=false,primed=false;
  const synth=()=>window.speechSynthesis;

  function primeSpeech(){
    if(primed||!A.enabled||!synth())return;
    try{
      const u=new SpeechSynthesisUtterance('.');u.volume=0;u.rate=2;u.lang='en-GB';
      const done=()=>{primed=true;};u.onstart=done;u.onend=done;u.onerror=done;synth().speak(u);
    }catch{}
  }
  function armPrime(){
    if(primeArmed||primed||!A.enabled)return;primeArmed=true;
    const go=()=>{primeArmed=false;primeSpeech();};
    addEventListener('pointerdown',go,{once:true,capture:true});
    addEventListener('touchend',go,{once:true,capture:true});
    addEventListener('keydown',go,{once:true,capture:true});
  }

  // Camera changes must not flush or skip team-radio messages. Follow a new camera subject only
  // after it has remained stable for several seconds, and never interrupt an utterance already playing.
  function setFocus(id){
    const n=Number(id)||0,t=R.race?.t||0;
    if(n===stableFocus){pendingFocus=n;pendingSince=t;return;}
    if(n!==pendingFocus){pendingFocus=n;pendingSince=t;return;}
    if(!A.speaking&&t-pendingSince>=4.5){stableFocus=n;A.setFocus?.(n);pendingSince=t;}
  }
  function setEnabled(on){const r=A.setEnabled?.(on);if(on){armPrime();}return r;}
  function toggle(){return setEnabled(!A.enabled);}
  function testRadio(){if(!A.enabled)setEnabled(true);primeSpeech();return A.testRadio?.();}
  function update(dt=.016){
    lastUpdateT=R.race?.t||lastUpdateT+dt;
    if(A.enabled)armPrime();
    A.update(dt);
  }

  // Initialize the underlying focus once without repeatedly clearing its queue.
  stableFocus=Number(A.focus||0)||0;pendingFocus=stableFocus;A.setFocus?.(stableFocus);

  return new Proxy(A,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='setFocus')return setFocus;
    if(prop==='setEnabled')return setEnabled;
    if(prop==='toggle')return toggle;
    if(prop==='testRadio')return testRadio;
    if(prop==='radioFocus')return stableFocus;
    if(prop==='speechPrimed')return primed;
    return Reflect.get(target,prop,target);
  }});
}
