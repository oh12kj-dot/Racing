import {test,expect} from '@playwright/test';

test('one car and the live field avoid the former 101 km/h pace lock',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,tick=window.__RACING_TEST_TICK__;
    if(!R||!W||typeof tick!=='function')return{ready:false,status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''};
    const samples=[],formationCruise=[],greenTracked=[];
    const trackedId=R.cars[0]?.id;
    // 80 simulated seconds, but use the runtime test hook's largest stable step so this
    // regression stays well below Playwright's wall-clock timeout in CI.
    for(let i=0;i<1600;i++){
      tick(.05,false);
      const tracked=R.cars.find(c=>c.id===trackedId);
      if(i%5===0&&R.formation){
        const remain=Math.max(0,Number(tracked?._formationTarget||0)-Number(tracked?._formationTravel||0));
        // Exclude the final grid-approach slowdown. The old bug lived in this cruise phase:
        // targetV was hard-coded to 28 m/s, so the same car sat at ~100.8 km/h.
        if(tracked&&remain>180)formationCruise.push(Number((tracked.v*3.6).toFixed(2)));
      }
      if(i%10===0&&tracked&&!tracked.retired&&tracked.pitState==='NONE'&&R.flag==='GREEN'&&R.sessionPhase==='RACE'&&R.formationDiagnostics?.done&&R.race.t>(R.race.green||0)+8){
        greenTracked.push(Number((tracked.v*3.6).toFixed(2)));
      }
      if(i%40===0){
        const cars=R.cars.filter(c=>!c.retired&&c.pitState==='NONE');
        samples.push({
          t:R.race.t,flag:R.flag,phase:R.sessionPhase,
          speeds:cars.map(c=>Number((c.v*3.6).toFixed(1))),
          raw:cars.map(c=>Number((c.racingSpeedRaw??0)*3.6)),
          target:cars.map(c=>Number((c.racingSpeedTarget??0)*3.6)),
          modes:cars.map(c=>c.racingMode||''),
          lines:cars.map(c=>c.racingLineMode||''),
          strategies:cars.map(c=>c.strategy?.reason||c.strategyTelemetry?.reason||'')
        });
      }
    }
    const green=samples.filter(s=>s.flag==='GREEN'&&s.phase==='RACE'&&s.t>(R.race.green||0)+12);
    const stats=green.map(s=>{
      const speeds=s.speeds||[],min=Math.min(...speeds),max=Math.max(...speeds),mean=speeds.reduce((a,b)=>a+b,0)/Math.max(1,speeds.length),variance=speeds.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,speeds.length);
      return{min,max,spread:max-min,std:Math.sqrt(variance)};
    });
    const latest=green.at(-1)||samples.at(-1)||{speeds:[]},peak=stats.length?Math.max(...stats.map(s=>s.max)):0,maxSpread=stats.length?Math.max(...stats.map(s=>s.spread)):0,maxStd=stats.length?Math.max(...stats.map(s=>s.std)):0;
    const formationMin=formationCruise.length?Math.min(...formationCruise):0,formationMax=formationCruise.length?Math.max(...formationCruise):0,formationNear101Ratio=formationCruise.length?formationCruise.filter(v=>v>=99&&v<=103).length/formationCruise.length:1;
    const trackedMin=greenTracked.length?Math.min(...greenTracked):0,trackedMax=greenTracked.length?Math.max(...greenTracked):0,trackedNear101Ratio=greenTracked.length?greenTracked.filter(v=>v>=99&&v<=103).length/greenTracked.length:1;
    const curvature=[];for(let i=0;i<240;i++){const s=(W.total||1)*i/240;curvature.push(Math.abs(Number(W.racingCurvatureAt?.(s)||0)));}
    curvature.sort((a,b)=>a-b);
    return{ready:true,formationDone:R.formationDiagnostics?.done??false,trackedId,formationCount:formationCruise.length,formationMin,formationMax,formationRange:formationMax-formationMin,formationNear101Ratio,greenTrackedCount:greenTracked.length,greenTrackedRange:trackedMax-trackedMin,greenTrackedMin:trackedMin,greenTrackedMax:trackedMax,greenTrackedNear101Ratio:trackedNear101Ratio,latest,greenCount:green.length,peak,maxSpread,maxStd,curvP50:curvature[Math.floor(curvature.length*.5)],curvP90:curvature[Math.floor(curvature.length*.9)],curvMax:curvature.at(-1),samples};
  });
  expect(result.ready,JSON.stringify(result)).toBeTruthy();
  expect(result.formationDone,JSON.stringify(result)).toBeTruthy();
  expect(result.formationCount,JSON.stringify(result)).toBeGreaterThan(10);
  expect(result.formationRange,JSON.stringify(result)).toBeGreaterThan(8);
  expect(result.formationNear101Ratio,JSON.stringify(result)).toBeLessThan(.55);
  expect(result.greenTrackedCount,JSON.stringify(result)).toBeGreaterThan(8);
  expect(result.greenTrackedRange,JSON.stringify(result)).toBeGreaterThan(15);
  expect(result.greenTrackedNear101Ratio,JSON.stringify(result)).toBeLessThan(.65);
  expect(result.greenCount,JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.peak,JSON.stringify(result)).toBeGreaterThan(125);
  expect(result.maxSpread,JSON.stringify(result)).toBeGreaterThan(18);
  expect(result.maxStd,JSON.stringify(result)).toBeGreaterThan(4);
});
