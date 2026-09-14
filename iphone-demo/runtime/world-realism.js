import {buildWorld as buildStableWorld} from './world.js';
import {SUZUKA_PIT} from './config.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildStableWorld(THREE,TRACK,settings,circuitName);

  // The pit path crosses start/finish, so only the wrapped exit-side segment
  // belongs to the next lap. Using the pit entry as the unwrap threshold made a
  // car immediately before entry look almost one full lap beyond its pit box;
  // crossing the entry line then flipped that coordinate backwards by ~1 lap.
  // Keep the longitudinal pit coordinate continuous through entry instead.
  const total=Math.max(1,Number(W.total)||1),wrapF=f=>((f%1)+1)%1,exitWrap=wrapF(SUZUKA_PIT.exitEndUF);
  W.pitUnwrappedFraction=s=>{
    const f=wrapF((Number(s)||0)/total);
    return f<=exitWrap?f+1:f;
  };
  W.pitCoordinateAudit={owner:'runtime-pit-coordinate-v2',entryUF:SUZUKA_PIT.entryUF,exitEndUF:SUZUKA_PIT.exitEndUF,wrapCutoff:exitWrap,continuousAcrossEntry:true};

  // Improve distant depth precision without clipping ordinary chase/onboard cameras.
  if(W.camera){W.camera.near=Math.max(.55,Number(W.camera.near)||.1);W.camera.far=Math.min(3400,Number(W.camera.far)||3400);W.camera.updateProjectionMatrix();}

  const baseMake=W.makeCar.bind(W),bodyFitTypes=new Set(['gt','touring']);
  W.makeCar=(color,type)=>{
    const car=baseMake(color,type),livery=car.userData?.livery;
    if(bodyFitTypes.has(type)&&livery?.group){
      // Planar sponsor/sweep geometry cannot conform to every procedural/GLB body.
      // Keep the native paint/accent/carbon panels, but suppress all free-floating
      // livery geometry for GT and touring cars so nothing protrudes or hovers.
      livery.group.visible=false;livery.mode='native-body-panels';livery.freeFloatingGraphics=false;
      car.userData.bodyLiveryMode='native-body-panels';
    }
    return car;
  };

  W.vehicleSizeAudit={owner:'runtime-real-scale-v1',targets:W.vehicleDimensionTargets||null,gt:W.vehicleDimensionTargets?.gt||null,touring:W.vehicleDimensionTargets?.touring||null};
  W.distantRenderPolicy={owner:'runtime-distant-clarity-v1',cameraNear:W.camera?.near,cameraFar:W.camera?.far};
  return W;
}
