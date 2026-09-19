export function enhanceBarrierMaterials(W){
  if(!W)return W;
  W.barrierMaterialAt=s=>(W.braking?.(s)||0)>.70?'TYRE':'GUARDRAIL';
  const base=W.barrierContact?.bind(W);
  if(base)W.barrierContact=car=>{const hit=base(car);if(hit?.collider)hit.collider.material=W.barrierMaterialAt(car?.s||0);return hit;};
  return W;
}
