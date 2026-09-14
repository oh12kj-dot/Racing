export function createRenderAssetManager(W,{mobile=false}={}){
  const T=W.THREE,manifestUrl=new URL('../../assets/render/manifest.json',import.meta.url),cache=new Map(),failures=[];let manifest=null,loaderPromise=null;
  async function loadManifest(){
    if(manifest)return manifest;
    const r=await fetch(manifestUrl,{cache:'no-cache'});if(!r.ok)throw new Error(`render asset manifest ${r.status}`);manifest=await r.json();return manifest;
  }
  async function loader(){
    if(loaderPromise)return loaderPromise;
    loaderPromise=(async()=>{
      const urls=['https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/GLTFLoader.js','https://unpkg.com/three@0.185.1/examples/jsm/loaders/GLTFLoader.js'];
      let err;for(const u of urls){try{const m=await import(u);return new m.GLTFLoader();}catch(e){err=e;}}
      throw err||new Error('GLTFLoader unavailable');
    })();return loaderPromise;
  }
  async function loadModel(url){
    if(cache.has(url))return cache.get(url);
    const L=await loader(),promise=new Promise((resolve,reject)=>L.load(new URL(url,manifestUrl).href,g=>resolve(g),undefined,reject));cache.set(url,promise);return promise;
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
  async function upgradeCars(cars=[]){
    const m=await loadManifest(),entries=m?.vehicles||{},jobs=[];
    for(const c of cars){const entry=entries[c.type];if(entry?.url)jobs.push(upgradeCar(c,entry));}
    const result=await Promise.all(jobs);W.renderAssets={manifestVersion:m?.version||0,requested:jobs.length,loaded:result.filter(Boolean).length,failed:failures.length,mobile,sources:[...new Set(Object.values(entries).map(x=>x?.source).filter(Boolean))]};return W.renderAssets;
  }
  return{loadManifest,upgradeCars,get manifest(){return manifest},get failures(){return failures.slice()},get cacheSize(){return cache.size}};
}
