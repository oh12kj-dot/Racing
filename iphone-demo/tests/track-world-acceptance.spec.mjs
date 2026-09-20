import {test,expect} from '@playwright/test';
import {createTrack} from '../src/simulation/track.js';
import {buildEntrants} from '../src/config.js';

function orient(a,b,c){return (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);}
function intersects(a,b,c,d){
  const ab1=orient(a,b,c),ab2=orient(a,b,d),cd1=orient(c,d,a),cd2=orient(c,d,b);
  return ab1*ab2<0&&cd1*cd2<0;
}

test('TRK-02/03: centerline has no accidental self-intersection and usable width stays valid',()=>{
  const track=createTrack(),count=320;
  const pts=Array.from({length:count},(_,i)=>track.sample(track.total*i/count));
  for(let i=0;i<count;i++){
    const a=pts[i],b=pts[(i+1)%count];
    for(let j=i+1;j<count;j++){
      if(j===i||j===(i+1)%count||(j+1)%count===i)continue;
      if(i===0&&j===count-1)continue;
      expect(intersects(a,b,pts[j],pts[(j+1)%count]),`segments ${i} and ${j} intersect`).toBeFalsy();
    }
  }
  const widest=Math.max(...buildEntrants().map(e=>e.spec.width));
  for(let i=0;i<160;i++){
    const s=track.total*i/160,q=track.sample(s),ideal=track.idealLane(s);
    expect(q.halfWidth*2).toBeGreaterThan(widest*2+2.5);
    expect(Math.abs(ideal)+widest*.5).toBeLessThan(q.halfWidth-.25);
  }
});

test('TRK-04/06: every logical team box has one aligned garage outside driveable corridors',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_WORLD__&&!!window.__RACING_RACE__);
  const result=await page.evaluate(()=>{
    window.__RACING_LIFECYCLE__.pauseForTest();
    const sim=window.__RACING_RACE__,world=window.__RACING_WORLD__,track=sim.track,pit=track.pit;
    const teams=[...new Set(sim.cars.map(c=>c.teamId))].sort((a,b)=>a-b);
    const garages=[...world.garages.values()].map(g=>{
      const back=track.worldToTrack(g.mesh.position.x,g.mesh.position.z);
      const pitClearance=Math.abs(g.lateral-world.worldGeometry.pitRoadCenter)-g.width*.5-world.worldGeometry.pitRoadWidth*.5;
      const mainClearance=Math.abs(g.lateral)-g.width*.5-track.sample(g.s).halfWidth;
      return{teamId:g.teamId,s:g.s,backS:back.s,backLateral:back.lateral,lateral:g.lateral,pitClearance,mainClearance};
    });
    return{teams,garages,boxStart:pit.boxStart,boxSpacing:pit.boxSpacing,exitStart:pit.exitStart,total:track.total};
  });
  expect(result.garages.length).toBe(result.teams.length);
  expect(result.garages.map(g=>g.teamId)).toEqual(result.teams);
  for(const g of result.garages){
    const expected=result.boxStart+g.teamId*result.boxSpacing;
    const ds=Math.min(Math.abs(g.backS-expected),result.total-Math.abs(g.backS-expected));
    expect(Math.abs(g.s-expected)).toBeLessThan(1e-6);
    expect(ds).toBeLessThan(.45);
    expect(Math.abs(g.backLateral-g.lateral)).toBeLessThan(.2);
    expect(g.pitClearance).toBeGreaterThanOrEqual(0);
    expect(g.mainClearance).toBeGreaterThan(0);
    expect(g.s).toBeLessThan(result.exitStart);
  }
});
