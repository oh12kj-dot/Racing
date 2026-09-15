import {buildWorld as buildSuzukaFull} from './world-suzuka-full.js';

// Final safety pass after all Suzuka layers have been assembled.  The full scene
// already rejects trees against a dense centre-line cache, but a second pass with
// an independently phased, higher-density sample prevents a tree from slipping
// through the small gaps between discrete samples on tight/figure-eight geometry.
export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildSuzukaFull(THREE,TRACK,settings,circuitName);
  if(String(circuitName||'').toUpperCase()!=='SUZUKA')return W;
  const F=W.suzukaFullScene,root=F?.root;if(!F||!root)return W;
  const trunks=root.getObjectByName?.('SUZUKA_PERIMETER_TREE_TRUNKS'),crowns=root.getObjectByName?.('SUZUKA_PERIMETER_TREE_CROWNS');
  if(!trunks||!crowns)return W;

  const samples=3600,minClearance=21.5,minSq=minClearance*minClearance,track=[];
  for(let i=0;i<samples;i++){const p=W.sample(W.total*(i+.37)/samples).p;track.push([p.x,p.z]);}
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),safe=[];
  for(let i=0;i<trunks.count;i++){
    trunks.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);let best=Infinity;
    for(const [x,z] of track){const dx=position.x-x,dz=position.z-z,d=dx*dx+dz*dz;if(d<best)best=d;if(best<minSq)break;}
    if(best>=minSq)safe.push(i);
  }
  const originalCount=trunks.count;
  if(safe.length!==originalCount){
    const a=new THREE.Matrix4(),b=new THREE.Matrix4();
    safe.forEach((source,target)=>{trunks.getMatrixAt(source,a);crowns.getMatrixAt(source,b);trunks.setMatrixAt(target,a);crowns.setMatrixAt(target,b);});
    trunks.count=safe.length;crowns.count=safe.length;trunks.instanceMatrix.needsUpdate=true;crowns.instanceMatrix.needsUpdate=true;
  }
  const pruned=originalCount-safe.length;
  F.treeInstances=safe.length;F.treeRejected=(F.treeRejected||0)+pruned;F.finalClearancePass={samples,minClearance,pruned};F.minTreeTrackClearance=minClearance;
  const belt=F.landmarks?.find?.(x=>x.name==='PERIMETER_TREE_BELT');if(belt){belt.instances=safe.length;belt.rejected=(belt.rejected||0)+pruned;belt.minTrackClearance=minClearance;}
  const priorAudit=W.auditCircuit?.bind(W);
  W.auditCircuit=()=>{const a=priorAudit?priorAudit():{},s=a.suzukaFullScene||{};return{...a,version:'runtime-2026.09.15-r15',suzukaFullScene:{...s,treeInstances:F.treeInstances,treeRejected:F.treeRejected,minTreeTrackClearance:minClearance,finalClearancePass:{...F.finalClearancePass}},notes:[...(a.notes||[]),`Final Suzuka tree clearance pass: ${samples} independently phased samples, ${minClearance}m minimum; ${pruned} extra tree instances pruned.`]};};
  W.circuitAudit=W.auditCircuit();
  return W;
}
