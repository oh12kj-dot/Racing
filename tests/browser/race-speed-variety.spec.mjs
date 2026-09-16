import {test,expect} from '@playwright/test';

test('green-flag race develops realistic speed spread instead of a universal pace cap',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,tick=window.__RACING_TEST_TICK__;
    if(!R||!W||typeof tick!=='function')return{ready:false,status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''};
    const samples=[];
    for(let i=0;i<5000;i++){
      tick(.016,false);
      if(i%250===0){
        const cars=R.cars.filter(c=>!c.retired&&c.pitState==='NONE');
        samples.push({t:R.race.t,flag:R.flag,phase:R.sessionPhase,speeds:cars.map(c=>Number((c.v*3.6).toFixed(1))),raw:cars.map(c=>Number((c.racingSpeedRaw??0)*3.6)),target:cars.map(c=>Number((c.racingSpeedTarget??0)*3.6)),modes:cars.map(c=>c.racingMode||''),lines:cars.map(c=>c.racingLineMode||''),strategies:cars.map(c=>c.strategy?.reason||c.strategyTelemetry?.reason||'')});
      }
    }
    const green=samples.filter(s=>s.flag==='GREEN'&&s.phase==='RACE'&&s.t>(R.race.green||0)+12),latest=green.at(-1)||samples.at(-1)||{speeds:[]},speeds=latest.speeds||[],min=Math.min(...speeds),max=Math.max(...speeds),mean=speeds.reduce((a,b)=>a+b,0)/Math.max(1,speeds.length),variance=speeds.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,speeds.length),curvature=[];
    for(let i=0;i<240;i++){const s=(W.total||1)*i/240;curvature.push(Math.abs(Number(W.racingCurvatureAt?.(s)||0)));}curvature.sort((a,b)=>a-b);
    return{ready:true,latest,greenCount:green.length,min,max,spread:max-min,std:Math.sqrt(variance),curvP50:curvature[Math.floor(curvature.length*.5)],curvP90:curvature[Math.floor(curvature.length*.9)],curvMax:curvature.at(-1),samples};
  });
  expect(result.ready,JSON.stringify(result)).toBeTruthy();expect(result.greenCount,JSON.stringify(result)).toBeGreaterThan(0);expect(result.max,JSON.stringify(result)).toBeGreaterThan(145);expect(result.spread,JSON.stringify(result)).toBeGreaterThan(18);expect(result.std,JSON.stringify(result)).toBeGreaterThan(4);
});
