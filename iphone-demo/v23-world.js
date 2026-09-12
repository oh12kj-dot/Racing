import {buildWorld as buildV21World} from './v21-world.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV21World(THREE,TRACK,settings,circuitName);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

  // v12 pit animation used additive Z rotation on the mounted wheel group.
  // That angle accumulated every frame and survived the stop because reset restored
  // only position. Keep the axle alignment fixed and animate removal only along X.
  W.animatePitStopCar=(car,progress=0)=>{
    if(!car?.mesh)return;
    const wheels=car.mesh.userData.wheels||[];
    const u=car.mesh.userData;
    if(!u.v23PitWheelBase||u.v23PitWheelBase.length!==wheels.length){
      u.v23PitWheelBase=wheels.map(w=>w.position.clone());
      u.v23PitWheelAlign=wheels.map(w=>({y:w.rotation.y,z:w.rotation.z}));
    }
    const p=clamp(progress,0,1);
    for(let i=0;i<wheels.length;i++){
      const w=wheels[i],b=u.v23PitWheelBase[i],a=u.v23PitWheelAlign[i];
      if(!w||!b)continue;
      const side=b.x<0?-1:1;
      let out=0;
      if(p>.28&&p<.76){
        const remove=ease((p-.28)/.10),install=ease((p-.64)/.12);
        out=remove*(1-install)*.34;
      }
      w.position.copy(b);
      w.position.x+=side*out;
      // rotation.x is the legitimate rolling angle and is owned by race pose logic.
      // Never tilt the wheel around Y/Z during a tyre stop.
      if(a){w.rotation.y=a.y;w.rotation.z=a.z;}
    }
  };

  W.resetPitStopCar=car=>{
    const wheels=car?.mesh?.userData?.wheels||[],u=car?.mesh?.userData||{},bases=u.v23PitWheelBase||[],align=u.v23PitWheelAlign||[];
    for(let i=0;i<wheels.length;i++){
      const w=wheels[i];if(!w)continue;
      if(bases[i])w.position.copy(bases[i]);
      if(align[i]){w.rotation.y=align[i].y;w.rotation.z=align[i].z;}
    }
  };

  // The mechanic's loose tyre prop was also spun around Z even though its axle is X.
  // Normalize those prop groups after the inherited crew update so they stay upright.
  const pitRoot=W.scene.getObjectByName?.('PIT_ANIMATION_V12');
  const tyreProps=[];
  pitRoot?.traverse?.(o=>{
    if(!o?.isGroup)return;
    const hasTyre=o.children?.some(c=>c.geometry?.type==='TorusGeometry');
    const hasHub=o.children?.some(c=>c.geometry?.type==='CylinderGeometry');
    if(hasTyre&&hasHub)tyreProps.push(o);
  });
  const crewUpdate=W.updateDetailedPitCrews?.bind(W);
  if(crewUpdate){
    W.updateDetailedPitCrews=(details=[],dt=.016)=>{
      crewUpdate(details,dt);
      for(const wheel of tyreProps){
        wheel.rotation.y=0;
        wheel.rotation.z=0;
      }
    };
  }

  return W;
}
