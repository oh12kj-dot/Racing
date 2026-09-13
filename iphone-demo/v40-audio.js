import {createAudio as createV39Audio} from './v39-audio.js';

export function createAudio(R){
  const A=createV39Audio(R),AudioCtor=window.AudioContext||window.webkitAudioContext,session=typeof navigator!=='undefined'?navigator.audioSession:null;
  let ctx=null,out=null,noise=null,lastSpeaking=false,cueUntil=0,cueRestoreType=null,resumeArmed=false;

  function initCue(){
    if(ctx||!AudioCtor)return;
    ctx=new AudioCtor();out=ctx.createGain();out.gain.value=.52;
    const comp=ctx.createDynamicsCompressor();comp.threshold.value=-18;comp.knee.value=10;comp.ratio.value=3.5;comp.attack.value=.002;comp.release.value=.11;out.connect(comp).connect(ctx.destination);
    const len=Math.max(1,Math.floor(ctx.sampleRate*.28)),b=ctx.createBuffer(1,len,ctx.sampleRate),d=b.getChannelData(0);let p=0;
    for(let i=0;i<len;i++){const w=Math.random()*2-1;p=p*.18+w*.82;d[i]=p;}noise=b;
  }
  function armResume(){
    if(resumeArmed||!A.enabled)return;initCue();if(!ctx||ctx.state==='running')return;resumeArmed=true;
    const go=()=>{resumeArmed=false;ctx?.resume?.().catch?.(()=>{});};
    addEventListener('pointerdown',go,{once:true,capture:true});addEventListener('touchend',go,{once:true,capture:true});addEventListener('keydown',go,{once:true,capture:true});
  }
  function forceTransient(ms=330){
    if(!session)return;
    try{if(cueUntil<=performance.now())cueRestoreType=session.type||'auto';session.type='transient';cueUntil=Math.max(cueUntil,performance.now()+ms);}catch{}
  }
  function restoreSessionIfReady(){
    if(!session||cueUntil<=0||performance.now()<cueUntil||A.speaking)return;
    try{session.type=cueRestoreType||'auto';}catch{}cueUntil=0;cueRestoreType=null;
  }
  function rfTail(t){
    if(!ctx||!noise)return;const src=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),lp=ctx.createBiquadFilter(),g=ctx.createGain();src.buffer=noise;hp.type='highpass';hp.frequency.value=420;lp.type='lowpass';lp.frequency.value=2550;g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.24,t+.007);g.gain.setValueAtTime(.18,t+.055);g.gain.exponentialRampToValueAtTime(.0001,t+.128);src.connect(hp).connect(lp).connect(g).connect(out);src.start(t);src.stop(t+.145);
  }
  function latchClick(t){
    if(!ctx||!noise)return;
    const o=ctx.createOscillator(),g=ctx.createGain();o.type='triangle';o.frequency.setValueAtTime(155,t);o.frequency.exponentialRampToValueAtTime(68,t+.040);g.gain.setValueAtTime(.28,t);g.gain.exponentialRampToValueAtTime(.0001,t+.050);o.connect(g).connect(out);o.start(t);o.stop(t+.055);
    const src=ctx.createBufferSource(),bp=ctx.createBiquadFilter(),ng=ctx.createGain();src.buffer=noise;bp.type='bandpass';bp.frequency.value=1250;bp.Q.value=1.15;ng.gain.setValueAtTime(.22,t);ng.gain.exponentialRampToValueAtTime(.0001,t+.021);src.connect(bp).connect(ng).connect(out);src.start(t);src.stop(t+.028);
    const o2=ctx.createOscillator(),g2=ctx.createGain();o2.type='sine';o2.frequency.value=92;g2.gain.setValueAtTime(.12,t+.024);g2.gain.exponentialRampToValueAtTime(.0001,t+.058);o2.connect(g2).connect(out);o2.start(t+.024);o2.stop(t+.064);
  }
  function releaseCue(){
    if(!A.enabled)return;initCue();if(!ctx)return;ctx.resume?.().catch?.(()=>{});forceTransient(360);const t=ctx.currentTime+.012;rfTail(t);latchClick(t+.105);
  }

  const baseUpdate=A.update.bind(A),baseSet=A.setEnabled.bind(A),baseTest=A.testRadio.bind(A);
  function update(dt){
    baseUpdate(dt);const speaking=!!A.speaking;if(lastSpeaking&&!speaking)releaseCue();lastSpeaking=speaking;if(cueUntil>performance.now())forceTransient(Math.max(40,cueUntil-performance.now()));else restoreSessionIfReady();armResume();
  }
  function setEnabled(on){const v=baseSet(on);if(v){initCue();ctx?.resume?.().catch?.(()=>{});armResume();}else{lastSpeaking=false;cueUntil=0;cueRestoreType=null;ctx?.suspend?.();}return v;}
  function testRadio(){const ok=baseTest();if(ok){lastSpeaking=!!A.speaking;armResume();}return ok;}
  function toggle(){return setEnabled(!A.enabled);}
  addEventListener('pagehide',()=>{cueUntil=0;cueRestoreType=null;ctx?.suspend?.();},{passive:true});
  return new Proxy(A,{get(target,prop){if(prop==='update')return update;if(prop==='setEnabled')return setEnabled;if(prop==='testRadio')return testRadio;if(prop==='toggle')return toggle;if(prop==='releaseCueState')return{active:cueUntil>performance.now(),ctx:ctx?.state||'uninitialized'};return Reflect.get(target,prop,target);}});
}
