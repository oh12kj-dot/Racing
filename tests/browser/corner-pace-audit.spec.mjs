import {test,expect} from '@playwright/test';

async function boot(page){
  await page.addInitScript(()=>localStorage.setItem('racing_v10_settings',JSON.stringify({circuit:'SUZUKA',weather:'SUNNY'})));
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_TEST_TICK__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('isolated Formula lap exposes realistic dry Suzuka pace telemetry',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,tick=window.__RACING_TEST_TICK__,total=Number(W.total)||1,dt=.05;
    for(let i=0;i<1000;i++){tick(dt,false);if(R.flag==='GREEN'&&R.sessionPhase==='RACE'&&R.race.t>(R.race.green||0)+16)break;}
    const c=R.cars.find(x=>!x.retired)||R.cars[0];
    for(const o of R.cars){if(o===c)continue;o.retired=true;o.recovered=true;if(o.mesh)o.mesh.visible=false;}
    if(W.env){W.env.wetness=0;if('rain' in W.env)W.env.rain=0;if('rainIntensity' in W.env)W.env.rainIntensity=0;}
    Object.assign(c,{type:'formula',retired:false,recovered:false,pitState:'NONE',_runtimePitPhase:'TRACK',spinState:'NONE',hazardAvoiding:false,localYellow:false,hydroplaning:false,incident:0,damage:0,damageState:'NONE',fault:null,wear:0,avoid:0,blueFlag:false,coolingMode:false,predictiveSpeedCap:null,multiclassPassIntent:false,multiclassPassTargetId:null,multiclassPassLane:null,racecraftBlocked:false,fuelKg:5});
    R.events.length=0;R.flag='GREEN';
    const q=W.sample(c.s,c.lane);if(q?.p&&c.mesh){c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);c.mesh.visible=true;}
    for(let i=0;i<160;i++)tick(dt,false);
    const curvatureSamples=[];for(let s=0;s<total;s+=5)curvatureSamples.push({s,k:Math.abs(Number(W.racingCurvatureAt?.(s)??W.curvatureAt?.(s)??0))});
    const sorted=curvatureSamples.map(x=>x.k).sort((a,b)=>a-b),quantile=p=>sorted[Math.min(sorted.length-1,Math.max(0,Math.floor((sorted.length-1)*p)))]||0,q25=quantile(.25),q75=quantile(.75),q90=quantile(.90),maxCurvature=Math.max(...sorted);
    let prev=Number(c.s)||0,travel=0,start=Number(R.race.t)||0,end=null,maxSpeed=0,minSpeed=Infinity,minSpeedS=null,minSpeedK=null,sumSpeed=0,samples=0,maxLatUse=0,maxActualLatG=0,straightSum=0,straightN=0,curvySum=0,curvyN=0,tightSum=0,tightN=0;
    for(let i=0;i<3000&&end==null;i++){
      tick(dt,false);const now=Number(R.race.t)||0,s=Number(c.s)||0;let d=s-prev;if(d<-total*.5)d+=total;if(d>total*.5)d-=total;if(d>0)travel+=d;prev=s;
      const v=Math.max(0,Number(c.v)||0),kmh=v*3.6,k=Math.abs(Number(W.racingCurvatureAt?.(s)??W.curvatureAt?.(s)??0)),actualLatG=v*v*k/9.81;maxSpeed=Math.max(maxSpeed,kmh);if(kmh<minSpeed){minSpeed=kmh;minSpeedS=s;minSpeedK=k;}sumSpeed+=kmh;samples++;maxLatUse=Math.max(maxLatUse,Number(c.racingLatUse)||0);maxActualLatG=Math.max(maxActualLatG,actualLatG);
      if(k<=q25){straightSum+=kmh;straightN++;}if(k>=q75){curvySum+=kmh;curvyN++;}if(k>=q90){tightSum+=kmh;tightN++;}
      if(travel>=total)end=now;
    }
    return{total,lapTime:end!=null?end-start:null,maxSpeed,minSpeed,minSpeedS,minSpeedK,minRadius:minSpeedK>0?1/minSpeedK:null,maxCurvature,smallestRadius:maxCurvature>0?1/maxCurvature:null,meanSpeed:samples?sumSpeed/samples:0,straightMean:straightN?straightSum/straightN:0,curvyMean:curvyN?curvySum/curvyN:0,tightMean:tightN?tightSum/tightN:0,maxLatUse,maxActualLatG,q25,q75,q90,wetness:Number(W.env?.wetness)||0,lineMode:c.racingLineMode||null,completedLaps:travel/total,pitState:c.pitState,spinState:c.spinState,retired:c.retired,dynamics:R.racingDynamics?.find?.(x=>x.carId===c.id)||null};
  });
  console.log(`CORNER_PACE_AUDIT ${JSON.stringify(result)}`);
  expect(result.total,JSON.stringify(result)).toBeGreaterThan(5200);expect(result.total,JSON.stringify(result)).toBeLessThan(6400);
  expect(result.completedLaps,JSON.stringify(result)).toBeGreaterThanOrEqual(1);expect(result.lapTime,JSON.stringify(result)).toBeGreaterThan(60);expect(result.lapTime,JSON.stringify(result)).toBeLessThan(140);
  expect(result.wetness,JSON.stringify(result)).toBe(0);expect(result.lineMode,JSON.stringify(result)).not.toBe('WET');
  expect(result.maxSpeed,JSON.stringify(result)).toBeGreaterThan(220);expect(result.maxSpeed,JSON.stringify(result)).toBeLessThan(345);
  expect(result.tightMean,JSON.stringify(result)).toBeLessThan(result.straightMean);expect(result.curvyMean,JSON.stringify(result)).toBeLessThan(result.straightMean);
  expect(result.maxLatUse,JSON.stringify(result)).toBeGreaterThan(.25);expect(result.maxLatUse,JSON.stringify(result)).toBeLessThanOrEqual(.986);
  expect(result.maxActualLatG,JSON.stringify(result)).toBeGreaterThan(1.5);expect(result.maxActualLatG,JSON.stringify(result)).toBeLessThan(5.5);
  expect(result.pitState,JSON.stringify(result)).toBe('NONE');expect(result.retired,JSON.stringify(result)).toBeFalsy();
});
