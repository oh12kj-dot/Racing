import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const ready=!!(window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_REGRESSION_MONITOR__);
    return ready||document.querySelector('#status')?.textContent==='ERROR';
  },null,{timeout:30000});
  const state=await page.evaluate(()=>({ready:!!(window.__RACING_RACE__&&window.__RACING_WORLD__),status:document.querySelector('#status')?.textContent||'',error:document.querySelector('#error')?.textContent||''}));
  expect(state.status,state.error||'runtime boot status').not.toBe('ERROR');
  expect(state.ready,state.error||'runtime globals were not created').toBeTruthy();
}

test('pit intent stays on the circuit until the physical pit entry',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired);
    if(!c)return{supported:false};
    for(const o of R.cars)if(o!==c)o.retired=true;
    c.retired=false;c.pitState='ENTRY';c._runtimePitPhase='PIT_ENTRY';c._runtimePitQueued=false;c._runtimeReleaseWait=false;
    c.s=W.total*.86;c.lap=1;c.lane=0;c.laneTarget=0;c.v=32;c.accel=6;c.baseMax=70;c.max=70;
    R.update(.016);
    const q=W.sample(c.s,c.lane),pit=W.pitPose(c.s,c.teamId,'ENTRY');
    const dx=c.mesh.position.x-q.p.x,dz=c.mesh.position.z-q.p.z;
    const pdx=c.mesh.position.x-pit.p.x,pdz=c.mesh.position.z-pit.p.z;
    return{supported:true,inPit:W.inPitWindow(c.s),trackDistance:Math.hypot(dx,dz),pitDistance:Math.hypot(pdx,pdz),lane:c.lane,state:c.pitState,pending:!!c._runtimePitPending,phase:c._runtimePitPhase,pitStateMetrics:R.pitStateDiagnostics?.metrics||{},diag:R.pitTrafficIsolation};
  });
  expect(r.supported).toBeTruthy();
  expect(r.inPit).toBeFalsy();
  expect(r.trackDistance,JSON.stringify(r)).toBeLessThan(.35);
  expect(r.pitDistance,JSON.stringify(r)).toBeGreaterThan(2.5);
  expect(r.state,JSON.stringify(r)).toBe('NONE');
  expect(r.pending,JSON.stringify(r)).toBeTruthy();
  expect(r.phase,JSON.stringify(r)).toBe('PIT_APPROACH');
  expect(r.pitStateMetrics?.earlyEntriesDeferred||0).toBeGreaterThan(0);
});

test('pit longitudinal coordinate stays continuous across the entry line',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,R=window.__RACING_RACE__,entry=W.pitCoordinateAudit?.entryUF??.962,total=W.total,team=R.cars.find(c=>!c.retired)?.teamId??0;
    const before=(entry-.0005)*total,after=(entry+.0005)*total;
    return{
      owner:W.pitCoordinateAudit?.owner||null,
      beforeUF:W.pitUnwrappedFraction(before),
      afterUF:W.pitUnwrappedFraction(after),
      beforeDist:W.pitDistanceToBox(before,team),
      afterDist:W.pitDistanceToBox(after,team),
      beforeInPit:W.inPitWindow(before),
      afterInPit:W.inPitWindow(after)
    };
  });
  expect(r.owner).toBe('runtime-pit-coordinate-v2');
  expect(r.afterUF-r.beforeUF,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.afterUF-r.beforeUF,JSON.stringify(r)).toBeLessThan(.003);
  expect(r.beforeDist,JSON.stringify(r)).toBeGreaterThan(r.afterDist);
  expect(r.beforeDist,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.afterDist,JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.beforeInPit).toBeFalsy();
  expect(r.afterInPit).toBeTruthy();
});

test('pit garages have real open fronts and stay clear of every working box',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const W=window.__RACING_WORLD__,root=W.scene.getObjectByName?.('SUZUKA_HOME_COMPLEX_V42'),garages=W.runtimePit?.garageOpenings;
    if(!root||!garages?.children?.length)return{supported:false};
    let visibleLegacyGarageBodies=0,visibleLegacyCanopies=0;
    root.traverse(o=>{
      if(!o?.isMesh||o.geometry?.type!=='BoxGeometry'||o.visible===false)return;
      const p=o.geometry.parameters||{};
      if(Math.abs((p.width||0)-7.4)<.08&&Math.abs((p.height||0)-4.15)<.08&&(p.depth||0)>5&&(p.depth||0)<12)visibleLegacyGarageBodies++;
      if(Math.abs((p.width||0)-10.6)<.08&&Math.abs((p.height||0)-.22)<.04&&(p.depth||0)>5&&(p.depth||0)<12)visibleLegacyCanopies++;
    });
    const rows=garages.children.map((garage,team)=>{
      const u=garage.userData||{},work=W.pitPose(W.pitBoxS(team),team,'STOP'),theta=garage.rotation.y;
      const frontWorld={x:garage.position.x+Math.cos(theta)*(Number(u.frontLocal)||0),z:garage.position.z-Math.sin(theta)*(Number(u.frontLocal)||0)};
      const centerClearance=Math.hypot(frontWorld.x-work.p.x,frontWorld.z-work.p.z);
      let solidCount=0,frontBlockers=0;
      garage.traverse(o=>{
        if(!o?.isMesh||!o.userData?.pitGarageSolid||o.geometry?.type!=='BoxGeometry')return;
        solidCount++;
        const p=o.geometry.parameters||{},hx=(p.width||0)*.5,hy=(p.height||0)*.5,hz=(p.depth||0)*.5;
        const crossesFront=(o.position.x-hx)<=u.frontLocal+.05&&(o.position.x+hx)>=u.frontLocal-.35;
        const crossesOpeningCenter=(o.position.z-hz)<.15&&(o.position.z+hz)>-.15;
        const crossesUsableHeight=(o.position.y-hy)<u.openingHeight-.22&&(o.position.y+hy)>.30;
        if(crossesFront&&crossesOpeningCenter&&crossesUsableHeight)frontBlockers++;
      });
      return{team,opening:!!u.pitGarageOpening,openingWidth:u.openingWidth,openingHeight:u.openingHeight,recessDepth:u.recessDepth,workEdgeToFront:u.workEdgeToGarageFront,centerClearance,solidCount,frontBlockers};
    });
    return{supported:true,count:garages.children.length,visibleLegacyGarageBodies,visibleLegacyCanopies,rows,audit:W.circuitAudit?.runtimePit||null};
  });
  expect(r.supported,JSON.stringify(r)).toBeTruthy();
  expect(r.count,JSON.stringify(r)).toBe(10);
  expect(r.visibleLegacyGarageBodies,JSON.stringify(r)).toBe(0);
  expect(r.visibleLegacyCanopies,JSON.stringify(r)).toBe(0);
  for(const g of r.rows){
    expect(g.opening,JSON.stringify(g)).toBeTruthy();
    expect(g.openingWidth,JSON.stringify(g)).toBeGreaterThanOrEqual(7.5);
    expect(g.openingHeight,JSON.stringify(g)).toBeGreaterThanOrEqual(3.0);
    expect(g.recessDepth,JSON.stringify(g)).toBeGreaterThanOrEqual(6.0);
    expect(g.workEdgeToFront,JSON.stringify(g)).toBeGreaterThan(4.5);
    expect(g.centerClearance,JSON.stringify(g)).toBeGreaterThan(6.0);
    expect(g.solidCount,JSON.stringify(g)).toBeGreaterThanOrEqual(8);
    expect(g.frontBlockers,JSON.stringify(g)).toBe(0);
  }
  expect(r.audit?.garageOpeningWidth,JSON.stringify(r)).toBeGreaterThanOrEqual(7.5);
  expect(r.audit?.workEdgeToGarageFront,JSON.stringify(r)).toBeGreaterThan(4.5);
});

test('fast-lane traffic passes a stationary working-lane service car',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,live=R.cars.filter(c=>!c.retired);
    const stopped=live.find(c=>(c.teamId??0)===0)||live[0];
    const passer=live.find(c=>c!==stopped&&(c.teamId??0)!==(stopped.teamId??0)&&((c.teamId??0)>=7))||live.find(c=>c!==stopped&&(c.teamId??0)!==(stopped.teamId??0));
    if(!stopped||!passer)return{supported:false};
    for(const c of R.cars)if(c!==stopped&&c!==passer)c.retired=true;
    stopped.retired=false;passer.retired=false;
    const total=W.total,box=W.pitBoxS(stopped.teamId),wrap=s=>((s%total)+total)%total;
    stopped.s=box;stopped.lap=1;stopped.v=0;stopped.pitState='STOP';stopped.pitTimer=99;stopped._pitStopInitial=99;stopped._runtimePitPhase='SERVICE';stopped._runtimePitQueued=false;stopped._runtimeReleaseWait=false;stopped.lane=3.7;stopped.laneTarget=3.7;
    passer.s=wrap(box-7);passer.lap=1;passer.v=18;passer.pitState='ENTRY';passer.pitTimer=0;passer._runtimePitPhase='FAST_LANE';passer._runtimePitQueued=false;passer._runtimeReleaseWait=false;passer.lane=3.7;passer.laneTarget=3.7;passer.baseMax=72;passer.max=72;passer.accel=7;passer.brake=16.5;
    const before=passer.s;
    for(let i=0;i<10;i++)R.update(.05);
    const delta=((passer.s-before)%total+total)%total;
    const stopDelta=Math.abs(((stopped.s-box+total*.5)%total)-total*.5);
    const fastPose=W.pitFastPose(passer.s),workPose=W.pitPose(stopped.s,stopped.teamId,'STOP');
    return{supported:true,delta,stopDelta,v:passer.v,passState:passer.pitState,stopState:stopped.pitState,visualSeparation:Math.hypot(fastPose.p.x-workPose.p.x,fastPose.p.z-workPose.p.z),diag:R.pitTrafficIsolation};
  });
  expect(r.supported).toBeTruthy();
  expect(r.stopState).toBe('STOP');
  expect(r.stopDelta,JSON.stringify(r)).toBeLessThan(.3);
  expect(r.visualSeparation,JSON.stringify(r)).toBeGreaterThan(2.8);
  expect(r.delta,JSON.stringify(r)).toBeGreaterThan(6);
  expect(r.v,JSON.stringify(r)).toBeGreaterThan(12);
  expect(r.diag?.lastFast||0).toBeGreaterThan(0);
  expect(r.diag?.lastWorking||0).toBeGreaterThan(0);
});
