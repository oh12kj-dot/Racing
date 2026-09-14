import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

const manifestPath=process.argv[2];
if(!manifestPath)throw new Error('usage: node tools/vendor_render_assets.mjs <manifest.json>');
const dir=path.dirname(manifestPath),modelsDir=path.join(dir,'models');await mkdir(modelsDir,{recursive:true});
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function download(url,label){
  let last;for(let attempt=1;attempt<=3;attempt++){
    try{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);const body=Buffer.from(await r.arrayBuffer());if(body.length<1024)throw new Error(`asset too small: ${body.length} bytes`);return body;}catch(e){last=e;if(attempt<3)await sleep(attempt*1000);}
  }
  throw new Error(`failed to vendor ${label} from ${url}: ${last?.message||last}`);
}
let count=0,bytes=0;
for(const [groupName,group] of Object.entries({vehicles:manifest.vehicles||{},trackside:manifest.trackside||{}})){
  for(const [key,entry] of Object.entries(group)){
    if(!entry?.url||!/^https:\/\//i.test(entry.url))continue;
    const remoteUrl=entry.url,file=`${groupName}-${key}.glb`,body=await download(remoteUrl,`${groupName}.${key}`);await writeFile(path.join(modelsDir,file),body);
    entry.remoteUrl=remoteUrl;entry.url=`./models/${file}`;entry.packaged=true;count++;bytes+=body.length;
  }
}
manifest.packaging={mode:'local-static',assetCount:count,totalBytes:bytes,generatedAt:new Date().toISOString()};
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(`Vendored ${count} render assets (${bytes} bytes) into ${modelsDir}`);
if(count<5)throw new Error(`expected at least 5 approved render assets, vendored ${count}`);
