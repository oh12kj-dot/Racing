export function createRaceAudio(){
  let ctx=null,osc=null,gain=null,muted=true;
  function start(){
    if(ctx)return;
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    osc=ctx.createOscillator();gain=ctx.createGain();
    osc.type='sawtooth';gain.gain.value=0;
    osc.connect(gain).connect(ctx.destination);osc.start();
  }
  function setMuted(v){muted=!!v;if(ctx&&ctx.state==='suspended')ctx.resume();}
  function update(car){
    if(!ctx||!osc||!gain||!car)return;
    osc.frequency.setTargetAtTime(80+car.v*7.2,ctx.currentTime,.045);
    gain.gain.setTargetAtTime(muted?0:.022,ctx.currentTime,.08);
  }
  return{start,setMuted,update,get muted(){return muted;}};
}
