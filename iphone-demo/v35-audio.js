import {createAudio as createV32Audio} from './v32-audio.js';

export function createAudio(R){
  const A=createV32Audio(R);
  let fx=null,bus=null,noise=null,lastSpeaking=false,resumeArmed=false;

  function initFx(){
    if(fx)return;
    fx=new (window.AudioContext||window.webkitAudioContext)();
    bus=fx.createGain();bus.gain.value=.34;
    const comp=fx.createDynamicsCompressor();comp.threshold.value=-18;comp.knee.value=10;comp.ratio.value=3.5;comp.attack.value=.002;comp.release.value=.08;
    bus.connect(comp).connect(fx.destination);
    const len=Math.floor(fx.sampleRate*.45),b=fx.createBuffer(1,len,fx.sampleRate),d=b.getChannelData(0);
    // Slightly correlated noise sounds more like an RF squelch/carrier tail than raw white noise.
    let prev=0;for(let i=0;i<len;i++){const w=Math.random()*2-1;prev=prev*.22+w*.78;d[i]=prev;}noise=b;
  }
  function armResume(){
    if(resumeArmed||!A.enabled)return;initFx();if(fx.state==='running')return;resumeArmed=true;
    const go=()=>{resumeArmed=false;fx?.resume?.();};
    addEventListener('pointerdown',go,{once:true,capture:true});addEventListener('touchend',go,{once:true,capture:true});addEventListener('keydown',go,{once:true,capture:true});
  }
  function filteredNoise(start,dur,vol,lo=520,hi=3100){
    if(!fx||!noise)return;const src=fx.createBufferSource(),hp=fx.createBiquadFilter(),lp=fx.createBiquadFilter(),g=fx.createGain();
    src.buffer=noise;hp.type='highpass';hp.frequency.value=lo;lp.type='lowpass';lp.frequency.value=hi;
    g.gain.setValueAtTime(.0001,start);g.gain.linearRampToValueAtTime(vol,start+.006);g.gain.exponentialRampToValueAtTime(.0001,start+dur);
    src.connect(hp).connect(lp).connect(g).connect(bus);src.start(start);src.stop(start+dur+.02);
  }
  function mechClick(start,release=false){
    if(!fx)return;
    // A real PTT switch has a short mechanical contact transient plus a lower body resonance.
    const o=fx.createOscillator(),g=fx.createGain();o.type='triangle';o.frequency.setValueAtTime(release?126:168,start);o.frequency.exponentialRampToValueAtTime(release?72:88,start+.030);g.gain.setValueAtTime(release?.22:.20,start);g.gain.exponentialRampToValueAtTime(.0001,start+.038);o.connect(g).connect(bus);o.start(start);o.stop(start+.045);
    const src=fx.createBufferSource(),bp=fx.createBiquadFilter(),ng=fx.createGain();src.buffer=noise;bp.type='bandpass';bp.frequency.value=release?1050:1450;bp.Q.value=1.15;ng.gain.setValueAtTime(release?.18:.16,start);ng.gain.exponentialRampToValueAtTime(.0001,start+.018);src.connect(bp).connect(ng).connect(bus);src.start(start);src.stop(start+.025);
  }
  function pttPress(){
    if(!A.enabled)return;initFx();fx.resume?.();const t=fx.currentTime+.006;
    mechClick(t,false);filteredNoise(t+.012,.090,.12,650,3400);
  }
  function pttRelease(){
    if(!A.enabled)return;initFx();fx.resume?.();const t=fx.currentTime+.006;
    // End-of-transmission is deliberately ordered as carrier/squelch tail -> spring/contact release.
    // No artificial "roger beep" is added because it is not universal in motorsport team radio.
    filteredNoise(t,.185,.20,430,2850);mechClick(t+.060,true);
    // A tiny secondary contact bounce makes the release audible without sounding like a UI click.
    mechClick(t+.083,true);
  }

  function setEnabled(on){A.setEnabled?.(on);initFx();if(on){fx.resume?.().catch?.(()=>{});armResume();}else if(bus&&fx)bus.gain.setTargetAtTime(0,fx.currentTime,.025);if(on&&bus&&fx)bus.gain.setTargetAtTime(.34,fx.currentTime,.025);lastSpeaking=!!A.speaking;return A.enabled;}
  function toggle(){return setEnabled(!A.enabled);}
  function update(dt=.016){
    A.update(dt);const now=!!A.speaking;
    if(now!==lastSpeaking){if(now)pttPress();else pttRelease();lastSpeaking=now;}
    if(A.enabled)armResume();
  }
  function testRadio(){if(!A.enabled)setEnabled(true);return A.testRadio?.();}

  return new Proxy(A,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='setEnabled')return setEnabled;
    if(prop==='toggle')return toggle;
    if(prop==='testRadio')return testRadio;
    if(prop==='pttFxState')return{context:fx?.state||'uninitialized',speaking:lastSpeaking};
    return Reflect.get(target,prop,target);
  }});
}
