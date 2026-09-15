const primitiveTypes=new Set(['BoxGeometry','PlaneGeometry','SphereGeometry','CylinderGeometry','ConeGeometry','TorusGeometry','CircleGeometry','RingGeometry']);

function primitiveGeometryKey(g){
  const p=g?.parameters;if(!g||!p||!primitiveTypes.has(g.type)||g.userData?.runtimeAtlas)return null;
  const entries=Object.keys(p).sort().map(k=>{const v=p[k];return `${k}:${typeof v==='number'?Number(v).toFixed(6):String(v)}`;});
  return `${g.type}|${entries.join('|')}`;
}

function geometryHash(g){
  const primitive=primitiveGeometryKey(g);if(primitive)return primitive;
  const pos=g?.attributes?.position?.array,idx=g?.index?.array;if(!pos)return null;
  let h=2166136261>>>0;const mix=n=>{h^=n>>>0;h=Math.imul(h,16777619)>>>0;};
  for(let i=0;i<pos.length;i++)mix(Math.round(Number(pos[i])*100000));if(idx)for(let i=0;i<idx.length;i++)mix(Number(idx[i]));
  return `${g.type}|p${pos.length}|i${idx?.length||0}|${h.toString(16)}`;
}

function materialKey(m){
  if(!m)return null;const c=m.color?.getHex?.(),e=m.emissive?.getHex?.();
  return [m.type,c,e,m.roughness,m.metalness,m.clearcoat,m.clearcoatRoughness,m.transparent,m.opacity,m.side,m.vertexColors,m.depthWrite,m.depthTest,m.alphaTest,m.blending,m.map?.uuid,m.normalMap?.uuid,m.roughnessMap?.uuid,m.metalnessMap?.uuid,m.emissiveMap?.uuid,m.alphaMap?.uuid].join('|');
}

function dedupeVehicleResources(cars=[]){
  const geometries=new Map(),materials=new Map(),dynamicMaterials=new Set();let geometryReused=0,materialReused=0;
  for(const c of cars){const u=c?.mesh?.userData||{};for(const m of u.brakeMats||[])if(m)dynamicMaterials.add(m.uuid);for(const m of u.v13TyreMats||[])if(m)dynamicMaterials.add(m.uuid);}
  for(const c of cars)c?.mesh?.traverse?.(o=>{
    if(!o?.isMesh)return;const g=o.geometry,key=geometryHash(g);if(key){const canonical=geometries.get(key);if(canonical&&canonical!==g){o.geometry=canonical;g?.dispose?.();geometryReused++;}else geometries.set(key,g);}
    if(Array.isArray(o.material))return;const m=o.material;if(!m||dynamicMaterials.has(m.uuid))return;const mk=materialKey(m);if(!mk)return;const canonical=materials.get(mk);if(canonical&&canonical!==m){o.material=canonical;m.dispose?.();materialReused++;}else materials.set(mk,m);
  });
  return{geometryReused,materialReused,uniqueGeometries:geometries.size,uniqueMaterials:materials.size};
}

function dedupeStaticGeometry(root){
  const cache=new Map();let reused=0;root?.traverse?.(o=>{if(!o?.isMesh||o.isInstancedMesh)return;const g=o.geometry,key=primitiveGeometryKey(g);if(!key)return;const canonical=cache.get(key);if(canonical&&canonical!==g){o.geometry=canonical;g?.dispose?.();reused++;}else cache.set(key,g);});return reused;
}

function batchStaticRoot(W,root){
  const T=W.THREE;if(!root||!T)return{instances:0,meshesBatched:0,geometryReused:0};const geometryReused=dedupeStaticGeometry(root);root.updateMatrixWorld(true);const groups=new Map();
  root.traverse(o=>{
    if(!o?.isMesh||o.isInstancedMesh||o.isSkinnedMesh||o.morphTargetInfluences||Array.isArray(o.material)||!o.geometry||!o.material||o.material.transparent||Number(o.material.opacity)<1)return;
    const key=`${o.geometry.uuid}|${o.material.uuid}|${o.castShadow?1:0}|${o.receiveShadow?1:0}|${o.renderOrder||0}`;let a=groups.get(key);if(!a)groups.set(key,a=[]);a.push(o);
  });
  const rootInv=new T.Matrix4().copy(root.matrixWorld).invert(),tmp=new T.Matrix4();let instances=0,meshesBatched=0;
  for(const list of groups.values()){
    if(list.length<3)continue;const first=list[0],inst=new T.InstancedMesh(first.geometry,first.material,list.length);inst.name=`RUNTIME_STATIC_BATCH_${instances}`;inst.castShadow=first.castShadow;inst.receiveShadow=first.receiveShadow;inst.renderOrder=first.renderOrder;inst.frustumCulled=true;inst.matrixAutoUpdate=false;
    for(let i=0;i<list.length;i++){tmp.copy(rootInv).multiply(list[i].matrixWorld);inst.setMatrixAt(i,tmp);list[i].parent?.remove(list[i]);}inst.instanceMatrix.needsUpdate=true;inst.computeBoundingBox?.();inst.computeBoundingSphere?.();root.add(inst);instances++;meshesBatched+=list.length;
  }
  root.updateMatrixWorld(true);root.traverse(o=>{if(o===root)return;o.updateMatrix?.();o.matrixAutoUpdate=false;});return{instances,meshesBatched,geometryReused};
}

function instanceSpectators(W){
  const T=W.THREE,root=W.scene?.getObjectByName?.('TRACKSIDE_V15'),baseUpdate=W.updateTrackside?.bind(W);if(!T||!root||!baseUpdate)return{people:0,drawMeshes:0};const entries=[];
  for(const cluster of root.children){if(!cluster?.isGroup)continue;for(const p of [...cluster.children]){if(!p?.isGroup||p.children.length!==2)continue;const body=p.children.find(x=>x?.isMesh&&x.geometry?.type==='BoxGeometry'),head=p.children.find(x=>x?.isMesh&&x.geometry?.type==='SphereGeometry');if(!body||!head)continue;entries.push({cluster,p,body,head,color:body.material?.color?.clone?.()});}}
  if(entries.length<24)return{people:0,drawMeshes:0};const bodyGeo=entries[0].body.geometry,headGeo=entries[0].head.geometry,bodyMat=entries[0].body.material.clone(),headMat=entries[0].head.material;bodyMat.color.set(0xffffff);bodyMat.vertexColors=false;
  const bodies=new T.InstancedMesh(bodyGeo,bodyMat,entries.length),heads=new T.InstancedMesh(headGeo,headMat,entries.length);bodies.name='RUNTIME_SPECTATORS_BODY_INSTANCED';heads.name='RUNTIME_SPECTATORS_HEAD_INSTANCED';bodies.instanceMatrix.setUsage(T.DynamicDrawUsage);heads.instanceMatrix.setUsage(T.DynamicDrawUsage);bodies.castShadow=heads.castShadow=true;bodies.receiveShadow=heads.receiveShadow=true;bodies.frustumCulled=heads.frustumCulled=true;
  const m1=new T.Matrix4(),m2=new T.Matrix4();
  function write(){for(let i=0;i<entries.length;i++){const e=entries[i];e.cluster.updateMatrix();e.p.updateMatrix();e.body.updateMatrix();e.head.updateMatrix();m1.copy(e.cluster.matrix).multiply(e.p.matrix);m2.copy(m1).multiply(e.body.matrix);bodies.setMatrixAt(i,m2);m2.copy(m1).multiply(e.head.matrix);heads.setMatrixAt(i,m2);if(e.color)bodies.setColorAt(i,e.color);}bodies.instanceMatrix.needsUpdate=true;heads.instanceMatrix.needsUpdate=true;if(bodies.instanceColor)bodies.instanceColor.needsUpdate=true;}
  write();bodies.computeBoundingSphere?.();heads.computeBoundingSphere?.();root.add(bodies,heads);for(let i=0;i<entries.length;i++){const e=entries[i];e.cluster.remove(e.p);if(i>0){e.body.geometry?.dispose?.();e.head.geometry?.dispose?.();}e.body.material?.dispose?.();e.p.clear();}
  W.updateTrackside=(flag,race,standings=[])=>{baseUpdate(flag,race,standings);write();};return{people:entries.length,drawMeshes:2};
}

function createSpatialGrid(W,R,{cellSize=64}={}){
  const total=Math.max(1,Number(W.total)||1),count=Math.max(16,Math.ceil(total/cellSize)),width=total/count,buckets=Array.from({length:count},()=>[]),neighbours=new Map();let rebuilds=0;const wrap=s=>((Number(s)||0)%total+total)%total;
  for(const c of R.cars||[])neighbours.set(c.id,{ahead:{car:null,dist:Infinity},aheadView:null,behind:{car:null,dist:Infinity}});
  function rebuild(){
    for(const b of buckets)b.length=0;for(const c of R.cars||[]){if(c.retired||c.pitState!=='NONE')continue;buckets[Math.min(count-1,Math.floor(wrap(c.s)/width))].push(c);if(!neighbours.has(c.id))neighbours.set(c.id,{ahead:{car:null,dist:Infinity},aheadView:null,behind:{car:null,dist:Infinity}});}
    for(const c of R.cars||[]){const n=neighbours.get(c.id);if(!n)continue;n.ahead.car=null;n.ahead.dist=Infinity;n.behind.car=null;n.behind.dist=Infinity;if(c.retired||c.pitState!=='NONE'){n.aheadView=null;continue;}const s=wrap(c.s),ci=Math.min(count-1,Math.floor(s/width));
      for(let step=0;step<count;step++){const bucket=buckets[(ci+step)%count];for(const o of bucket){if(o===c)continue;const d=wrap((o.s||0)-s);if(d>0&&d<n.ahead.dist){n.ahead.car=o;n.ahead.dist=d;}}if(n.ahead.car&&n.ahead.dist<(step+2)*width)break;}
      for(let step=0;step<count;step++){const bucket=buckets[(ci-step+count)%count];for(const o of bucket){if(o===c)continue;const d=wrap(s-(o.s||0));if(d>0&&d<n.behind.dist){n.behind.car=o;n.behind.dist=d;}}if(n.behind.car&&n.behind.dist<(step+2)*width)break;}n.aheadView=n.ahead.car?n.ahead:null;
    }rebuilds++;
  }
  try{R.spatialNeighbours=neighbours;}catch{}return{rebuild,neighbours,get diagnostics(){return{owner:'runtime-spatial-grid-v1',cellSize:width,cells:count,rebuilds,entries:neighbours.size};}};
}

function freezeKnownStaticRoots(W){let frozen=0;for(const name of['PHYSICAL_BARRIERS_V42']){const root=W.scene?.getObjectByName?.(name);root?.updateMatrixWorld?.(true);root?.traverse?.(o=>{if(o===root)return;o.updateMatrix?.();if(o.matrixAutoUpdate!==false){o.matrixAutoUpdate=false;frozen++;}});}return frozen;}

export function installRuntimeOptimizations(W,R,{mobile=false}={}){
  if(W.runtimeOptimizationController)return W.runtimeOptimizationController;const staticRoot=W.scene?.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42'),staticBatch=batchStaticRoot(W,staticRoot),spectators=instanceSpectators(W),vehicleResources=dedupeVehicleResources(R.cars||[]),staticFrozen=freezeKnownStaticRoots(W),spatial=createSpatialGrid(W,R,{cellSize:mobile?58:64});
  const trackLookup={owner:'existing-runtime-racing-lut',centrelineSamples:Number(W.racingLineProfile?.count)||0,modes:W.racingLineModes?.length||0},diagnostics={owner:'runtime-quality-preserving-optimizations-v1',renderPath:'direct-webgl-no-composer',staticBatch,spectators,vehicleResources,staticFrozen,trackLookup,spatial:null,qualityLoss:false};
  const controller={beforeRace(){spatial.rebuild();diagnostics.spatial=spatial.diagnostics;},diagnostics(){diagnostics.spatial=spatial.diagnostics;return{...diagnostics,staticBatch:{...staticBatch},spectators:{...spectators},vehicleResources:{...vehicleResources},trackLookup:{...trackLookup},spatial:{...diagnostics.spatial}};}};
  W.runtimeRenderPath='direct-webgl-no-composer';W.runtimeOptimizationController=controller;W.runtimeOptimizationDiagnostics=controller.diagnostics();return controller;
}
