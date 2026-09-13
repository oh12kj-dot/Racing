export function cleanupLegacyWorld(W){
  const root=W.scene?.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42');
  if(!root)return{removed:0,groupsRemoved:0};
  const remove=[];
  root.traverse?.(o=>{if(o!==root&&o.visible===false)remove.push(o);});
  let removed=0;
  for(const o of remove){
    if(!o.parent)continue;o.parent.remove(o);removed++;
    o.traverse?.(x=>{
      x.geometry?.dispose?.();
      const mats=Array.isArray(x.material)?x.material:[x.material];for(const m of mats)m?.dispose?.();
    });
  }
  let groupsRemoved=0,changed=true;
  while(changed){
    changed=false;
    root.traverse?.(o=>{if(o!==root&&o.isGroup&&o.children.length===0&&o.parent){o.parent.remove(o);groupsRemoved++;changed=true;}});
  }
  W.legacyWorldCleanup={removed,groupsRemoved};
  return W.legacyWorldCleanup;
}
