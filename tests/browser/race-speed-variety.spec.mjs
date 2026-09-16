import {test,expect} from '@playwright/test';

test('formation and green-flag race do not collapse to a universal ~101 km/h pace',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,tick=window.__RACING_TEST_TICK__;
    if(!R||!W||typeof tick!=='function')return{ready:false,status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''};
    const samples=[];
    // 80 simulated seconds, using the runtime test hook's largest stable step so this
    // regression stays well below Playwright's wall-clock timeout in CI.
    for(let i=0;i<1600;i++){
      tick(.05,false);
      if(i%40===0){
        const cars=R.cars.filter(c=>!c.retired&&c.pitState==='NONE');
        samples.push({
          t:R.race.t,formationElapsed:R.formationDiagnostics?.elapsed??null,flag:R.flag,phase:R.sessionPhase,
          speeds:cars.map(c=>Number((c.v*3.6).toFixed(1))),
          raw:cars.map(c=>Number((c.racingSpeedRaw??0)*3.6)),
          target:cars.map(c=>Number((c.racingSpeedTarget??0)*3.6)),
          modes:cars.map(c=>c.racingMode||''),
          lines:cars.map(c=>c.racingLineMode||''),
          strategies:cars.map(c=>c.strategy?.reason||c.strategyTelemetry?.reason||'')
        });
      }
    }
    const statsFor=s=>{
      const speeds=s.speeds||[],min=Math.min(...speeds),max=Math.max(...speeds),mean=speeds.reduce((a,b)=>a+b,0)/Math.max(1,speeds.length),variance=speeds.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,speeds.length);
      return{min,max,mean,spread:max-min,std:Math.sqrt(variance),elapsed:s.formationElapsed};
    };
    const formation=samples.filter(s=>s.phase==='FORMATION'&&s.speeds?.length).map(statsFor);
    // Inspect the first five formation samples, before the final grid-approach slowdown.
    // The old regression sat at targetV=28 m/s = 100.8 km/h throughout this window.
    const earlyFormation=formation.slice(0,5),earlyMeans=earlyFormation.map(s=>s.mean),formationMeanRange=earlyMeans.length?Math.max(...earlyMeans)-Math.min(...earlyMeans):0;
    const pinnedFormationSamples=earlyFormation.filter(s=>s.mean>=99&&s.mean<=102.5&&s.spread<4).length;
    const green=samples.filter(s=>s.flag==='GREEN'&&s.phase==='RACE'&&s.t>(R.race.green||0)+12);
    const stats=green.map(statsFor);
    const latest=green.at(-1)||samples.at(-1)||{speeds:[]},peak=stats.length?Math.max(...stats.map(s=>s.max)):0,maxSpread=stats.length?Math.max(...stats.map(s=>s.spread)):0,maxStd=stats.length?Math.max(...stats.map(s=>s.std)):0;
    const curvature=[];for(let i=0;i<240;i++){const s=(W.total||1)*i/240;curvature.push(Math.abs(Number(W.racingCurvatureAt?.(s)||0)));}
    curvature.sort((a,b)=>a-b);
    return{ready:true,formationDone:R.formationDiagnostics?.done??false,formationPaceModel:R.formationDiagnostics?.paceModel??'',formationCount:formation.length,earlyFormation,formationMeanRange,pinnedFormationSamples,latest,greenCount:green.length,peak,maxSpread,maxStd,curvP50:curvature[Math.floor(curvature.length*.5)],curvP90:curvature[Math.floor(curvature.length*.9)],curvMax:curvature.at(-1),samples};
  });
  expect(result.ready,JSON.stringify(result)).toBeTruthy();
  expect(result.formationDone,JSON.stringify(result)).toBeTruthy();
  expect(result.formationPaceModel,JSON.stringify(result)).toBe('VARIABLE_CURVATURE');
  expect(result.formationCount,JSON.stringify(result)).toBeGreaterThan(4);
  expect(result.formationMeanRange,JSON.stringify(result)).toBeGreaterThan(8);
  expect(result.pinnedFormationSamples,JSON.stringify(result)).toBeLessThan(4);
  expect(result.greenCount,JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.peak,JSON.stringify(result)).toBeGreaterThan(125);
  expect(result.maxSpread,JSON.stringify(result)).toBeGreaterThan(18);
  expect(result.maxStd,JSON.stringify(result)).toBeGreaterThan(4);
});
