import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('Suzuka scenery is grounded and perimeter trees clear every track branch',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,T=W.THREE,root=W.suzukaFullScene?.root,trees=W.scene.getObjectByName('SUZUKA_PERIMETER_TREE_TRUNKS');
    const groups=(root?.children||[]).filter(o=>o.isGroup&&!String(o.name||'').includes('BRIDGE'));
    const maxGroundError=groups.reduce((m,o)=>Math.max(m,Math.abs((o.position?.y??-.18)+.18)),0);
    let minClear=Infinity;
    if(trees&&T){
      const mat=new T.Matrix4(),p=new T.Vector3(),track=[];
      for(let k=0;k<960;k++){const q=W.sample(W.total*k/960).p;track.push([q.x,q.z]);}
      for(let i=0;i<trees.count;i++){
        trees.getMatrixAt(i,mat);p.setFromMatrixPosition(mat);
        for(const q of track){const d=Math.hypot(p.x-q[0],p.z-q[1]);if(d<minClear)minClear=d;}
      }
    }
    let legacyAnonymousStand=0,legacyAnonymousGantry=0;
    for(const o of W.scene.children){
      if(!o?.isGroup||o.name)continue;let tiers=0,posts=0,beam=0;
      o.traverse(x=>{if(!x?.isMesh||x.geometry?.type!=='BoxGeometry')return;const p=x.geometry.parameters||{};
        if(Math.abs((p.width||0)-38)<.08&&Math.abs((p.height||0)-1.2)<.08&&Math.abs((p.depth||0)-5)<.08)tiers++;
        if(Math.abs((p.width||0)-.5)<.04&&Math.abs((p.height||0)-7)<.08&&Math.abs((p.depth||0)-.5)<.04)posts++;
        if(Math.abs((p.width||0)-19)<.08&&Math.abs((p.height||0)-.65)<.05&&Math.abs((p.depth||0)-.7)<.05)beam++;
      });
      if(tiers>=5)legacyAnonymousStand++;if(posts>=2&&beam>=1)legacyAnonymousGantry++;
    }
    return{h:W.sceneHygiene,count:trees?.count||0,minClear,maxGroundError,legacyAnonymousStand,legacyAnonymousGantry,audit:W.circuitAudit?.sceneHygiene};
  });
  expect(r.h?.owner,JSON.stringify(r)).toBe('runtime-scene-hygiene-v1');
  expect(r.count,JSON.stringify(r)).toBeGreaterThanOrEqual(160);
  expect(r.minClear,JSON.stringify(r)).toBeGreaterThanOrEqual(41.5);
  expect(r.maxGroundError,JSON.stringify(r)).toBeLessThan(.03);
  expect(r.legacyAnonymousStand,JSON.stringify(r)).toBe(0);
  expect(r.legacyAnonymousGantry,JSON.stringify(r)).toBe(0);
  expect(r.audit?.wholeCircuitTreeClearance).toBeTruthy();
});

test('moving cars use a frame-synchronous contact shadow instead of the throttled shadow map',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,car=W.makeCar(0x3485ff,'gt'),contact=car.userData?.contactShadow;
    let casting=0,totalMeshes=0;
    car.traverse(o=>{if(!o?.isMesh)return;totalMeshes++;if(o!==contact&&o.castShadow)casting++;});
    return{policy:car.userData?.vehicleShadowPolicy,global:W.vehicleShadowPolicy,contact:!!contact,contactOpacity:contact?.material?.opacity??0,casting,totalMeshes};
  });
  expect(r.policy,JSON.stringify(r)).toBe('contact-shadow-live-v1');
  expect(r.global?.owner).toBe('runtime-contact-shadow-live-v1');
  expect(r.global?.dynamicVehicleShadowMap).toBe(false);
  expect(r.contact).toBeTruthy();
  expect(r.contactOpacity).toBeGreaterThanOrEqual(.27);
  expect(r.casting,JSON.stringify(r)).toBe(0);
  expect(r.totalMeshes).toBeGreaterThan(5);
});
