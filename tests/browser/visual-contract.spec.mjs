import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('deterministic runtime frame keeps non-blank contrast and color diversity',async({page},testInfo)=>{
  await boot(page);await page.evaluate(()=>window.__RACING_TEST_TICK__(.016,false));
  const stats=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.min.js'),W=window.__RACING_WORLD__,size=W.renderer.getDrawingBufferSize(new THREE.Vector2()),w=Math.max(1,Math.floor(size.x)),h=Math.max(1,Math.floor(size.y));
    const target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true,stencilBuffer:false});target.texture.colorSpace=W.renderer.outputColorSpace;
    const previous=W.renderer.getRenderTarget();W.renderer.setRenderTarget(target);W.renderer.render(W.scene,W.camera);
    const p=new Uint8Array(w*h*4);W.renderer.readRenderTargetPixels(target,0,0,w,h,p);W.renderer.setRenderTarget(previous);target.dispose();
    let n=0,sum=0,sum2=0,opaque=0,dark=0,bright=0;const bins=new Set(),step=Math.max(1,Math.floor(Math.min(w,h)/90));
    for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){const i=(y*w+x)*4,r=p[i],g=p[i+1],b=p[i+2],a=p[i+3],l=.2126*r+.7152*g+.0722*b;n++;sum+=l;sum2+=l*l;if(a>245)opaque++;if(l<42)dark++;if(l>175)bright++;bins.add(`${r>>5}:${g>>5}:${b>>5}`);}
    const mean=sum/Math.max(1,n),std=Math.sqrt(Math.max(0,sum2/Math.max(1,n)-mean*mean));return{w,h,n,mean,std,opaqueRatio:opaque/n,darkRatio:dark/n,brightRatio:bright/n,colorBins:bins.size};
  });
  const shot=await page.screenshot({type:'png'});await testInfo.attach('rendered-frame',{body:shot,contentType:'image/png'});
  expect(stats.w).toBeGreaterThan(400);expect(stats.h).toBeGreaterThan(220);expect(stats.opaqueRatio).toBeGreaterThan(.95);
  expect(stats.mean).toBeGreaterThan(20);expect(stats.mean).toBeLessThan(235);expect(stats.std).toBeGreaterThan(12);expect(stats.colorBins).toBeGreaterThan(18);
  expect(stats.darkRatio,JSON.stringify(stats)).toBeGreaterThan(.001);expect(stats.brightRatio,JSON.stringify(stats)).toBeGreaterThan(.01);
});
