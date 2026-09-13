export async function loadThree({timeoutMs=16000}={}){
  const sources=[
    'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js',
    'https://unpkg.com/three@0.185.1/build/three.module.min.js'
  ];
  const errors=[];
  for(const url of sources){
    try{
      const timer=new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Three.js timeout: ${url}`)),timeoutMs));
      return await Promise.race([import(url),timer]);
    }catch(e){errors.push(String(e?.message||e));}
  }
  throw new Error(`Three.jsの読み込みに失敗しました: ${errors.join(' | ')}`);
}
