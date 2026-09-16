import {test,expect} from '@playwright/test';

test('a single car does not remain locked near 101 km/h through formation or green-flag running',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});

  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,tick=window.__RACING_TEST_TICK__;
    if(!R||typeof tick!=='function')return{ready:false,status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''};

    const formation=[],green=[];
    let formationSeen=false,trackedId=0;
    for(let i=0;i<1800;i++){
      tick(.05,false);
      if(i%5!==0)continue;
      const car=R.cars.find(c=>c.id===trackedId)||R.cars[0];
      if(!car)continue;
      const kmh=Number((car.v*3.6).toFixed(2));
      if(R.formation){
        formationSeen=true;
        formation.push({t:R.race.t,kmh,target:Number(((car.formationSpeedTarget??car.v)*3.6).toFixed(2))});
      }else if(formationSeen&&R.formationDiagnostics?.done&&R.flag==='GREEN'&&R.sessionPhase==='RACE'&&!car.retired&&car.pitState==='NONE'){
        green.push({t:R.race.t,kmh,raw:Number(((car.racingSpeedRaw??0)*3.6).toFixed(2)),target:Number(((car.racingSpeedTarget??0)*3.6).toFixed(2))});
      }
    }

    const values=a=>a.map(x=>x.kmh).filter(Number.isFinite);
    const range=a=>{const v=values(a);return v.length?Math.max(...v)-Math.min(...v):0;};
    const near101=a=>{const v=values(a);return v.length?v.filter(x=>x>=99&&x<=103).length/v.length:1;};
    const greenV=values(green);
    return{
      ready:true,
      formationSeen,
      formationDone:R.formationDiagnostics?.done??false,
      dynamics:R.formationSpeedDiagnostics||null,
      formationCount:formation.length,
      formationRange:range(formation),
      formationNear101Ratio:near101(formation),
      greenCount:green.length,
      greenRange:range(green),
      greenPeak:greenV.length?Math.max(...greenV):0,
      formation:formation.slice(-80),
      green:green.slice(-80)
    };
  });

  expect(result.ready,JSON.stringify(result)).toBeTruthy();
  expect(result.formationSeen,JSON.stringify(result)).toBeTruthy();
  expect(result.formationDone,JSON.stringify(result)).toBeTruthy();
  expect(result.dynamics?.owner,JSON.stringify(result)).toBe('formation-dynamics-v2');
  expect(result.formationCount,JSON.stringify(result)).toBeGreaterThan(20);
  expect(result.formationRange,JSON.stringify(result)).toBeGreaterThan(18);
  expect(result.formationNear101Ratio,JSON.stringify(result)).toBeLessThan(.35);
  expect(result.greenCount,JSON.stringify(result)).toBeGreaterThan(20);
  expect(result.greenPeak,JSON.stringify(result)).toBeGreaterThan(125);
  expect(result.greenRange,JSON.stringify(result)).toBeGreaterThan(15);
});
