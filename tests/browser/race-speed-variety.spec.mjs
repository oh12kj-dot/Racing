import {test,expect} from '@playwright/test';

test('one car and the live field avoid the former 101 km/h pace lock',async({page})=>{
  await page.addInitScript(()=>{
    let s=0x6d2b79f5>>>0;
    Math.random=()=>{s=(Math.imul(s^s>>>15,1|s)+0x6d2b79f5)>>>0;s=(s+Math.imul(s^s>>>7,61|s))^s;return((s^s>>>14)>>>0)/4294967296;};
  });
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,tick=window.__RACING_TEST_TICK__;
    if(!R||!W||typeof tick!=='function')return{ready:false,status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''};
    const samples=[],greenTracked=[];let uncappedGreenCount=0;
    const trackedId=R.cars[0]?.id;
    for(let i=0;i<1600;i++){
      tick(.05,false);
      const tracked=R.cars.find(c=>c.id===trackedId),greenRace=R.flag==='GREEN'&&R.sessionPhase==='RACE'&&R.race.t>(R.race.green||0)+8;
      if(i%10===0&&tracked&&!tracked.retired&&tracked.pitState==='NONE'&&greenRace){
        greenTracked.push(Number((tracked.v*3.6).toFixed(2)));
        if(R.cars.some(c=>!c.retired&&c.pitState==='NONE'&&c.predictiveSpeedCap==null&&c.racingSafetyCap==null))uncappedGreenCount++;
      }
      if(i%40===0){
        const cars=R.cars.filter(c=>!c.retired&&c.pitState==='NONE');
        samples.push({t:R.race.t,flag:R.flag,phase:R.sessionPhase,speeds:cars.map(c=>Number((c.v*3.6).toFixed(1)))});
      }
    }
    const green=samples.filter(s=>s.flag==='GREEN'&&s.phase==='RACE'&&s.t>(R.race.green||0)+12);
    const stats=green.map(s=>{const speeds=s.speeds||[],min=Math.min(...speeds),max=Math.max(...speeds),mean=speeds.reduce((a,b)=>a+b,0)/Math.max(1,speeds.length),variance=speeds.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,speeds.length);return{min,max,spread:max-min,std:Math.sqrt(variance)};});
    const range=a=>a.length?Math.max(...a)-Math.min(...a):0,near101=a=>a.length?a.filter(v=>v>=99&&v<=103).length/a.length:1;
    return{ready:true,greenTrackedCount:greenTracked.length,greenTrackedRange:range(greenTracked),greenTrackedNear101Ratio:near101(greenTracked),uncappedGreenCount,greenCount:green.length,peak:stats.length?Math.max(...stats.map(s=>s.max)):0,maxSpread:stats.length?Math.max(...stats.map(s=>s.spread)):0,maxStd:stats.length?Math.max(...stats.map(s=>s.std)):0};
  });
  expect(result.ready,JSON.stringify(result)).toBeTruthy();
  expect(result.greenTrackedCount,JSON.stringify(result)).toBeGreaterThan(8);
  expect(result.greenTrackedRange,JSON.stringify(result)).toBeGreaterThan(15);
  expect(result.greenTrackedNear101Ratio,JSON.stringify(result)).toBeLessThan(.65);
  expect(result.uncappedGreenCount,JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.greenCount,JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.peak,JSON.stringify(result)).toBeGreaterThan(115);
  expect(result.maxSpread,JSON.stringify(result)).toBeGreaterThan(18);
  expect(result.maxStd,JSON.stringify(result)).toBeGreaterThan(4);
});