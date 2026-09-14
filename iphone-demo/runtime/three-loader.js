export async function loadThree({timeoutMs=16000}={}){
  const localUrl=new URL('../../node_modules/three/build/three.module.min.js',import.meta.url).href;
  const sources=[
    {url:localUrl,kind:'local-npm'},
    {url:'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js',kind:'jsdelivr'},
    {url:'https://unpkg.com/three@0.185.1/build/three.module.min.js',kind:'unpkg'}
  ];
  const errors=[];
  for(const source of sources){
    let timerId=null;
    try{
      const timer=new Promise((_,reject)=>{timerId=setTimeout(()=>reject(new Error(`Three.js timeout: ${source.url}`)),source.kind==='local-npm'?3500:timeoutMs);});
      const mod=await Promise.race([import(source.url),timer]);
      if(timerId)clearTimeout(timerId);
      try{window.__RACING_THREE_SOURCE__={kind:source.kind,url:source.url,version:'0.185.1'};}catch{}
      return mod;
    }catch(e){if(timerId)clearTimeout(timerId);errors.push(`${source.kind}: ${String(e?.message||e)}`);}
  }
  throw new Error(`Three.jsの読み込みに失敗しました: ${errors.join(' | ')}`);
}
