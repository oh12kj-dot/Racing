export function createVehicleMotion(W,R,{mobile=false}={}){
  const states=new Map(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));let acc=0,updates=0,curbFrames=0,lockupFrames=0;
  function bodyFor(c){return c?.mesh?.userData?.renderAsset||c?.mesh?.userData?.visual||null;}
  function update(dt=.016){
    acc+=Math.max(0,Number(dt)||0);const step=mobile?1/30:1/45;if(acc<step)return;const frameDt=acc;acc=0;
    for(const c of R.cars||[]){
      if(!c?.mesh||c.retired)continue;const body=bodyFor(c);if(!body)continue;
      let s=states.get(c.id);if(!s){s={pitch:0,roll:0,heave:0,prevV:Number(c.v)||0,baseX:body.rotation.x||0,baseZ:body.rotation.z||0,baseY:body.position.y||0,body};states.set(c.id,s);}if(s.body!==body){s.body=body;s.baseX=body.rotation.x||0;s.baseZ=body.rotation.z||0;s.baseY=body.position.y||0;s.pitch=0;s.roll=0;s.heave=0;s.prevV=Number(c.v)||0;}
      const v=Math.max(0,Number(c.v)||0),dv=(v-s.prevV)/Math.max(.001,frameDt),longG=clamp(dv/9.81,-2.2,1.4),brake=clamp(Number(c.racingBrake??c.brakeVisual)||0,0,1),throttle=clamp(Number(c.racingThrottle)||0,0,1),k=Number(W.racingCurvatureAt?.(c.s)??W.curvatureAt?.(c.s))||0;
      const latG=clamp(v*v*k/9.81,-3.8,3.8),slip=clamp(Number(c.slipAngle)||0,-1.2,1.2),lock=c.spinState==='LOCKUP',slide=c.spinState==='SLIDE';
      const pitchTarget=clamp(-longG*.012+brake*.013-throttle*.005,-.022,.044),rollTarget=clamp(-latG*.010-slip*.010,-.050,.050);
      const onKerb=!!c.onKerb||String(c.surfaceType||c.surface||'').toUpperCase().includes('KERB')||(Math.abs(Number(c.lane)||0)>3.02&&v>22);
      const curbWave=onKerb?Math.sin(((Number(c.s)||0)*1.65)+(R.race?.t||0)*v*.55)*clamp((v-18)/65,0,.012):0;
      const lockShake=lock?Math.sin((R.race?.t||0)*44+c.id)*.0045:0,slideDrop=slide?-.006:0;
      const heaveTarget=clamp(-Math.abs(latG)*.0018-Math.max(0,-longG)*.0022+curbWave+lockShake+slideDrop,-.016,.014);
      const pitchF=1-Math.exp(-frameDt*9.5),rollF=1-Math.exp(-frameDt*8.0),heaveF=1-Math.exp(-frameDt*(onKerb||lock?18:10));
      s.pitch+=(pitchTarget-s.pitch)*pitchF;s.roll+=(rollTarget-s.roll)*rollF;s.heave+=(heaveTarget-s.heave)*heaveF;
      body.rotation.x=s.baseX+s.pitch;body.rotation.z=s.baseZ+s.roll;body.position.y=s.baseY+s.heave;s.prevV=v;
      if(onKerb)curbFrames++;if(lock)lockupFrames++;
      c.bodyMotionTelemetry={pitch:s.pitch,roll:s.roll,heave:s.heave,longG,latG,onKerb,lockup:lock,slide};
    }updates++;
  }
  return{update,get diagnostics(){return{owner:'runtime-vehicle-motion-v2',updates,cars:states.size,rateHz:mobile?30:45,curbFrames,lockupFrames}}};
}
