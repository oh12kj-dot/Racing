import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

async function walkFiles(dir){
  const entries=await readdir(dir,{withFileTypes:true}),files=[];
  for(const entry of entries){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())files.push(...await walkFiles(full));
    else files.push(full);
  }
  return files;
}

test('retired runtime compatibility shims have no source imports',async()=>{
  const root=process.cwd();
  const retired=[['6','race'],['10','race'],['11','race'],['12','race'],['15','race'],['18','race'],['24','race'],['27','race'],['28','race'],['29','race'],['30','race'],['5','world']]
    .map(([version,kind])=>path.resolve(root,'iphone-demo','runtime',`v${version}-${kind}.js`));
  const retiredSet=new Set(retired),references=[];
  const sourceRoots=['iphone-demo','tests','view-engineering'].map(dir=>path.resolve(root,dir));
  const files=(await Promise.all(sourceRoots.map(walkFiles))).flat().filter(file=>/\.(?:js|mjs|html)$/i.test(file));
  const patterns=[/\bfrom\s*['"]([^'"]+)['"]/g,/\bimport\s*['"]([^'"]+)['"]/g,/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,/\bsrc\s*=\s*['"]([^'"]+)['"]/g];
  for(const file of files){
    const source=await readFile(file,'utf8');
    for(const pattern of patterns){
      pattern.lastIndex=0;
      for(let match;(match=pattern.exec(source));){
        const spec=match[1];
        if(!spec)continue;
        const resolved=spec.startsWith('/iphone-demo/')?path.resolve(root,spec.slice(1)):spec.startsWith('.')?path.resolve(path.dirname(file),spec):null;
        if(resolved&&retiredSet.has(resolved))references.push(`${path.relative(root,file)} -> ${spec}`);
      }
    }
  }
  expect(references,'retired runtime shim imports must be removed before deleting the shim files').toEqual([]);
});

test('race and world implementations stay owned by stable runtime modules',async({page})=>{
  await boot(page);
  await page.waitForTimeout(100);
  const result=await page.evaluate(()=>{
    const paths=performance.getEntriesByType('resource').map(e=>{try{return new URL(e.name).pathname;}catch{return String(e.name);}});
    const historical=paths.filter(p=>/^\/iphone-demo\/v\d+-(?:race|world)(?:-final)?\.js$/.test(p));
    // These two application-facing files are intentionally retained as one-line
    // compatibility entry shims. They contain no race/world implementation.
    const allowed=new Set(['/iphone-demo/v41-race.js','/iphone-demo/v42-world.js']);
    return{historical,unexpected:historical.filter(p=>!allowed.has(p))};
  });
  expect(result.unexpected,`unexpected historical implementation resources: ${result.unexpected.join(', ')}`).toEqual([]);
});

test('compatibility entry points re-export canonical runtime symbols',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const same=await page.evaluate(async()=>{
    const [legacySettings,settings,legacyCircuits,circuits,legacyUI,uiCore,legacyConfig,config]=await Promise.all([
      import('/iphone-demo/v10-settings.js'),
      import('/iphone-demo/runtime/settings.js'),
      import('/iphone-demo/v10-circuits.js'),
      import('/iphone-demo/runtime/circuits.js'),
      import('/iphone-demo/v16-ui.js'),
      import('/iphone-demo/runtime/ui-core.js'),
      import('/iphone-demo/v42-config.js'),
      import('/iphone-demo/runtime/config.js')
    ]);
    return{
      settings:legacySettings.DEFAULT_SETTINGS===settings.DEFAULT_SETTINGS&&legacySettings.loadSettings===settings.loadSettings&&legacySettings.saveSettings===settings.saveSettings&&legacySettings.resolveCircuit===settings.resolveCircuit,
      circuits:legacyCircuits.CIRCUITS===circuits.CIRCUITS&&legacyCircuits.getCircuitTrack===circuits.getCircuitTrack,
      ui:legacyUI.createUI===uiCore.createUI,
      logPolicy:legacyConfig.LOG_POLICY===config.LOG_POLICY
    };
  });
  expect(same).toEqual({settings:true,circuits:true,ui:true,logPolicy:true});
});
