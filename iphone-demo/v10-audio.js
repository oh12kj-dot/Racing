export function createAudio(R){
 let ctx=null,master=null,engine1=null,engine2=null,squeal=null,noise=null,noiseGain=null,enabled=false,focus=0,lastGear=0;
 function init(){
  if(ctx)return;ctx=new (window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=.22;master.connect(ctx.destination);
  engine1=ctx.createOscillator();engine1.type='sawtooth';const g1=ctx.createGain();g1.gain.value=.10;engine1.connect(g1).connect(master);engine1.start();
  engine2=ctx.createOscillator();engine2.type='triangle';const g2=ctx.createGain();g2.gain.value=.07;engine2.connect(g2).connect(master);engine2.start();
  squeal=ctx.createOscillator();squeal.type='square';const sq=ctx.createGain();sq.gain.value=0;squeal.connect(sq).connect(master);squeal._gain=sq;squeal.start();
  const len=ctx.sampleRate*2,b=ctx.createBuffer(1,len,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*.35;noise=ctx.createBufferSource();noise.buffer=b;noise.loop=true;const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=850;noiseGain=ctx.createGain();noiseGain.gain.value=.025;noise.connect(f).connect(noiseGain).connect(master);noise.start();
 }
 async function toggle(){init();enabled=!enabled;if(enabled){await ctx.resume();master.gain.setTargetAtTime(.22,ctx.currentTime,.05);}else master.gain.setTargetAtTime(0,ctx.currentTime,.05);return enabled;}
 function setFocus(id){focus=id;}
 function shiftClick(){if(!ctx||!enabled)return;const o=ctx.createOscillator(),g=ctx.createGain();o.type='square';o.frequency.value=120;g.gain.setValueAtTime(.045,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.06);o.connect(g).connect(master);o.start();o.stop(ctx.currentTime+.07);}
 function update(){if(!ctx||!enabled)return;const c=R.cars[focus]||R.getStandings()[0];if(!c)return;const kmh=c.v*3.6,gear=Math.max(1,Math.min(7,Math.floor(kmh/42)+1)),rpm=2800+((kmh%(42))*145)+gear*260,base=55+rpm*.021;engine1.frequency.setTargetAtTime(base,ctx.currentTime,.03);engine2.frequency.setTargetAtTime(base*.5,ctx.currentTime,.04);const slip=Math.min(1,(c.brakeVisual||0)*.8+(Math.abs(c.lane-c.laneTarget)>1?.25:0));squeal.frequency.setTargetAtTime(620+kmh*2.2,ctx.currentTime,.04);squeal._gain.gain.setTargetAtTime(slip*.025,ctx.currentTime,.04);noiseGain.gain.setTargetAtTime(.01+Math.min(.05,kmh/6000),ctx.currentTime,.08);if(gear!==lastGear&&lastGear>0){shiftClick();}lastGear=gear;}
 return{toggle,update,setFocus,get enabled(){return enabled}};
}
