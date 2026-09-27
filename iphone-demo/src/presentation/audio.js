export function createRaceAudio(){
  let ctx=null,osc=null,gain=null,muted=true,runtimeActive=true;
  function silence(immediate=false){
    if(!ctx||!gain)return;
    if(immediate){gain.gain.cancelScheduledValues(ctx.currentTime);gain.gain.setValueAtTime(0,ctx.currentTime);}
    else gain.gain.setTargetAtTime(0,ctx.currentTime,.04);
  }
  function resumeIfAllowed(){
    if(!ctx||muted||!runtimeActive||ctx.state!=='suspended')return;
    const promise=ctx.resume();
    promise?.catch?.(()=>{});
  }
  function start(){
    if(ctx){resumeIfAllowed();return;}
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    osc=ctx.createOscillator();gain=ctx.createGain();
    osc.type='sawtooth';gain.gain.value=0;
    osc.connect(gain).connect(ctx.destination);osc.start();
    if(!runtimeActive){silence(true);const promise=ctx.suspend();promise?.catch?.(()=>{});}
  }
  function setMuted(v){
    muted=!!v;
    if(muted){silence(true);return;}
    resumeIfAllowed();
  }
  function setRuntimeActive(v){
    const next=!!v;
    if(runtimeActive===next)return;
    runtimeActive=next;
    if(!ctx)return;
    if(!runtimeActive){
      silence(true);
      if(ctx.state==='running'){const promise=ctx.suspend();promise?.catch?.(()=>{});}
    }else resumeIfAllowed();
  }
  function update(car){
    if(!ctx||!osc||!gain||!car)return;
    osc.frequency.setTargetAtTime(80+car.v*7.2,ctx.currentTime,.045);
    gain.gain.setTargetAtTime(muted||!runtimeActive?0:.022,ctx.currentTime,.08);
  }
  function diagnostics(){return{owner:'presentation-audio-v2',muted,runtimeActive,started:!!ctx,contextState:ctx?.state??'none'};}
  return{start,setMuted,setRuntimeActive,update,diagnostics,get muted(){return muted;},get runtimeActive(){return runtimeActive;}};
}
