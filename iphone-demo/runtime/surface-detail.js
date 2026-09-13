export function enhanceSurfaceDetail(W,{mobile=false}={}){
  const T=W.THREE,size=mobile?512:768;
  function makeTexture(kind){
    const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d'),img=g.createImageData(size,size),d=img.data;
    let seed=kind==='rough'?0x9e3779b9:kind==='albedo'?0x27d4eb2d:0x85ebca6b;
    const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=(y*size+x)*4,n=(rnd()+rnd()+rnd())/3,streak=Math.sin((x*.12+y*.018)+Math.sin(y*.027)*2.5)*.5+.5;
      if(kind==='albedo'){
        const aggregate=rnd()>.975?18:0,crack=(Math.sin(x*.031+y*.007+Math.sin(y*.013)*4)>.995)?-24:0,v=Math.max(38,Math.min(112,54+n*40+streak*8+aggregate+crack));
        d[i]=v;d[i+1]=Math.max(0,v-1);d[i+2]=Math.max(0,v-2);
      }else{
        let v=kind==='rough'?150+n*72+streak*14:92+n*86+streak*18;v=Math.max(0,Math.min(255,v));d[i]=d[i+1]=d[i+2]=v;
      }
      d[i+3]=255;
    }
    g.putImageData(img,0,0);const t=new T.CanvasTexture(c);t.colorSpace=kind==='albedo'?T.SRGBColorSpace:T.NoColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(6,150);t.anisotropy=Math.min(W.renderer.capabilities?.getMaxAnisotropy?.()||1,mobile?4:8);return t;
  }
  const albedo=makeTexture('albedo'),bump=makeTexture('bump'),rough=makeTexture('rough');let applied=0;
  W.scene.traverse(o=>{
    if(!o?.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const m of mats){if(!m||(!m.isMeshStandardMaterial&&!m.isMeshPhysicalMaterial))continue;const hex=m.color?.getHex?.()??-1,isRoad=(!!m.bumpMap&&m.roughness>=.72)||(hex===0x303438&&m.roughness>=.78);if(!isRoad)continue;
      m.map=albedo;m.color?.setHex?.(0xffffff);m.bumpMap=bump;m.bumpScale=Math.max(.045,Math.min(.10,m.bumpScale||.065));m.roughnessMap=rough;m.needsUpdate=true;applied++;
    }
  });
  W.surfaceDetail={albedo,bump,rough,applied,resolution:size};return W.surfaceDetail;
}
