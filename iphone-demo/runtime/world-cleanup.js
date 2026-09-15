export function cleanupLegacyWorld(W){
  const disposed=new Set();
  const disposeTree=o=>o?.traverse?.(x=>{
    if(x.geometry&&!disposed.has(x.geometry)){disposed.add(x.geometry);x.geometry.dispose?.();}
    const mats=Array.isArray(x.material)?x.material:[x.material];for(const m of mats){if(m&&!disposed.has(m)){disposed.add(m);m.dispose?.();}}
  });
  const detach=o=>{if(!o?.parent)return 0;o.parent.remove(o);disposeTree(o);return 1;};

  // These compatibility pit complexes have already donated their kinematic API
  // to v42/runtime. Their render trees are explicitly hidden before this cleanup,
  // so retaining them only wastes memory/GPU resources.
  const obsoleteNames=['PIT_COMPLEX_V11','PIT_COMPLEX_V41'];
  let legacyRootsRemoved=0;
  for(const name of obsoleteNames){const o=W.scene?.getObjectByName?.(name);if(o&&o.visible===false)legacyRootsRemoved+=detach(o);}

  // The circuit-specific Suzuka layers supersede the original generic scenery
  // that world-core created before the circuit had dedicated landmarks. Keeping
  // both layers caused duplicate stands/gantries and left random legacy trees in
  // locations that no longer respected the full figure-eight clearance rules.
  let legacyTreesRemoved=0,legacyStandsRemoved=0,legacyGantryRemoved=0;
  const hasSuzukaReplacement=String(W.circuitName||'').toUpperCase()==='SUZUKA'&&!!W.scene?.getObjectByName?.('SUZUKA_FULL_SCENE_RUNTIME');
  if(hasSuzukaReplacement){
    const direct=[...(W.scene?.children||[])],remove=[];
    for(const o of direct){
      if(!o||!o.parent)continue;
      if(o.isMesh&&o.geometry){
        const p=o.geometry.parameters||{};
        const oldTrunk=o.geometry.type==='CylinderGeometry'&&Math.abs((p.height||0)-5.5)<.08&&(p.radialSegments||0)===6;
        const oldCrown=o.geometry.type==='IcosahedronGeometry'&&(p.radius||0)>3.5;
        if(oldTrunk||oldCrown){remove.push({o,kind:'tree'});continue;}
      }
      if(!o.isGroup)continue;
      let tiers=0,posts=0,beam=0;
      o.traverse?.(x=>{
        if(!x?.isMesh||x.geometry?.type!=='BoxGeometry')return;const p=x.geometry.parameters||{};
        if(Math.abs((p.width||0)-38)<.08&&Math.abs((p.height||0)-1.2)<.08&&Math.abs((p.depth||0)-5)<.08)tiers++;
        if(Math.abs((p.width||0)-.5)<.04&&Math.abs((p.height||0)-7)<.08&&Math.abs((p.depth||0)-.5)<.04)posts++;
        if(Math.abs((p.width||0)-19)<.10&&Math.abs((p.height||0)-.65)<.05&&Math.abs((p.depth||0)-.7)<.05)beam++;
      });
      if(tiers>=5)remove.push({o,kind:'stand'});
      else if(posts>=2&&beam>=1)remove.push({o,kind:'gantry'});
    }
    for(const x of remove){if(!x.o.parent)continue;if(detach(x.o)){if(x.kind==='tree')legacyTreesRemoved++;else if(x.kind==='stand')legacyStandsRemoved++;else legacyGantryRemoved++;}}
  }

  const root=W.scene?.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');
  if(!root){W.legacyWorldCleanup={removed:0,groupsRemoved:0,legacyRootsRemoved,legacyTreesRemoved,legacyStandsRemoved,legacyGantryRemoved,disposedResources:disposed.size};return W.legacyWorldCleanup;}
  const remove=[];
  root.traverse?.(o=>{if(o!==root&&o.visible===false&&(!o.parent||o.parent.visible!==false))remove.push(o);});
  let removed=0;
  for(const o of remove)removed+=detach(o);
  let groupsRemoved=0,changed=true;
  while(changed){
    changed=false;
    const empty=[];root.traverse?.(o=>{if(o!==root&&o.isGroup&&o.children.length===0&&o.parent)empty.push(o);});
    for(const o of empty){if(o.parent){o.parent.remove(o);groupsRemoved++;changed=true;}}
  }
  W.legacyWorldCleanup={removed,groupsRemoved,legacyRootsRemoved,legacyTreesRemoved,legacyStandsRemoved,legacyGantryRemoved,disposedResources:disposed.size};
  return W.legacyWorldCleanup;
}
