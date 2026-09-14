export function createBarrierSafety(W,R){
  const metrics={corrections:0,deepCorrections:0,spinRecoveries:0,pitIntentCorrections:0,maxPenetration:0,lastCarId:null};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rawBarrierContact=typeof W.barrierContact==='function'?W.barrierContact.bind(W):null;

  // The historical V42 collision query ignored every car as soon as pitState was
  // set to ENTRY. Strategy can set ENTRY well before the physical pit opening,
  // which made the ordinary track guardrail disappear for exactly those cars.
  // Keep that legacy query for its mature OBB/segment math, but bypass its pit
  // shortcut until the car is actually inside the runtime pit corridor.
  function barrierContact(c){
    if(!rawBarrierContact||!c?.mesh||c.retired)return null;
    const state=c.pitState;
    if(!state||state==='NONE')return rawBarrierContact(c);
    if(W.inPitWindow?.(c.s))return null;
    c.pitState='NONE';
    try{return rawBarrierContact(c);}
    finally{c.pitState=state;}
  }
  if(rawBarrierContact)W.barrierContact=barrierContact;

  function resolveCar(c){
    // A car can be marked ENTRY before it physically reaches the pit opening.
    // Keep guardrail protection active until the car is actually inside the
    // runtime pit corridor; otherwise pit-bound cars can visually drive through
    // the normal track barrier on approach.
    const physicallyInPit=c?.pitState!=='NONE'&&!!W.inPitWindow?.(c.s);
    if(!c?.mesh||c.retired||physicallyInPit||!rawBarrierContact)return false;
    const pitIntent=c.pitState!=='NONE';
    let corrected=false,totalPush=0,lastHit=null,maxPen=0;
    for(let i=0;i<5;i++){
      const hit=barrierContact(c);if(!hit)break;lastHit=hit;
      const pen=Math.max(0,Number(hit.penetration)||0),push=clamp(pen+.16,.12,1.55),q=W.sample(c.s,c.lane),latPush=hit.inward.dot(q.side)*push;
      c.mesh.position.addScaledVector(hit.inward,push);totalPush+=push;corrected=true;maxPen=Math.max(maxPen,pen);
      metrics.corrections++;metrics.maxPenetration=Math.max(metrics.maxPenetration,pen);metrics.lastCarId=c.id;if(pen>.72)metrics.deepCorrections++;
      if(c.spinState==='NONE')c.lane=clamp((c.lane||0)+latPush,-5.6,5.6);
      c.laneTarget=clamp((c.laneTarget||0)+latPush*.95,-4.6,4.6);c.v=Math.max(0,(c.v||0)*(i===0?.988:.965));
    }
    if(!corrected)return false;
    if(pitIntent)metrics.pitIntentCorrections++;

    let residual=barrierContact(c);
    if(residual){
      const q=W.sample(c.s,c.lane),push=2.25,latPush=residual.inward.dot(q.side)*push;c.mesh.position.addScaledVector(residual.inward,push);
      if(c.spinState==='NONE')c.lane=clamp((c.lane||0)+latPush,-5.15,5.15);
      c.laneTarget=clamp((c.laneTarget||0)+latPush,-4.15,4.15);c.v=Math.min(c.v||0,13);metrics.deepCorrections++;metrics.lastCarId=c.id;totalPush+=push;residual=barrierContact(c);
    }

    if(c.spinState==='SLIDE'&&(maxPen>.42||residual||totalPush>1.1)){
      c.spinState='RECOVER';c.spinTimer=Math.max(Number(c.spinTimer)||0,.38);c.slipAngle=0;c.counterSteer=0;c.hazardAvoiding=true;c.avoid=Math.max(c.avoid||0,1.2);c.v=Math.min(c.v||0,12);metrics.spinRecoveries++;
    }

    for(let i=0;i<3;i++){
      residual=barrierContact(c);if(!residual)break;const push=clamp((Number(residual.penetration)||0)+.24,.24,1.7);c.mesh.position.addScaledVector(residual.inward,push);totalPush+=push;metrics.corrections++;
    }
    c.guardrailCorrection=true;c.guardrailCorrectionPush=totalPush;c.guardrailSide=lastHit?.collider?.sideSign??null;return true;
  }

  function update(){for(const c of R.cars){c.guardrailCorrection=false;c.guardrailCorrectionPush=0;c.guardrailSide=null;resolveCar(c);}}
  function diagnostics(){return{...metrics,active:R.cars.filter(c=>c.guardrailCorrection).map(c=>({id:c.id,push:c.guardrailCorrectionPush,side:c.guardrailSide,state:c.spinState}))};}
  return{update,enforceCar:resolveCar,diagnostics,get metrics(){return{...metrics}}};
}
