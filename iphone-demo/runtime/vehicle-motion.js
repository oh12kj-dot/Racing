export function createVehicleMotion(W,R,{mobile=false}={}){
  const states=new Map(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));let acc=0,updates=0;
  function bodyFor(c){return c?.mesh?.userData?.renderAsset||c?.mesh?.userData?.visual||null;}
  function update(dt=.016){
    acc+=Math.max(0,Number(dt)||0);const step=mobile?1/30:1/45;if(acc<step)return;const frameDt=acc;acc=0;
    for(const c of R.cars||[]){
      if(!c?.mesh||c.retired)continue;const body=bodyFor(c);if(!body)continue;
      let s=states.get(c.id);if(!s){s={pitch:0,roll:0,baseX:body.rotation.x||0,baseZ:body.rotation.z||0,body};states.set(c.id,s);}if(s.body!==body){s.body=body;s.baseX=body.rotation.x||0;s.baseZ=body.rotation.z||0;s.pitch=0;s.roll=0;}
      const brake=clamp(Number(c.racingBrake??c.brakeVisual)||0,0,1),throttle=clamp(Number(c.racingThrottle)||0,0,1),k=Number(W.racingCurvatureAt?.(c.s)??W.curvatureAt?.(c.s))||0,v=Math.max(0,Number(c.v)||0);
      const pitchTarget=clamp(brake*.030-throttle*.012,-.016,.034),lat=clamp(v*v*k/9.81,-3.5,3.5),rollTarget=clamp(-lat*.010,-.038,.038),f=1-Math.exp(-frameDt*8);
      s.pitch+=(pitchTarget-s.pitch)*f;s.roll+=(rollTarget-s.roll)*f;body.rotation.x=s.baseX+s.pitch;body.rotation.z=s.baseZ+s.roll;
    }updates++;
  }
  return{update,get diagnostics(){return{owner:'runtime-vehicle-motion-v1',updates,cars:states.size,rateHz:mobile?30:45}}};
}
