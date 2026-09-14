export function createBarrierSafety(W,R){
  const metrics={corrections:0,deepCorrections:0,spinRecoveries:0,maxPenetration:0,lastCarId:null};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function resolveCar(c){
    if(!c?.mesh||c.retired||c.pitState!=='NONE'||!W.barrierContact)return;
    let corrected=false,totalPush=0,lastHit=null,maxPen=0;
    for(let i=0;i<5;i++){
      const hit=W.barrierContact(c);if(!hit)break;lastHit=hit;
      const pen=Math.max(0,Number(hit.penetration)||0),push=clamp(pen+.16,.12,1.55),q=W.sample(c.s,c.lane),latPush=hit.inward.dot(q.side)*push;
      c.mesh.position.addScaledVector(hit.inward,push);totalPush+=push;corrected=true;maxPen=Math.max(maxPen,pen);
      metrics.corrections++;metrics.maxPenetration=Math.max(metrics.maxPenetration,pen);metrics.lastCarId=c.id;
      if(pen>.72)metrics.deepCorrections++;
      // A non-spinning car can safely carry the correction into track-local state.
      // During a spin, the legacy solver also owns an internal lateral offset, so
      // changing c.lane here would double-apply the displacement next frame.
      if(c.spinState==='NONE')c.lane=clamp((c.lane||0)+latPush,-5.6,5.6);
      c.laneTarget=clamp((c.laneTarget||0)+latPush*.95,-4.6,4.6);
      c.v=Math.max(0,(c.v||0)*(i===0?.988:.965));
    }
    if(!corrected)return;

    let residual=W.barrierContact(c);
    if(residual){
      const q=W.sample(c.s,c.lane),push=2.25,latPush=residual.inward.dot(q.side)*push;
      c.mesh.position.addScaledVector(residual.inward,push);
      if(c.spinState==='NONE')c.lane=clamp((c.lane||0)+latPush,-5.15,5.15);
      c.laneTarget=clamp((c.laneTarget||0)+latPush,-4.15,4.15);c.v=Math.min(c.v||0,13);
      metrics.deepCorrections++;metrics.lastCarId=c.id;totalPush+=push;
      residual=W.barrierContact(c);
    }

    // Persistent barrier overlap while sliding is the visual failure mode where a
    // car appears to drive inside the guardrail. End the active slide and let the
    // existing recovery solver decay its lateral spin offset away from the wall.
    if(c.spinState==='SLIDE'&&(maxPen>.42||residual||totalPush>1.1)){
      c.spinState='RECOVER';c.spinTimer=Math.max(Number(c.spinTimer)||0,.38);
      c.slipAngle=0;c.counterSteer=0;c.hazardAvoiding=true;c.avoid=Math.max(c.avoid||0,1.2);
      c.v=Math.min(c.v||0,12);metrics.spinRecoveries++;
    }

    // Last visual safety net: never leave a render frame intersecting a barrier.
    // This is intentionally independent of the legacy impact/damage cooldown.
    for(let i=0;i<3;i++){
      residual=W.barrierContact(c);if(!residual)break;
      const push=clamp((Number(residual.penetration)||0)+.24,.24,1.7);
      c.mesh.position.addScaledVector(residual.inward,push);totalPush+=push;metrics.corrections++;
    }
    c.guardrailCorrection=true;c.guardrailCorrectionPush=totalPush;c.guardrailSide=lastHit?.collider?.sideSign??null;
  }

  function update(){
    for(const c of R.cars){c.guardrailCorrection=false;c.guardrailCorrectionPush=0;c.guardrailSide=null;resolveCar(c);}
  }
  function diagnostics(){return{...metrics,active:R.cars.filter(c=>c.guardrailCorrection).map(c=>({id:c.id,push:c.guardrailCorrectionPush,side:c.guardrailSide,state:c.spinState}))};}
  return{update,diagnostics,get metrics(){return{...metrics}}};
}
