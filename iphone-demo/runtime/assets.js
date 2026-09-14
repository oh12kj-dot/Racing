export function createRenderAssetManager(W,{mobile=false}={}){
  const T=W.THREE,manifestUrl=new URL('../../assets/render/manifest.json',import.meta.url),cache=new Map(),failures=[];let manifest=null,loaderPromise=null,loaderSource='none';
  const timeoutMs=mobile?5500:7500;
  function timed(promise,ms,label){
    let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms);})]).finally(()=>clearTimeout(timer));
  }
  async function loadManifest(){
    if(manifest)return manifest;
    const r=await timed(fetch(manifestUrl,{cache:'no-cache'}),4000,'render asset manifest');if(!r.ok)throw new Error(`render asset manifest ${r.status}`);manifest=await r.json();return manifest;
  }
  async function loader(){
    if(loaderPromise)return loaderPromise;
    loaderPromise=(async()=>{
      // Prefer the pinned local npm package. CDN add-ons remain fallback only.
      const sources=[
        {url:new URL('../../node_modules/three/examples/jsm/loaders/GLTFLoader.js',import.meta.url).href,kind:'local-npm'},
        {url:'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/GLTFLoader.js/+esm',kind:'jsdelivr'},
        {url:'https://unpkg.com/three@0.185.1/examples/jsm/loaders/GLTFLoader.js?module',kind:'unpkg'}
      ];
      let err;for(const source of sources){try{const m=await timed(import(source.url),source.kind==='local-npm'?3500:4500,'GLTFLoader import');loaderSource=source.kind;return new m.GLTFLoader();}catch(e){err=e;}}
      throw err||new Error('GLTFLoader unavailable');
    })();return loaderPromise;
  }
  async function loadModel(url){
    if(cache.has(url))return cache.get(url);
    const promise=(async()=>{
      const L=await loader(),href=new URL(url,manifestUrl).href;
      return timed(new Promise((resolve,reject)=>L.load(href,g=>resolve(g),undefined,reject)),timeoutMs,`GLB ${href}`);
    })();
    // Keep failures cached for this session so one unavailable source cannot cause
    // repeated multi-second retries for every car or pit-box clone.
    cache.set(url,promise);return promise;
  }
  function fallbackPaintColor(car){
    const visual=car.mesh?.userData?.visual;let best=null,bestScore=-1;
    visual?.traverse?.(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(!m?.color||m.transparent)continue;const hsl={h:0,s:0,l:0};m.color.getHSL(hsl);const score=hsl.s*1.4+(Number(m.clearcoat)||0)*.8-Math.abs(hsl.l-.48)*.4;if(score>bestScore){bestScore=score;best=m.color.clone();}}});
    return best;
  }
  function prepareScene(scene,tint=null,tintStrength=.32){
    scene.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;
      const source=Array.isArray(o.material)?o.material:[o.material],mats=source.map(m=>m?.clone?.()||m);o.material=Array.isArray(o.material)?mats:mats[0];
      for(const m of mats){if(!m)continue;if('envMapIntensity'in m)m.envMapIntensity=Math.max(.85,m.envMapIntensity||0);if(tint&&m.color&&!m.transparent&&(m.roughness??.5)<.78){const hsl={h:0,s:0,l:0};m.color.getHSL(hsl);if(hsl.l>.10&&hsl.l<.92)m.color.lerp(tint,Math.max(0,Math.min(.62,tintStrength)));}m.needsUpdate=true;}
    });
  }
  function fitScene(scene,car,entry){
    const base=Number(entry.scale)||1,rot=entry.rotation||[0,0,0],off=entry.offset||[0,0,0];scene.rotation.set(Number(rot[0])||0,Number(rot[1])||0,Number(rot[2])||0);scene.updateMatrixWorld(true);
    if(entry.fitToCar){
      const box=new T.Box3().setFromObject(scene),size=new T.Vector3();box.getSize(size);const d=car.mesh?.userData?.dims||{},sx=(Number(d.width)||size.x)/Math.max(.001,size.x),sz=(Number(d.length)||size.z)/Math.max(.001,size.z),sy=Math.sqrt(Math.max(.001,sx*sz));scene.scale.set(sx*base,sy*base,sz*base);
    }else scene.scale.setScalar(base);
    scene.position.set(Number(off[0])||0,Number(off[1])||0,Number(off[2])||0);
  }
  async function upgradeCar(car,entry){
    try{
      const gltf=await loadModel(entry.url),scene=gltf.scene.clone(true),tint=fallbackPaintColor(car);prepareScene(scene,tint,Number(entry.teamTint??.32));fitScene(scene,car,entry);
      const visual=car.mesh?.userData?.visual;if(visual)visual.visible=false;
      scene.name=`GLB_${car.type||'CAR'}`;car.mesh.add(scene);car.mesh.userData.renderAsset=scene;car.mesh.userData.renderAssetSource=entry.source||entry.url;return true;
    }catch(e){failures.push({type:car.type,url:entry.url,error:String(e?.message||e)});return false;}
  }
  async function cloneStatic(entry){const gltf=await loadModel(entry.url),scene=gltf.scene.clone(true);prepareScene(scene);scene.scale.setScalar(Number(entry.scale)||1);return scene;}
  async function placePitBoxAssets(entry,key,root){
    const out=[];for(let team=0;team<10;team++){
      try{const scene=await cloneStatic(entry),s=W.pitBoxS?.(team),q=W.pitPose?.(s,team,'STOP');if(!q)continue;const side=Number(entry.sideOffset??3.4),along=Number(entry.alongOffset??-2.35);scene.position.copy(q.p).addScaledVector(q.side,side).addScaledVector(q.t,along);scene.position.y+=Number(entry.yOffset)||.06;scene.rotation.y=q.rotationY+(Number(entry.yaw)||0);scene.name=`GLB_${key}_${team}`;root.add(scene);out.push(scene);}catch(e){failures.push({type:key,url:entry.url,error:String(e?.message||e)});}
    }return out;
  }
  async function placeTrackAssets(entry,key,root){
    const out=[],fractions=Array.isArray(entry.fractions)?entry.fractions:[],sides=Array.isArray(entry.sides)?entry.sides:[];
    for(let i=0;i<fractions.length;i++){
      try{const scene=await cloneStatic(entry),side=Number(sides[i]??(i%2?1:-1))||1,q=W.sample(W.total*Number(fractions[i]),side*Math.abs(Number(entry.lateral)||30));scene.position.copy(q.p);scene.position.y+=Number(entry.yOffset)||.04;scene.rotation.y=Math.atan2(q.t.x,q.t.z)+(side<0?Math.PI:0)+(Number(entry.yaw)||0);scene.name=`GLB_${key}_${i}`;root.add(scene);out.push(scene);}catch(e){failures.push({type:key,url:entry.url,error:String(e?.message||e)});}
    }return out;
  }
  async function upgradeTrackside(entries={}){
    const root=new T.Group();root.name='RUNTIME_GLB_TRACKSIDE';W.scene.add(root);let loaded=0,requested=0;
    for(const [key,entry] of Object.entries(entries)){if(!entry?.url)continue;if(entry.mode==='pitBoxes'){requested+=10;loaded+=(await placePitBoxAssets(entry,key,root)).length;}else if(entry.mode==='trackFractions'){requested+=(entry.fractions||[]).length;loaded+=(await placeTrackAssets(entry,key,root)).length;}}
    return{root,requested,loaded};
  }
  async function upgradeCars(cars=[]){
    W.renderAssets={state:'loading',manifestVersion:0,requested:0,loaded:0,vehicleRequested:0,vehicleLoaded:0,tracksideRequested:0,tracksideLoaded:0,failed:0,mobile,sources:[],loaderSource};
    try{
      const m=await loadManifest(),entries=m?.vehicles||{},jobs=[];
      for(const c of cars){const entry=entries[c.type];if(entry?.url)jobs.push(upgradeCar(c,entry));}
      W.renderAssets.manifestVersion=m?.version||0;W.renderAssets.vehicleRequested=jobs.length;
      const [result,trackside]=await Promise.all([Promise.all(jobs),upgradeTrackside(m?.trackside||{})]);
      const loaded=result.filter(Boolean).length+trackside.loaded,requested=jobs.length+trackside.requested;
      W.renderAssets={state:loaded>0?'ready':'fallback',manifestVersion:m?.version||0,requested,loaded,vehicleRequested:jobs.length,vehicleLoaded:result.filter(Boolean).length,tracksideRequested:trackside.requested,tracksideLoaded:trackside.loaded,failed:failures.length,mobile,sources:[...new Set([...Object.values(entries),...Object.values(m?.trackside||{})].map(x=>x?.source).filter(Boolean))],loaderSource};return W.renderAssets;
    }catch(e){failures.push({type:'asset-manager',url:String(manifestUrl),error:String(e?.message||e)});W.renderAssets={...W.renderAssets,state:'fallback',failed:failures.length,error:String(e?.message||e),loaderSource};return W.renderAssets;}
  }
  return{loadManifest,upgradeCars,get manifest(){return manifest},get failures(){return failures.slice()},get cacheSize(){return cache.size},get loaderSource(){return loaderSource}};
}
