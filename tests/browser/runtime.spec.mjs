import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#status')).not.toHaveText('ERROR',{timeout:20000});
  await page.waitForFunction(()=>window.__RACING_RACE__&&window.__RACING_WORLD__&&window.__RACING_REGRESSION_MONITOR__,null,{timeout:25000});
}

test('boots, renders non-empty frame, and runtime invariants stay clean',async({page})=>{
  await boot(page);
  await page.waitForTimeout(5000);
  const result=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent,reg:window.__RACING_REGRESSION_MONITOR__.run(),audit:window.__RACING_WORLD__.auditCircuit?.()}));
  expect(result.status).not.toContain('ERROR');
  expect(result.reg.failures.filter(x=>!['BARRIER_RESIDUAL_OVERLAP'].includes(x.code))).toEqual([]);
  const shot=await page.screenshot({fullPage:false});
  expect(shot.byteLength).toBeGreaterThan(25000);
  expect(result.audit?.runtimePit?.mainTrackEdgeOverlapAtMerge??0).toBe(0);
});

test('guardrail re-entry during impact cooldown is separated and spin recovers',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__,c=R.cars.find(x=>!x.retired&&x.pitState==='NONE'),bar=W.trackBarriers?.colliders?.find(x=>x&&x.sideSign<0)||W.trackBarriers?.colliders?.[0];
    if(!c||!bar)return{supported:false};
    const place=()=>{
      c.retired=false;c.pitState='NONE';c.s=bar.s;c.lane=bar.sideSign*W.trackBarriers.offset;c.laneTarget=c.lane;c.v=18;
      const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);
    };
    // First contact arms the legacy barrier damage cooldown and may be resolved by
    // the legacy solver itself.
    c.spinState='NONE';place();R.update(.016);
    // Reinsert immediately while the legacy 0.42 s impact cooldown is still active.
    // This is the regression that previously allowed a car to run inside the rail.
    c.spinState='SLIDE';c.spinTimer=1;c.spinSeverity=.75;place();
    const before=!!W.barrierContact(c),correctionsBefore=R.barrierSafetyDiagnostics.corrections;
    R.update(.016);
    const after=!!W.barrierContact(c),diag=R.barrierSafetyDiagnostics;
    return{supported:true,before,after,corrections:diag.corrections-correctionsBefore,spinState:c.spinState,diag};
  });
  expect(r.supported).toBeTruthy();expect(r.before).toBeTruthy();expect(r.after).toBeFalsy();expect(r.corrections).toBeGreaterThan(0);expect(r.spinState).not.toBe('SLIDE');
});

test('different teams can service concurrently while same-team double stack queues',async({page})=>{
  await boot(page);
  const r=await page.evaluate(()=>{
    const R=window.__RACING_RACE__,W=window.__RACING_WORLD__;
    const byTeam=new Map();for(const c of R.cars){const a=byTeam.get(c.teamId)||[];a.push(c);byTeam.set(c.teamId,a);}
    const teams=[...byTeam.entries()].filter(([,a])=>a.length).slice(0,2);if(teams.length<2)return{supported:false};
    const a=teams[0][1][0],b=teams[1][1][0];
    for(const c of[a,b]){c.retired=false;c.s=W.pitBoxS(c.teamId);c.v=0;c.pitState='STOP';c.pitTimer=2;c._pitStopInitial=2;c._runtimePitArrival=null;}
    R.update(.016);const parallel=a.pitState==='STOP'&&b.pitState==='STOP';
    const mate=teams.find(([,x])=>x.length>=2)?.[1];if(!mate)return{supported:true,parallel,doubleStack:null};
    const x=mate[0],y=mate[1];for(const c of[x,y]){c.retired=false;c.s=W.pitBoxS(c.teamId);c.v=0;c.pitState='STOP';c.pitTimer=2;c._pitStopInitial=2;c._runtimePitArrival=null;c._runtimePitQueued=false;}
    R.update(.016);const stopCount=[x,y].filter(c=>c.pitState==='STOP').length,queueCount=[x,y].filter(c=>c._runtimePitQueued).length;
    return{supported:true,parallel,doubleStack:{stopCount,queueCount}};
  });
  expect(r.supported).toBeTruthy();expect(r.parallel).toBeTruthy();if(r.doubleStack){expect(r.doubleStack.stopCount).toBe(1);expect(r.doubleStack.queueCount).toBe(1);}
});
