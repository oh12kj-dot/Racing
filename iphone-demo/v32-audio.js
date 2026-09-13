export function createAudio(R){
  let ctx=null,master=null,gameBus=null,radioBus=null,engineBus=null,engineFilter=null,engineA=null,engineB=null,engineC=null,hybrid=null;
  let windGain=null,tyreGain=null,brakeGain=null,radioHiss=null,noiseBuffer=null,enabled=false,focus=0,lastGear=0,lastRadioId=null,speaking=false,speechUnlocked=false,stage='NONE',stageCar=null;
  const queue=[],synth=()=>window.speechSynthesis,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const profiles={
    formula:{idle:70,rev:.96,a:'sawtooth',b:'triangle',c:'sine',harm:[1,1.92,.51],filter:3300,hybrid:.017},
    hyper:{idle:59,rev:.83,a:'sawtooth',b:'triangle',c:'sine',harm:[1,1.48,.50],filter:3000,hybrid:.023},
    lmh:{idle:58,rev:.82,a:'sawtooth',b:'triangle',c:'sine',harm:[1,1.47,.50],filter:2950,hybrid:.022},
    proto:{idle:62,rev:.87,a:'sawtooth',b:'triangle',c:'sine',harm:[1,1.88,.50],filter:3150,hybrid:.018},
    gt:{idle:47,rev:.69,a:'sawtooth',b:'sine',c:'triangle',harm:[1,1.92,.50],filter:2450,hybrid:0},
    supercar:{idle:50,rev:.72,a:'sawtooth',b:'sine',c:'triangle',harm:[1,1.94,.50],filter:2550,hybrid:0},
    touring:{idle:54,rev:.75,a:'sawtooth',b:'triangle',c:'sine',harm:[1,1.90,.50],filter:2650,hybrid:0}
  };

  function makeNoise(seconds=2){const len=Math.max(1,Math.floor(ctx.sampleRate*seconds)),b=ctx.createBuffer(1,len,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;return b;}
  function loopNoise(filterType,freq,q,gain){const src=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();src.buffer=noiseBuffer;src.loop=true;f.type=filterType;f.frequency.value=freq;f.Q.value=q;g.gain.value=gain;src.connect(f).connect(g).connect(gameBus);src.start();return{src,f,g};}
  function init(){
    if(ctx)return;ctx=new (window.AudioContext||window.webkitAudioContext)();
    master=ctx.createGain();master.gain.value=.29;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-15;comp.knee.value=18;comp.ratio.value=3;comp.attack.value=.004;comp.release.value=.18;master.connect(comp).connect(ctx.destination);
    gameBus=ctx.createGain();gameBus.gain.value=1;gameBus.connect(master);radioBus=ctx.createGain();radioBus.gain.value=1.35;radioBus.connect(master);
    engineBus=ctx.createGain();engineBus.gain.value=.14;engineFilter=ctx.createBiquadFilter();engineFilter.type='lowpass';engineFilter.frequency.value=2800;engineFilter.Q.value=.5;engineBus.connect(engineFilter).connect(gameBus);
    const mk=(type,gain)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;g.gain.value=gain;o.connect(g).connect(engineBus);o.start();return{o,g};};
    engineA=mk('sawtooth',.50);engineB=mk('triangle',.21);engineC=mk('sine',.18);
    hybrid=mk('sine',0);hybrid.g.disconnect();hybrid.o.disconnect();hybrid.o.connect(hybrid.g).connect(gameBus);
    noiseBuffer=makeNoise(2);
    const wind=loopNoise('bandpass',650,.55,.010);windGain=wind.g;windGain._filter=wind.f;
    const tyre=loopNoise('bandpass',1750,1.0,0);tyreGain=tyre.g;tyreGain._filter=tyre.f;
    const brake=loopNoise('bandpass',3300,2.5,0);brakeGain=brake.g;brakeGain._filter=brake.f;
    const radio=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),lp=ctx.createBiquadFilter();radio.buffer=noiseBuffer;radio.loop=true;hp.type='highpass';hp.frequency.value=420;lp.type='lowpass';lp.frequency.value=3000;radioHiss=ctx.createGain();radioHiss.gain.value=.001;radio.connect(hp).connect(lp).connect(radioHiss).connect(radioBus);radio.start();
  }
  function burst({freq=1500,q=.65,dur=.10,vol=.13,type='bandpass'}={}){if(!ctx||!enabled||!noiseBuffer)return;const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain(),t=ctx.currentTime;s.buffer=noiseBuffer;f.type=type;f.frequency.value=freq;f.Q.value=q;g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(vol,t+.006);g.gain.exponentialRampToValueAtTime(.001,t+dur);s.connect(f).connect(g).connect(radioBus);s.start(t);s.stop(t+dur+.025);}
  function click(freq=110,vol=.14,dur=.026){if(!ctx||!enabled)return;const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime;o.type='square';o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(45,freq*.55),t+dur);g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g).connect(radioBus);o.start(t);o.stop(t+dur+.01);}
  function ptt(open){if(!ctx||!enabled)return;click(open?155:92,open?.16:.15,open?.024:.030);burst({freq:open?1850:1180,q:open?.55:.42,dur:open?.115:.145,vol:open?.15:.17});radioHiss.gain.setTargetAtTime(open?.040:.0015,ctx.currentTime,open?.010:.070);}
  function shiftThump(up=true){if(!ctx||!enabled)return;const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime;o.type='sine';o.frequency.setValueAtTime(up?78:102,t);o.frequency.exponentialRampToValueAtTime(45,t+.065);g.gain.setValueAtTime(.058,t);g.gain.exponentialRampToValueAtTime(.001,t+.080);o.connect(g).connect(gameBus);o.start(t);o.stop(t+.095);engineBus.gain.setTargetAtTime(.050,t,.006);engineBus.gain.setTargetAtTime(.14,t+.050,.040);}
  function markNow(){const r=R.radio||[];lastRadioId=r.length?r[r.length-1].id:null;queue.length=0;stage='NONE';stageCar=null;}
  function setEnabled(on){enabled=!!on;init();if(enabled){ctx.resume?.();master.gain.setTargetAtTime(.29,ctx.currentTime,.04);markNow();}else{master.gain.setTargetAtTime(0,ctx.currentTime,.04);synth()?.cancel?.();speaking=false;markNow();}}
  function setFocus(id){const n=Number(id)||0;if(n!==focus){focus=n;lastGear=0;markNow();}else focus=n;}

  function radioText(msg){
    let t=String(msg.text||'').replaceAll('·',', ').replace(/\bDRS\b/g,'D R S').replace(/\bVSC\b/g,'virtual safety car').replace(/\bSC\b/g,'safety car').replace(/\bP(\d+)\b/g,'position $1').replace(/\bBOX\b/g,'box');
    t=t.replace(/\.\s+/g,'.  ').replace(/,\s*/g,', ');return t;
  }
  function voices(){return synth()?.getVoices?.()||[];}
  function scoreVoice(v,driver=false){
    const n=String(v.name||'').toLowerCase(),l=String(v.lang||'');let s=0;
    if(/^en-GB/i.test(l))s+=driver?7:10;else if(/^en-(US|AU|IE)/i.test(l))s+=7;else if(/^en/i.test(l))s+=4;
    if(/premium|enhanced|natural|neural|siri/.test(n))s+=16;
    if(/daniel|oliver|arthur|jamie|tom/.test(n))s+=driver?4:8;
    if(/alex|samantha|ava|serena|moira/.test(n))s+=driver?6:2;
    if(v.default)s+=1;return s;
  }
  function engineerVoice(){return [...voices()].sort((a,b)=>scoreVoice(b,false)-scoreVoice(a,false))[0]||null;}
  function driverVoice(){const eng=engineerVoice();return [...voices()].filter(v=>v!==eng).sort((a,b)=>scoreVoice(b,true)-scoreVoice(a,true))[0]||eng||null;}
  function makeUtterance(msg){const driver=msg.kind==='DRIVER',v=driver?driverVoice():engineerVoice(),u=new SpeechSynthesisUtterance(radioText(msg));if(v)u.voice=v;u.lang=v?.lang||'en-GB';u.rate=driver?.98:1.00;u.pitch=driver?.97:.91;u.volume=1;return u;}
  function finishTransmission(){ptt(false);setTimeout(()=>{gameBus?.gain.setTargetAtTime(1,ctx.currentTime,.13);speaking=false;setTimeout(speakNext,90);},155);}
  function speakImmediate(msg,{cancel=false}={}){const s=synth();if(!s||!enabled)return false;if(cancel)s.cancel();const u=makeUtterance(msg);speaking=true;gameBus?.gain.setTargetAtTime(.34,ctx.currentTime,.045);ptt(true);u.onstart=()=>{speechUnlocked=true;radioHiss?.gain.setTargetAtTime(.018,ctx.currentTime,.06);};u.onend=finishTransmission;u.onerror=finishTransmission;setTimeout(()=>s.speak(u),175);return true;}
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
      const p=profiles[c.type]||profiles.gt,kmh=Math.max(0,c.v*3.6),gear=Math.max(1,Math.min(8,Math.floor(kmh/38)+1)),norm=clamp(kmh/330,0,1),rpm=2500+norm*8800+gear*165,base=p.idle+rpm*.0175*p.rev;
      if(engineA.o.type!==p.a){engineA.o.type=p.a;engineB.o.type=p.b;engineC.o.type=p.c;}
      engineA.o.frequency.setTargetAtTime(base*p.harm[0],ctx.currentTime,.030);engineB.o.frequency.setTargetAtTime(base*p.harm[1],ctx.currentTime,.035);engineC.o.frequency.setTargetAtTime(base*p.harm[2],ctx.currentTime,.040);
      engineFilter.frequency.setTargetAtTime(p.filter*(.58+.42*norm),ctx.currentTime,.07);engineFilter.Q.setTargetAtTime(.45+norm*.38,ctx.currentTime,.10);
      const load=clamp(.30+norm*.70-(c.brakeVisual||0)*.42-(c.liftCoast||0)*.42,0,1);engineBus.gain.setTargetAtTime((speaking?.070:.105)+load*.068,ctx.currentTime,.040);
      hybrid.o.frequency.setTargetAtTime(650+norm*1200+(c.ers||0)*110,ctx.currentTime,.055);hybrid.g.gain.setTargetAtTime(p.hybrid*norm*(c.energyMode==='PUSH'?1.12:.76),ctx.currentTime,.08);
      windGain.gain.setTargetAtTime(.004+norm*.043,ctx.currentTime,.10);windGain._filter.frequency.setTargetAtTime(480+norm*1120,ctx.currentTime,.11);
      const spin=c.spinState==='SLIDE'?1:0,lock=c.spinState==='LOCKUP'?1:0,slip=clamp((c.brakeVisual||0)*.40+(c.flatSpot?.18:0)+(c.hydroplaning?.28:0)+spin*.75+lock*.56,0,1);
      tyreGain.gain.setTargetAtTime(slip*.052,ctx.currentTime,.025);tyreGain._filter.frequency.setTargetAtTime(1150+kmh*4.7,ctx.currentTime,.05);
      const brakeHot=clamp(((c.brakeTemp||300)-520)/420,0,1)*(c.brakeVisual||0);brakeGain.gain.setTargetAtTime(brakeHot*.013,ctx.currentTime,.055);brakeGain._filter.frequency.setTargetAtTime(3000+brakeHot*1500,ctx.currentTime,.09);
      if(gear!==lastGear&&lastGear>0)shiftThump(gear>lastGear);lastGear=gear;
    }
    ingestRadio();
  }
  return{toggle,testRadio,update,setFocus,get enabled(){return enabled},get speaking(){return speaking},get speechUnlocked(){return speechUnlocked},get speechSupported(){return !!window.speechSynthesis},get voice(){return engineerVoice()?.name||'system'}};
}
