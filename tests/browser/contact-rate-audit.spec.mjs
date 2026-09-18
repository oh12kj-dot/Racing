import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

async function bootSeeded(page){
  await page.addInitScript(()=>{
    let s=0x6d2b79f5>>>0;
    Math.random=()=>{s=(Math.imul(s^s>>>15,1|s)+0x6d2b79f5)>>>0;s=(s+Math.imul(s^s>>>7,61|s))^s;return((s^s>>>14)>>>0)/4294967296;};
  });
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_RACE__||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
}

test('natural seeded race does not devolve into repeated car-to-car contact',async({page})=>{
  test.setTimeout(90000);
  await bootSeeded(page);
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,tick=window.__RACING_TEST_TICK__;
    if(!R||typeof tick!=='function')return{ready:false,status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''};
    const seen=new Set(),contacts=[],incidents=[];let greenSeconds=0,greenSamples=0,maxConcurrentBattle=0;
    for(let i=0;i<3600;i++){
      tick(.05,false);
      if(R.flag==='GREEN'&&R.sessionPhase==='RACE'&&R.race.t>(R.race.green||0)){greenSeconds+=.05;greenSamples++;}
      let battles=0;for(const c of R.cars||[])if(!c.retired&&c.pitState==='NONE'&&(c.battleState==='ATTACK'||c.battleState==='DEFEND'||c.racecraftState==='ATTACK'||c.racecraftState==='DEFEND'))battles++;
      maxConcurrentBattle=Math.max(maxConcurrentBattle,battles);
      const events=R.events||[],start=Math.max(0,events.length-32);
      for(let j=start;j<events.length;j++){
        const e=events[j];if(!e?.id||seen.has(e.id))continue;seen.add(e.id);
        if(e.type==='CONTACT')contacts.push({t:e.t,kmh:Number(e.data?.impactKmh)||0,severity:Number(e.data?.severity)||0,a:e.carId,b:e.data?.otherId,physical:!!e.data?.physical,trajectoryAudit:!!e.data?.trajectoryAudit,zoneA:e.data?.zoneA||null,zoneB:e.data?.zoneB||null});
        if(e.type==='INCIDENT'&&e.data?.kind==='CAR_CAR')incidents.push({t:e.t,kmh:Number(e.data?.impactKmh)||0,severity:Number(e.data?.severity)||0});
      }
    }
    const mins=Math.max(greenSeconds/60,1/60),high=contacts.filter(x=>x.kmh>=25),heavy=contacts.filter(x=>x.kmh>=50),pairCounts={};
    for(const x of contacts){const a=Math.min(Number(x.a)||0,Number(x.b)||0),b=Math.max(Number(x.a)||0,Number(x.b)||0),k=`${a}-${b}`;pairCounts[k]=(pairCounts[k]||0)+1;}
    const hottestPair=Math.max(0,...Object.values(pairCounts));
    const trajectory=R.trajectoryDiagnostics||R.trajectoryController?.diagnostics?.()||R.trajectoryControlDiagnostics||null;
    return{ready:true,greenSeconds,greenSamples,contacts:contacts.length,highContacts:high.length,heavyContacts:heavy.length,incidents:incidents.length,contactRate:contacts.length/mins,highRate:high.length/mins,heavyRate:heavy.length/mins,hottestPair,maxConcurrentBattle,trajectory,tail:contacts.slice(-12)};
  });
  expect(result.ready,JSON.stringify(result)).toBeTruthy();
  expect(result.greenSeconds,JSON.stringify(result)).toBeGreaterThan(90);
  expect(result.maxConcurrentBattle,JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.contactRate,JSON.stringify(result)).toBeLessThanOrEqual(4);
  expect(result.highRate,JSON.stringify(result)).toBeLessThanOrEqual(1.5);
  expect(result.heavyRate,JSON.stringify(result)).toBeLessThanOrEqual(.75);
  expect(result.hottestPair,JSON.stringify(result)).toBeLessThanOrEqual(3);
  if(result.trajectory?.unhandledContacts!=null)expect(result.trajectory.unhandledContacts,JSON.stringify(result)).toBe(0);
});

test('predictive lateral avoidance is dt-normalized instead of frame-count dependent',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-contact-avoidance.js',import.meta.url),'utf8');
  expect(source).toContain('function frameRateAlpha(per60,dt)');
  expect(source).toContain('keep=frameRateAlpha(keepPer60,dt)');
  expect(source).toContain('step=frameRateAlpha(.20*respect,dt)');
  expect(source).not.toContain('(safeLat-Math.abs(delta))*.20*respect');
});

test('side-by-side safety corridor is dt-normalized',()=>{
  const source=readFileSync(new URL('../../iphone-demo/runtime/race-side-by-side.js',import.meta.url),'utf8');
  expect(source).toContain('frameRateAlpha');
  expect(source).toContain('reserveSideBySide(dt)');
  expect(source).toContain('blend=frameRateAlpha(blendPer60,dt)');
  expect(source).not.toContain("lo.laneTarget+=(mid-desired*.5-lo.laneTarget)*blendPer60");
});