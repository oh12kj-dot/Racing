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

  const root=W.scene?.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');
  if(!root){W.legacyWorldCleanup={removed:0,groupsRemoved:0,legacyRootsRemoved,disposedResources:disposed.size};return W.legacyWorldCleanup;}
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
  W.legacyWorldCleanup={removed,groupsRemoved,legacyRootsRemoved,disposedResources:disposed.size};
  return W.legacyWorldCleanup;
}
