export function createAudio(R){
  let ctx=null,master=null,gameBus=null,radioBus=null,engineBus=null,engineFilter=null,engineA=null,engineB=null,engineC=null,hybrid=null;
  let windGain=null,tyreGain=null,brakeGain=null,radioHiss=null,noiseBuffer=null,enabled=false,focus=0,lastGear=0,lastRadioId=null,speaking=false,speechUnlocked=false,stage='NONE',stageCar=null;
  const queue=[],synth=()=>window.speechSynthesis;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const profiles={
    formula:{idle:72,rev:1.00,a:'sawtooth',b:'square',c:'triangle',harm:[1,2.02,.505],filter:4200,hybrid:.055},
    hyper:{idle:61,rev:.86,a:'sawtooth',b:'triangle',c:'sine',harm:[1,1.50,.50],filter:3300,hybrid:.070},
    lmh:{idle:59,rev:.84,a:'sawtooth',b:'triangle',c:'sine',harm:[1,1.49,.50],filter:3200,hybrid:.068},
    proto:{idle:64,rev:.90,a:'sawtooth',b:'triangle',c:'sine',harm:[1,1.98,.50],filter:3500,hybrid:.055},
    gt:{idle:48,rev:.70,a:'sawtooth',b:'sine',c:'triangle',harm:[1,2,.50],filter:2600,hybrid:0},
    supercar:{idle:51,rev:.74,a:'sawtooth',b:'sine',c:'triangle',harm:[1,2,.50],filter:2750,hybrid:0},
    touring:{idle:55,rev:.78,a:'sawtooth',b:'triangle',c:'sine',harm:[1,2,.50],filter:2900,hybrid:0}
  };

  function makeNoise(seconds=2){const len=Math.max(1,Math.floor(ctx.sampleRate*seconds)),b=ctx.createBuffer(1,len,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;return b;}
  function loopNoise(filterType,freq,q,gain){const src=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();src.buffer=noiseBuffer;src.loop=true;f.type=filterType;f.frequency.value=freq;f.Q.value=q;g.gain.value=gain;src.connect(f).connect(g).connect(gameBus);src.start();return{src,f,g};}
  function init(){
    if(ctx)return;ctx=new (window.AudioContext||window.webkitAudioContext)();
    master=ctx.createGain();master.gain.value=.28;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-14;comp.knee.value=16;comp.ratio.value=3.2;comp.attack.value=.004;comp.release.value=.15;master.connect(comp).connect(ctx.destination);
    gameBus=ctx.createGain();gameBus.gain.value=1;gameBus.connect(master);radioBus=ctx.createGain();radioBus.gain.value=1;radioBus.connect(master);
    engineBus=ctx.createGain();engineBus.gain.value=.15;engineFilter=ctx.createBiquadFilter();engineFilter.type='lowpass';engineFilter.frequency.value=3200;engineFilter.Q.value=.7;engineBus.connect(engineFilter).connect(gameBus);
    const mk=(type,gain)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;g.gain.value=gain;o.connect(g).connect(engineBus);o.start();return{o,g};};
    engineA=mk('sawtooth',.52);engineB=mk('triangle',.24);engineC=mk('sine',.20);
    hybrid=mk('sine',0);hybrid.o.frequency.value=1200;hybrid.g.disconnect();hybrid.o.disconnect();hybrid.o.connect(hybrid.g).connect(gameBus);
    noiseBuffer=makeNoise(2);
    const wind=loopNoise('bandpass',700,.55,.012);windGain=wind.g;windGain._filter=wind.f;
    const tyre=loopNoise('bandpass',1900,1.1,0);tyreGain=tyre.g;tyreGain._filter=tyre.f;
    const brake=loopNoise('bandpass',3700,3.0,0);brakeGain=brake.g;brakeGain._filter=brake.f;
    const radio=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),lp=ctx.createBiquadFilter();radio.buffer=noiseBuffer;radio.loop=true;hp.type='highpass';hp.frequency.value=500;lp.type='lowpass';lp.frequency.value=3200;radioHiss=ctx.createGain();radioHiss.gain.value=0;radio.connect(hp).connect(lp).connect(radioHiss).connect(radioBus);radio.start();
  }
  function oneShotNoise({freq=1700,q=.8,dur=.06,vol=.055,type='bandpass'}={}){if(!ctx||!enabled||!noiseBuffer)return;const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain(),t=ctx.currentTime;s.buffer=noiseBuffer;f.type=type;f.frequency.value=freq;f.Q.value=q;g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(vol,t+.006);g.gain.exponentialRampToValueAtTime(.001,t+dur);s.connect(f).connect(g).connect(radioBus);s.start(t);s.stop(t+dur+.02);}
  function click(freq=105,vol=.07,dur=.018){if(!ctx||!enabled)return;const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime;o.type='square';o.frequency.value=freq;g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g).connect(radioBus);o.start(t);o.stop(t+dur+.01);}
  function ptt(open){if(!ctx||!enabled)return;click(open?135:88,open?.075:.065,open?.014:.020);oneShotNoise({freq:open?2100:1350,q:open?.65:.50,dur:open?.075:.105,vol:open?.070:.080});radioHiss?.gain.setTargetAtTime(open?.028:.0015,ctx.currentTime,open?.018:.055);}
  function shiftThump(up=true){if(!ctx||!enabled)return;const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime;o.type='sine';o.frequency.setValueAtTime(up?82:105,t);o.frequency.exponentialRampToValueAtTime(48,t+.06);g.gain.setValueAtTime(.065,t);g.gain.exponentialRampToValueAtTime(.001,t+.075);o.connect(g).connect(gameBus);o.start(t);o.stop(t+.09);oneShotNoise({freq:up?900:620,q:.7,dur:.045,vol:.030});engineBus.gain.setTargetAtTime(.055,t,.006);engineBus.gain.setTargetAtTime(.15,t+.045,.035);}
  function markNow(){const r=R.radio||[];lastRadioId=r.length?r[r.length-1].id:null;queue.length=0;stage='NONE';stageCar=null;}
  function setEnabled(on){enabled=!!on;init();if(enabled){ctx.resume?.();master.gain.setTargetAtTime(.28,ctx.currentTime,.04);markNow();}else{master.gain.setTargetAtTime(0,ctx.currentTime,.04);synth()?.cancel?.();speaking=false;markNow();}}
  function setFocus(id){const n=Number(id)||0;if(n!==focus){focus=n;lastGear=0;markNow();}else focus=n;}
  function radioText(msg){return String(msg.text||'').replaceAll('·',',').replace(/\bDRS\b/g,'D R S').replace(/\bVSC\b/g,'virtual safety car').replace(/\bSC\b/g,'safety car').replace(/\bP(\d+)\b/g,'position $1').replace(/\bBOX\b/g,'box');}
  function voices(){return synth()?.getVoices?.()||[];}
  function engineerVoice(){const vs=voices();return vs.find(v=>/^en-GB/i.test(v.lang)&&/daniel|oliver|arthur|male/i.test(v.name))||vs.find(v=>/^en-GB/i.test(v.lang))||vs.find(v=>/^en-US/i.test(v.lang))||vs[0]||null;}
  function driverVoice(){const vs=voices(),eng=engineerVoice();return vs.find(v=>v!==eng&&/^en-(US|AU|IE|GB)/i.test(v.lang))||eng||vs[0]||null;}
  function makeUtterance(msg){const driver=msg.kind==='DRIVER',v=driver?driverVoice():engineerVoice(),u=new SpeechSynthesisUtterance(radioText(msg));if(v)u.voice=v;u.lang=v?.lang||'en-GB';u.rate=driver?.99:1.08;u.pitch=driver?.96:.82;u.volume=driver?.96:.92;return u;}
  function speakImmediate(msg,{cancel=false}={}){const s=synth();if(!s||!enabled)return false;if(cancel)s.cancel();const u=makeUtterance(msg);speaking=true;ptt(true);gameBus?.gain.setTargetAtTime(.48,ctx.currentTime,.055);u.onstart=()=>{speechUnlocked=true;};u.onend=u.onerror=()=>{ptt(false);gameBus?.gain.setTargetAtTime(1,ctx.currentTime,.12);speaking=false;setTimeout(speakNext,125);};setTimeout(()=>s.speak(u),45);return true;}
  function unlock(){if(!synth())return false;speechUnlocked=true;return speakImmediate({text:'Radio check. Engineer to driver. Comms are good.',kind:'ENGINEER_AI'},{cancel:true});}
  function speakNext(){if(!enabled||speaking||!queue.length||!synth())return;speakImmediate(queue.shift());}
  function testRadio(){if(!enabled)setEnabled(true);return unlock();}
  function toggle(){if(enabled){setEnabled(false);return false;}setEnabled(true);unlock();return true;}
  const engineerKinds=new Set(['ENGINEER_AI','ENGINEER','PIT','STRATEGY','TYRE','URGENT','FAULT']);
  function accept(msg){if(!msg||msg.carId==null||msg.kind==='CONTROL'||Number(msg.carId)!==focus)return false;if(engineerKinds.has(msg.kind)){stage='ENGINEER';stageCar=focus;return true;}if(msg.kind==='DRIVER'&&stage==='ENGINEER'&&stageCar===focus){stage='DRIVER';return true;}if(msg.kind==='ENGINEER_REPLY'&&stage==='DRIVER'&&stageCar===focus){stage='ENGINEER';return true;}return false;}
  function ingestRadio(){const r=R.radio||[];if(!r.length)return;let start=0;if(lastRadioId!=null){const ix=r.findIndex(m=>m.id===lastRadioId);start=ix>=0?ix+1:Math.max(0,r.length-3);}for(let i=start;i<r.length;i++){const m=r[i];if(accept(m))queue.push(m);lastRadioId=m.id;}while(queue.length>6)queue.shift();speakNext();}
  function update(dt=.016){
    if(!ctx||!enabled)return;const c=R.cars[focus]||R.getStandings()[0];
    if(c){
      const p=profiles[c.type]||profiles.gt,kmh=Math.max(0,c.v*3.6),gear=Math.max(1,Math.min(8,Math.floor(kmh/38)+1)),norm=clamp(kmh/330,0,1),rpm=2600+norm*9000+gear*180,base=p.idle+rpm*.018*p.rev;
      if(engineA.o.type!==p.a){engineA.o.type=p.a;engineB.o.type=p.b;engineC.o.type=p.c;}
      engineA.o.frequency.setTargetAtTime(base*p.harm[0],ctx.currentTime,.025);engineB.o.frequency.setTargetAtTime(base*p.harm[1],ctx.currentTime,.030);engineC.o.frequency.setTargetAtTime(base*p.harm[2],ctx.currentTime,.035);
      engineFilter.frequency.setTargetAtTime(p.filter*(.52+.48*norm),ctx.currentTime,.06);engineFilter.Q.setTargetAtTime(.65+norm*.55,ctx.currentTime,.08);
      const load=clamp(.30+norm*.72-(c.brakeVisual||0)*.45-(c.liftCoast||0)*.45,0,1);engineBus.gain.setTargetAtTime((speaking?.09:.11)+load*.075,ctx.currentTime,.035);
      hybrid.o.frequency.setTargetAtTime(900+norm*2400+(c.ers||0)*300,ctx.currentTime,.04);hybrid.g.gain.setTargetAtTime(p.hybrid*norm*(c.energyMode==='PUSH'?1.25:.85),ctx.currentTime,.06);
      windGain.gain.setTargetAtTime(.004+norm*.046,ctx.currentTime,.09);windGain._filter.frequency.setTargetAtTime(520+norm*1250,ctx.currentTime,.10);
      const spin=c.spinState==='SLIDE'?1:0,lock=c.spinState==='LOCKUP'?1:0,slip=clamp((c.brakeVisual||0)*.42+(c.flatSpot?.18:0)+(c.hydroplaning?.30:0)+spin*.72+lock*.55,0,1);
      tyreGain.gain.setTargetAtTime(slip*.050,ctx.currentTime,.025);tyreGain._filter.frequency.setTargetAtTime(1250+kmh*5.2,ctx.currentTime,.04);
      const brakeHot=clamp(((c.brakeTemp||300)-520)/420,0,1)*(c.brakeVisual||0);brakeGain.gain.setTargetAtTime(brakeHot*.015,ctx.currentTime,.05);brakeGain._filter.frequency.setTargetAtTime(3200+brakeHot*1800,ctx.currentTime,.08);
      if(gear!==lastGear&&lastGear>0)shiftThump(gear>lastGear);lastGear=gear;
    }
    ingestRadio();
  }
  return{toggle,testRadio,update,setFocus,get enabled(){return enabled},get speaking(){return speaking},get speechUnlocked(){return speechUnlocked},get speechSupported(){return !!window.speechSynthesis}};
}
