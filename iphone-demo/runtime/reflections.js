export function createEnvironmentReflections(W,{mobile=false}={}){
  const T=W.THREE,renderer=W.renderer,size=mobile?96:160;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const profiles={
    DAY:{top:0x4b93d4,horizon:0xc8ddec,ground:0x4a5148,sun:'#fff0cc',cloud:.10,intensity:.98},
    CLOUD:{top:0x63798d,horizon:0xaebbc3,ground:0x414744,sun:'#e8edf0',cloud:.64,intensity:.88},
    SUNSET:{top:0x43506d,horizon:0xff9165,ground:0x34312d,sun:'#ffd098',cloud:.26,intensity:1.00},
    NIGHT:{top:0x081227,horizon:0x1d2940,ground:0x11161a,sun:'#91a8d4',cloud:.20,intensity:.62},
    WET:{top:0x485662,horizon:0x737e84,ground:0x24282a,sun:'#ccd4d8',cloud:.86,intensity:1.08}
  };
  const targets=new Map();
  let key='DAY',disposed=false,building=false;

  function makeEquirect(p){
    const c=document.createElement('canvas');c.width=size;c.height=size>>1;const g=c.getContext('2d'),w=c.width,h=c.height;
    const top=new T.Color(p.top),hz=new T.Color(p.horizon),ground=new T.Color(p.ground),css=x=>`#${x.getHexString()}`;
    const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,css(top));gr.addColorStop(.47,css(hz));gr.addColorStop(.58,css(hz.clone().multiplyScalar(.72)));gr.addColorStop(1,css(ground));g.fillStyle=gr;g.fillRect(0,0,w,h);
    const sunX=w*.70,sunY=h*.32,r=Math.max(4,w*.025),glow=g.createRadialGradient(sunX,sunY,0,sunX,sunY,r*5);glow.addColorStop(0,p.sun);glow.addColorStop(.20,p.sun+'aa');glow.addColorStop(1,'rgba(255,210,150,0)');g.globalAlpha=.82*(1-p.cloud*.72);g.fillStyle=glow;g.fillRect(sunX-r*5,sunY-r*5,r*10,r*10);g.globalAlpha=1;
    if(p.cloud>.08){g.fillStyle='#e5eaed';g.globalAlpha=.05+.18*p.cloud;for(let i=0;i<16;i++){const x=(i*79)%w,y=h*(.17+((i*31)%24)/100),rw=14+((i*47)%40),rh=3+((i*19)%9);g.beginPath();g.ellipse(x,y,rw,rh,0,0,Math.PI*2);g.fill();}g.globalAlpha=1;}
    const tex=new T.CanvasTexture(c);tex.mapping=T.EquirectangularReflectionMapping;tex.colorSpace=T.SRGBColorSpace;tex.needsUpdate=true;return tex;
  }

  function ensure(name){
    if(disposed)return null;
    const existing=targets.get(name);if(existing)return existing;
    const p=profiles[name];if(!p)return null;
    const src=makeEquirect(p),pmrem=new T.PMREMGenerator(renderer);let rt=null;
    try{rt=pmrem.fromEquirectangular(src);}finally{pmrem.dispose?.();src.dispose?.();}
    const rec={texture:rt.texture,target:rt,intensity:p.intensity};targets.set(name,rec);return rec;
  }
  function choose(){
    const s=W.env?.skyState||{},day=clamp(Number(s.day??1),0,1),tw=clamp(Number(s.twilight??0),0,1),rain=clamp(Number(W.env?.rain)||0,0,1),cloud=clamp(Number(W.env?.cloud)||0,0,1);
    if(rain>.34)return'WET';if(day<.22)return'NIGHT';if(tw>.28)return'SUNSET';if(cloud>.48)return'CLOUD';return'DAY';
  }
  function applyKey(next){
    const rec=ensure(next);if(!rec)return false;key=next;W.scene.environment=rec.texture;if('environmentIntensity'in W.scene)W.scene.environmentIntensity=rec.intensity;return true;
  }
  function paint(){const next=choose();if(next===key&&targets.has(next))return false;return applyKey(next);}
  function warmNext(){
    if(disposed||building)return;const names=Object.keys(profiles),next=names.find(n=>!targets.has(n));if(!next)return;building=true;
    const run=()=>{try{ensure(next);}catch(e){console.warn('PMREM profile warmup failed',next,e);}finally{building=false;if(!disposed&&targets.size<names.length)setTimeout(warmNext,900);}};
    if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:1400});else setTimeout(run,250);
  }
  function dispose(){disposed=true;for(const x of targets.values())x.target?.dispose?.();targets.clear();}

  // Do not block boot on five PMREM conversions. Create only the currently needed
  // profile after the app is interactive, then warm the remaining profiles one at a time.
  const initial=()=>{try{applyKey(choose());}catch(e){console.warn('Initial PMREM reflection failed; continuing without it.',e);}finally{setTimeout(warmNext,700);}};
  if(typeof requestIdleCallback==='function')requestIdleCallback(initial,{timeout:900});else setTimeout(initial,80);
  W.runtimeReflections={paint,dispose,ensure,get key(){return key},get profiles(){return Object.keys(profiles)},get readyProfiles(){return [...targets.keys()]},pmrem:true};
  return W.runtimeReflections;
}
