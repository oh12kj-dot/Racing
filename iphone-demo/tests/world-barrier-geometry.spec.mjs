import {test,expect} from '@playwright/test';

async function boot(page){
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window.__RACING_WORLD__&&window.__RACING__?.sim),null,{timeout:30000});
}

test('WORLD-01: visible barriers follow the physical track boundary and leave pit crossings open',async({page})=>{
  await boot(page);
  const x=await page.evaluate(()=>{
    const world=window.__RACING_WORLD__,track=window.__RACING__.sim.track,g=world.worldGeometry;
    return{
      barrierCount:world.barriers.length,
      barriers:world.barriers.map(b=>({side:b.side,start:b.start,end:b.end,vertices:b.mesh.geometry.attributes.position.count})),
      sections:g.barrierSections,
      openings:g.barrierOpenings,
      barrierLateral:g.barrierLateral,
      halfWidth:track.sample(0).halfWidth,
      total:track.total,
      pit:{...track.pit}
    };
  });

  expect(x.barrierCount).toBe(4);
  expect(x.barrierLateral).toBeCloseTo(x.halfWidth+.10,6);
  expect(x.barriers.every(b=>b.vertices>=16)).toBeTruthy();

  const positive=x.sections.filter(s=>s.side===1);
  const negative=x.sections.filter(s=>s.side===-1);
  expect(positive).toHaveLength(1);
  expect(positive[0].start).toBeCloseTo(0,6);
  expect(positive[0].end).toBeCloseTo(x.total,6);
  expect(negative).toHaveLength(3);
  expect(x.openings).toHaveLength(2);

  const entry=x.openings.find(o=>o.kind==='pit-entry');
  const merge=x.openings.find(o=>o.kind==='pit-merge');
  expect(entry.start).toBeGreaterThan(x.pit.entryStart);
  expect(entry.end).toBeLessThan(x.pit.speedLine);
  expect(merge.start).toBeGreaterThan(x.pit.mergeStart);
  expect(merge.end).toBeLessThan(x.pit.mergeEnd);

  for(const opening of x.openings){
    const mid=(opening.start+opening.end)*.5;
    expect(opening.end-opening.start).toBeGreaterThan(20);
    expect(negative.some(s=>mid>=s.start&&mid<=s.end)).toBeFalsy();
  }
});
