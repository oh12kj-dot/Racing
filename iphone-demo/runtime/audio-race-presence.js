import {createAudio as createStableAudio} from './audio-silent-policy.js';
import {resolveEngineEnvelope} from './audio.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function createAudio(R,settings={}){
  const A=createStableAudio(R,settings);
  let ctx,out,body,intake,road,roadFilter,lastGear=0,updates=0,transients=0;

  function init(){
    if(ctx)return;
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    out=ctx.createGain();out.gain.value=0;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-18;comp.ratio.value=2.2;comp.attack.value=.006;comp.release.value=.16;out.connect(comp).connect(ctx.destination);
    const makeTone=type=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;g.gain.value=0;o.connect(g).connect(out);o.start();return{o,g};};
    body=makeTone('sine');intake=makeTone('triangle');
    const len=Math.max(1,Math.floor(ctx.sampleRate*.7)),buffer=ctx.createBuffer(1,len,ctx.sampleRate),data=buffer.getChannelData(0);let prev=0;
    for(let i=0;i<len;i++){const n=Math.random()*2-1;prev=prev*.24+n*.76;data[i]=prev;}
    road=ctx.createBufferSource();road.buffer=buffer;road.loop=true;roadFilter=ctx.createBiquadFilter();roadFilter.type='bandpass';roadFilter.frequency.value=1600;roadFilter.Q.value=1.2;const g=ctx.createGain();g.gain.value=0;road._gain=g;road.connect(roadFilter).connect(g).connect(out);road.start();
  }
  function applyMaster(){if(!ctx)return;const v=A.volumes||{},gain=A.enabled?clamp((Number(v.master)||0)*(Number(v.effects)||0)*.18,0,.18):0;out.gain.setTargetAtTime(gain,ctx.currentTime,.05);}
  function gearThump(up){if(!ctx||!A.enabled)return;const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime;o.type='sine';o.frequency.setValueAtTime(up?62:84,t);o.frequency.exponentialRampToValueAtTime(38,t+.075);g.gain.setValueAtTime(.18,t);g.gain.exponentialRampToValueAtTime(.0001,t+.09);o.connect(g).connect(out);o.start(t);o.stop(t+.10);transients++;}
  function updatePresence(){
    if(!A.enabled)return;init();ctx.resume?.().catch?.(()=>{});applyMaster();
    const c=R.cars?.[Number(A.radioFocus)||0]||R.getStandings?.()?.[0];if(!c)return;
    const e=resolveEngineEnvelope(c,R.sessionPhase),motion=c.bodyMotionTelemetry||{},attack=['ATTACK','FEINT','SWITCHBACK'].includes(String(c.racecraftIntent||''));
    body.o.frequency.setTargetAtTime(38+e.speedNorm*74+e.load*16,ctx.currentTime,.045);body.g.gain.setTargetAtTime(.035+e.load*.095+(attack ? .018 : 0),ctx.currentTime,.045);
    intake.o.frequency.setTargetAtTime(110+e.rpm*.034,ctx.currentTime,.030);intake.g.gain.setTargetAtTime((e.driveActive ? .012 : .003)+e.throttle*.052+(attack ? .010 : 0),ctx.currentTime,.035);
    const kerb=motion.onKerb?1:0,lock=motion.lockup?1:0,slide=motion.slide?1:0,slip=clamp(Math.abs(Number(c.slipAngle)||0)*.7+lock*.7+slide*.9+kerb*.55,0,1);
    road._gain.gain.setTargetAtTime(slip*.10,ctx.currentTime,.018);roadFilter.frequency.setTargetAtTime(1150+e.kmh*4.2+kerb*650,ctx.currentTime,.045);roadFilter.Q.setTargetAtTime(lock?2.8:kerb?1.8:1.15,ctx.currentTime,.05);
    if(e.driveActive&&lastGear&&e.gear!==lastGear)gearThump(e.gear>lastGear);lastGear=e.gear;updates++;
  }
  function update(...args){const r=A.update(...args);updatePresence();return r;}
  function setEnabled(on){const r=A.setEnabled(on);if(on){init();ctx.resume?.().catch?.(()=>{});}applyMaster();return r;}
  function setVolumes(v){const r=A.setVolumes(v);applyMaster();return r;}
  addEventListener('pagehide',()=>ctx?.suspend?.(),{passive:true});
  return new Proxy(A,{get(target,prop){if(prop==='update')return update;if(prop==='setEnabled')return setEnabled;if(prop==='setVolumes')return setVolumes;if(prop==='racePresenceDiagnostics')return{owner:'runtime-audio-race-presence-v2',updates,transients,state:ctx?.state||'not-created'};const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;}});
}
