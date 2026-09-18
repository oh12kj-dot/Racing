import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_TEST_TICK__)||document.querySelector('#status')?.textContent==='ERROR',null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('isolated Formula lap exposes realistic Suzuka pace telemetry',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,tick=window.__RACING_TEST_TICK__,total=Number(W.total)||1,dt=.05;
    for(let i=0;i<1000;i++){tick(dt,false);if(R.flag==='GREEN'&&R.sessionPhase==='RACE'&&R.race.t>(R.race.green||0)+16)break;}
    const c=R.cars.find(x=>!x.retired)||R.cars[0];
    for(const o of R.cars){if(o===c)continue;o.retired=true;o.recovered=true;if(o.mesh)o.mesh.visible=false;}
    Object.assign(c,{type:'formula',retired:false,recovered:false,pitState:'NONE',_runtimePitPhase:'TRACK',spinState:'NONE',hazardAvoiding:false,localYellow:false,hydroplaning:false,incident:0,damage:0,damageState:'NONE',fault:null,wear:0,avoid:0,blueFlag:false,coolingMode:false,predictiveSpeedCap:null,multiclassPassIntent:false,multiclassPassTargetId:null,multiclassPassLane:null,racecraftBlocked:false,fuelKg:65});
    R.events.length=0;R.flag='GREEN';
    const q=W.sample(c.s,c.lane);if(q?.p&&c.mesh){c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);c.mesh.visible=true;}
    const curvatures=[];for(let s=0;s<total;s+=5)curvatures.push(Math.abs(Number(W.racingCurvatureAt?.(s)??W.curvatureAt?.(s)??0)));curvatures.sort((a,b)=>a-b);
    const quantile=p=>curvatures[Math.min(curvatures.length-1,Math.max(0,Math.floor((curvatures.length-1)*p)))]||0,q25=quantile(.25),q75=quantile(.75),q90=quantile(.90);
    let prev=Number(c.s)||0,travel=0,lapIndex=0,lapStart=Number(R.race.t)||0,secondStart=null,secondEnd=null,maxSpeed=0,minSpeed=Infinity,sumSpeed=0,samples=0,maxLatUse=0,straightSum=0,straightN=0,curvySum=0,curvyN=0,tightSum=0,tightN=0;
    for(let i=0;i<7000&&secondEnd==null;i++){
      tick(dt,false);const now=Number(R.race.t)||0,s=Number(c.s)||0;let d=s-prev;if(d<-total*.5)d+=total;if(d>total*.5)d-=total;if(d>0)travel+=d;prev=s;
      const v=Math.max(0,Number(c.v)||0),kmh=v*3.6,k=Math.abs(Number(W.racingCurvatureAt?.(s)??W.curvatureAt?.(s)??0));maxSpeed=Math.max(maxSpeed,kmh);minSpeed=Math.min(minSpeed,kmh);sumSpeed+=kmh;samples++;maxLatUse=Math.max(maxLatUse,Number(c.racingLatUse)||0);
      if(k<=q25){straightSum+=kmh;straightN++;}if(k>=q75){curvySum+=kmh;curvyN++;}if(k>=q90){tightSum+=kmh;tightN++;}
      const newLap=Math.floor(travel/total);if(newLap>lapIndex){lapIndex=newLap;if(lapIndex===1){secondStart=now;maxSpeed=0;minSpeed=Infinity;sumSpeed=0;samples=0;maxLatUse=0;straightSum=0;straightN=0;curvySum=0;curvyN=0;tightSum=0;tightN=0;}else if(lapIndex===2){secondEnd=now;break;}}
    }
    return{total,lapTime:secondStart!=null&&secondEnd!=null?secondEnd-secondStart:null,maxSpeed,minSpeed,meanSpeed:samples?sumSpeed/samples:0,straightMean:straightN?straightSum/straightN:0,curvyMean:curvyN?curvySum/curvyN:0,tightMean:tightN?tightSum/tightN:0,maxLatUse,q25,q75,q90,completedLaps:lapIndex,pitState:c.pitState,spinState:c.spinState,retired:c.retired,dynamics:R.racingDynamics?.find?.(x=>x.carId===c.id)||null};
  });
  console.log(`CORNER_PACE_AUDIT ${JSON.stringify(result)}`);
  expect(result.total,JSON.stringify(result)).toBeGreaterThan(5200);expect(result.total,JSON.stringify(result)).toBeLessThan(6400);
  expect(result.completedLaps,JSON.stringify(result)).toBeGreaterThanOrEqual(2);expect(result.lapTime,JSON.stringify(result)).toBeGreaterThan(60);expect(result.lapTime,JSON.stringify(result)).toBeLessThan(140);
  expect(result.maxSpeed,JSON.stringify(result)).toBeGreaterThan(220);expect(result.maxSpeed,JSON.stringify(result)).toBeLessThan(360);
  expect(result.tightMean,JSON.stringify(result)).toBeLessThan(result.straightMean);expect(result.curvyMean,JSON.stringify(result)).toBeLessThan(result.straightMean);
  expect(result.maxLatUse,JSON.stringify(result)).toBeGreaterThan(.25);expect(result.maxLatUse,JSON.stringify(result)).toBeLessThanOrEqual(.986);
  expect(result.pitState,JSON.stringify(result)).toBe('NONE');expect(result.retired,JSON.stringify(result)).toBeFalsy();
});
