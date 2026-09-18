import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_WORLD__&&window.__RACING_RACE__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_WORLD__&&window.__RACING_RACE__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('rebuilt main road is continuous, near the physical datum, and has no floating translucent racing-line sheet',async({page},testInfo)=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.min.js'),W=window.__RACING_WORLD__,R=W?.rebuiltRoadSurface;
    if(!R?.road)return{supported:false};
    const attr=R.road.geometry?.getAttribute?.('position'),count=Number(R.segments)||0,widths=[];
    if(attr&&count>0){
      for(const f of[0,.11,.23,.37,.52,.68,.83,.95]){
        const i=Math.min(count-1,Math.floor(count*f))*2;
        const dx=attr.getX(i+1)-attr.getX(i),dy=attr.getY(i+1)-attr.getY(i),dz=attr.getZ(i+1)-attr.getZ(i);
        widths.push(Math.hypot(dx,dy,dz));
      }
    }
    const floating=[];
    W.scene.traverse(o=>{
      if(!o?.visible||!o?.isMesh||!o.material||Array.isArray(o.material))return;
      const p=o.geometry?.getAttribute?.('position'),m=o.material;
      if(o.renderOrder===3&&m.transparent===true&&m.depthWrite===false&&p?.count===840)floating.push({name:o.name||'',opacity:m.opacity});
    });
    const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);let hits=0;
    for(const f of[.03,.17,.31,.46,.61,.76,.89]){
      const q=W.sample(W.total*f,0);ray.set(q.p.clone().add(new THREE.Vector3(0,12,0)),down);if(ray.intersectObject(R.road,false).length)hits++;
    }
    const s=W.total*.31,q=W.sample(s),ahead=W.sample(s+80),cam=q.p.clone().addScaledVector(q.side,-13).add(new THREE.Vector3(0,2.7,0));
    W.camera.position.copy(cam);W.camera.up.set(0,1,0);W.camera.lookAt(ahead.p.clone().add(new THREE.Vector3(0,.5,0)));W.camera.updateProjectionMatrix();W.renderer.render(W.scene,W.camera);
    return{supported:true,owner:R.owner,width:R.width,segments:R.segments,visible:R.root.visible&&R.road.visible,widths,hits,roadName:R.road.name,lineCount:[R.leftLine,R.rightLine].filter(Boolean).length,lift:R.lift,lineLift:R.lineLift,floatingLegacyRacingLinesRemoved:R.floatingLegacyRacingLinesRemoved,floating};
  });
  const shot=await page.screenshot({type:'png'});await testInfo.attach('rebuilt-road-low-angle',{body:shot,contentType:'image/png'});
  expect(result.supported,JSON.stringify(result)).toBeTruthy();
  expect(result.owner).toBe('runtime-road-surface-rebuild-v2');
  expect(result.visible).toBeTruthy();
  expect(result.segments).toBeGreaterThanOrEqual(1200);
  expect(result.lineCount).toBe(2);
  expect(result.hits,JSON.stringify(result)).toBe(7);
  expect(Math.min(...result.widths),JSON.stringify(result)).toBeGreaterThan(12);
  expect(Math.max(...result.widths),JSON.stringify(result)).toBeLessThan(17);
  expect(result.lift,JSON.stringify(result)).toBeLessThanOrEqual(.01);
  expect(result.lineLift,JSON.stringify(result)).toBeLessThanOrEqual(.012);
  expect(result.floatingLegacyRacingLinesRemoved,JSON.stringify(result)).toBeGreaterThanOrEqual(1);
  expect(result.floating,JSON.stringify(result)).toEqual([]);
});