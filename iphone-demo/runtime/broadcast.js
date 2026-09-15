export function createBroadcast(W,R,D){
  const T=W.THREE,cam=new T.PerspectiveCamera(42,16/9,.1,1400),size=new T.Vector2();
  const label=document.createElement('div');label.style.cssText='display:none;position:fixed;z-index:68;left:13px;top:max(82px,calc(env(safe-area-inset-top) + 76px));padding:4px 7px;border-radius:5px;background:#06101be8;border:1px solid #ffffff44;color:#fff;font:900 9px -apple-system,sans-serif;pointer-events:none';document.body.appendChild(label);
  let lastRender=-999,frames=0,skips=0;
  function render(now=performance.now()){
    if(!D.pipActive||D.pipFocus==null){label.style.display='none';return;}
    // A second full-scene render is expensive. Desktop PiP is capped near 15 fps
    // and uses a smaller viewport; mobile already disables PiP in the director.
    if(now-lastRender<66){skips++;return;}lastRender=now;
    const c=R.cars[D.pipFocus];if(!c||c.retired){label.style.display='none';return;}
    const q=W.sample(c.s,c.lane),ahead=W.sample(c.s+38,c.lane);cam.position.copy(q.p).addScaledVector(q.t,-18).addScaledVector(q.side,10).add(new T.Vector3(0,8,0));cam.lookAt(ahead.p.clone().add(new T.Vector3(0,1.2,0)));
    const renderer=W.renderer;renderer.getSize(size);const w=Math.floor(Math.min(size.x*.30,380)),h=Math.floor(w*.5625),x=12,y=Math.max(12,Math.floor(size.y-h-88));cam.aspect=w/h;cam.updateProjectionMatrix();
    renderer.autoClear=false;renderer.setScissorTest(true);renderer.setViewport(x,y,w,h);renderer.setScissor(x,y,w,h);renderer.clearDepth();renderer.render(W.scene,cam);renderer.setScissorTest(false);renderer.setViewport(0,0,size.x,size.y);renderer.autoClear=true;
    const b=(D.battles||[]).find(x=>x.chaser===c.id),lead=b?R.cars[b.lead]:null;label.textContent=`BATTLE · ${lead?.name||'CAR'} vs ${c.name}${b?` · ${b.gap.toFixed(1)}s`:''}`;label.style.display='block';frames++;
  }
  return{render,get diagnostics(){return{owner:'runtime-low-cost-pip-v1',targetFps:15,maxWidth:380,frames,skips}}};
}
