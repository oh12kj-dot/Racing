export function createBarrierSafety(W,R){
  const metrics={corrections:0,deepCorrections:0,maxPenetration:0,lastCarId:null};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function resolveCar(c){
    if(!c?.mesh||c.retired||c.pitState!=='NONE'||!W.barrierContact)return;
    let corrected=false,totalPush=0,lastHit=null;
    for(let i=0;i<4;i++){
      const hit=W.barrierContact(c);if(!hit)break;lastHit=hit;
      const pen=Math.max(0,Number(hit.penetration)||0),push=clamp(pen+.14,.10,1.45),q=W.sample(c.s,c.lane),latPush=hit.inward.dot(q.side)*push;
      c.mesh.position.addScaledVector(hit.inward,push);totalPush+=push;corrected=true;
      metrics.corrections++;metrics.maxPenetration=Math.max(metrics.maxPenetration,pen);metrics.lastCarId=c.id;
      if(pen>.8)metrics.deepCorrections++;
      // Persist the correction for normal driving. Spin motion has its own lateral
      // state in the legacy provider; visually correct it every frame here and let
      // that provider absorb the lateral correction on its next impact tick.
      if(c.spinState==='NONE')c.lane=clamp((c.lane||0)+latPush,-5.6,5.6);
      c.laneTarget=clamp((c.laneTarget||0)+latPush*.9,-4.6,4.6);
      c.v=Math.max(0,(c.v||0)*(i===0?.992:.975));
    }
    if(!corrected)return;
    const residual=W.barrierContact(c);
    if(residual){
      // Emergency separation for broadside/deep contacts where the collider's
      // regular penetration cap needs more than four iterations.
      const q=W.sample(c.s,c.lane),push=2.0,latPush=residual.inward.dot(q.side)*push;
      c.mesh.position.addScaledVector(residual.inward,push);
      if(c.spinState==='NONE')c.lane=clamp((c.lane||0)+latPush,-5.2,5.2);
      c.laneTarget=clamp((c.laneTarget||0)+latPush,-4.3,4.3);c.v=Math.min(c.v||0,16);
      metrics.deepCorrections++;metrics.lastCarId=c.id;
    }
    c.guardrailCorrection=true;c.guardrailCorrectionPush=totalPush;c.guardrailSide=lastHit?.collider?.sideSign??null;
  }

  function update(){for(const c of R.cars)resolveCar(c);}
  function diagnostics(){return{...metrics,active:R.cars.filter(c=>c.guardrailCorrection).map(c=>({id:c.id,push:c.guardrailCorrectionPush,side:c.guardrailSide,state:c.spinState}))};}
  return{update,diagnostics,get metrics(){return{...metrics}}};
}
