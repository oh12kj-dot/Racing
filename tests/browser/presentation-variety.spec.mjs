import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('all vehicle classes receive multi-tone liveries and decal graphics',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,types=['formula','proto','hyper','lmh','gt','supercar','touring'];
    return types.map(type=>{
      const car=W.makeCar(0x376fa8,type),l=car.userData?.livery||null,g=car.getObjectByName?.('RACING_LIVERY_V1');
      const names=[],decalParts=[],sweepParts=[];
      g?.traverse?.(o=>{
        if(o?.name)names.push(o.name);
        const p=o?.geometry?.parameters||{};
        if(o?.name==='LIVERY_DECAL')decalParts.push({x:Math.abs(o.position.x),y:o.position.y,width:p.width||0,height:p.height||0});
        if(o?.name==='LIVERY_SWEEP')sweepParts.push({x:Math.abs(o.position.x),y:o.position.y,width:p.width||0,height:p.height||0});
      });
      return{type,livery:!!l,version:l?.version??0,primary:l?.primary,secondary:l?.secondary,tertiary:l?.tertiary,sponsor:l?.sponsor,number:l?.number,parts:l?.parts??0,children:g?.children?.length??0,decals:names.filter(x=>x==='LIVERY_DECAL').length,sweeps:names.filter(x=>x==='LIVERY_SWEEP').length,parentIsRoot:g?.parent===car,fit:l?.sideFit||null,decalParts,sweepParts};
    });
  });
  for(const car of result){
    expect(car.livery,JSON.stringify(car)).toBeTruthy();expect(car.version,JSON.stringify(car)).toBe(2);expect(car.parts,JSON.stringify(car)).toBeGreaterThanOrEqual(8);expect(car.children,JSON.stringify(car)).toBeGreaterThanOrEqual(8);
    expect(car.parentIsRoot,JSON.stringify(car)).toBeTruthy();expect(car.secondary,JSON.stringify(car)).not.toBe(car.primary);expect(car.sponsor,JSON.stringify(car)).toBeTruthy();expect(car.number,JSON.stringify(car)).toBeGreaterThan(0);expect(car.decals,JSON.stringify(car)).toBe(2);expect(car.sweeps,JSON.stringify(car)).toBe(2);
  }
  expect(new Set(result.map(x=>x.secondary)).size).toBeGreaterThanOrEqual(3);

  const gt=result.find(x=>x.type==='gt'),touring=result.find(x=>x.type==='touring');
  expect(gt?.fit?.sideX,JSON.stringify(gt)).toBeLessThanOrEqual(1.18);expect(gt?.fit?.decalH,JSON.stringify(gt)).toBeLessThanOrEqual(.34);expect(gt?.fit?.tilt,JSON.stringify(gt)).toBeLessThan(-.20);
  expect(Math.max(...gt.decalParts.map(x=>x.x)),JSON.stringify(gt)).toBeLessThanOrEqual(1.19);expect(Math.max(...gt.decalParts.map(x=>x.width)),JSON.stringify(gt)).toBeLessThanOrEqual(1.27);expect(Math.max(...gt.decalParts.map(x=>x.height)),JSON.stringify(gt)).toBeLessThanOrEqual(.35);
  expect(touring?.fit?.sideX,JSON.stringify(touring)).toBeLessThanOrEqual(1.10);expect(touring?.fit?.decalH,JSON.stringify(touring)).toBeLessThanOrEqual(.30);expect(touring?.fit?.tilt,JSON.stringify(touring)).toBeLessThan(-.20);
  expect(Math.max(...touring.decalParts.map(x=>x.x)),JSON.stringify(touring)).toBeLessThanOrEqual(1.11);expect(Math.max(...touring.decalParts.map(x=>x.width)),JSON.stringify(touring)).toBeLessThanOrEqual(1.15);expect(Math.max(...touring.decalParts.map(x=>x.height)),JSON.stringify(touring)).toBeLessThanOrEqual(.31);
});

test('livery survives procedural visual detachment used by GLB replacement',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,AM=window.__RACING_ASSETS__,car=W.makeCar(0x3f78c5,'gt'),before=car.getObjectByName?.('RACING_LIVERY_V1');
    if(!before||typeof AM?.detachLegacyCarLayers!=='function')return{supported:false};
    const visual=car.userData?.visual;AM.detachLegacyCarLayers({mesh:car,type:'gt'});
    const after=car.getObjectByName?.('RACING_LIVERY_V1');
    return{supported:true,beforeParentRoot:before.parent===car,afterAttached:!!after,afterParentRoot:after?.parent===car,visualDetached:visual?.parent!==car,decals:after?.children?.filter(x=>x.name==='LIVERY_DECAL').length??0};
  });
  expect(result.supported,JSON.stringify(result)).toBeTruthy();expect(result.beforeParentRoot,JSON.stringify(result)).toBeTruthy();expect(result.visualDetached,JSON.stringify(result)).toBeTruthy();expect(result.afterAttached,JSON.stringify(result)).toBeTruthy();expect(result.afterParentRoot,JSON.stringify(result)).toBeTruthy();expect(result.decals,JSON.stringify(result)).toBe(2);
});

test('radio repeats are rewritten into varied context-aware dialogue without losing critical values',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,c=R.cars.find(x=>!x.retired)||R.cars[0],tag=`var-${Date.now()}`;
    for(let i=0;i<5;i++)R.radio.push({id:`${tag}-s${i}`,t:R.race.t,carId:c.id,name:'ENGINEER',text:'Box this lap. tyre life.',kind:'STRATEGY'});
    for(let i=0;i<5;i++)R.radio.push({id:`${tag}-d${i}`,t:R.race.t,carId:c.id,name:c.name,text:'Copy. Understood.',kind:'DRIVER'});
    R.radio.push({id:`${tag}-p`,t:R.race.t,carId:c.id,name:'ENGINEER',text:'5 second penalty. unsafe release.',kind:'PENALTY'});
    R.update(.016);
    const idOf=x=>String(x?.id??'');
    const strategy=R.radio.filter(x=>idOf(x).startsWith(`${tag}-s`)).map(x=>x.text),driver=R.radio.filter(x=>idOf(x).startsWith(`${tag}-d`)).map(x=>x.text),penalty=R.radio.find(x=>idOf(x)===`${tag}-p`)?.text||'',diag=R.radioVarietyDiagnostics;
    return{strategy,driver,penalty,diag};
  });
  expect(result.strategy).toHaveLength(5);expect(new Set(result.strategy).size).toBeGreaterThanOrEqual(4);expect(result.strategy.every(x=>x!=='Box this lap. tyre life.')).toBeTruthy();
  expect(result.driver).toHaveLength(5);expect(new Set(result.driver).size).toBeGreaterThanOrEqual(5);expect(result.penalty).toContain('5');
  expect(result.diag?.owner).toBe('runtime-radio-variety-v1');expect(result.diag?.metrics?.rewritten).toBeGreaterThanOrEqual(11);
});
