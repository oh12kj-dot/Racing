import {test,expect} from '@playwright/test';
import {createTrack} from '../src/simulation/track.js';
import {buildEntrants} from '../src/config.js';

function orient(a,b,c){return (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);}
function intersects(a,b,c,d){
  const ab1=orient(a,b,c),ab2=orient(a,b,d),cd1=orient(c,d,a),cd2=orient(c,d,b);
  return ab1*ab2<0&&cd1*cd2<0;
}

test('TRK-01: track/world roundtrip remains accurate across the full driving corridor',()=>{
  const track=createTrack();
  const laterals=[-6,-3,0,3,6];
  let maxDs=0,maxDl=0,maxWorldError=0;
  for(let i=0;i<128;i++){
    const s=track.total*(i+.37)/128;
    for(const lateral of laterals){
      const p=track.sample(s,lateral);
      const back=track.worldToTrack(p.x,p.z);
      const reconstructed=track.sample(back.s,back.lateral);
      const ds=Math.abs(track.signedDistance(s,back.s));
      const dl=Math.abs(lateral-back.lateral);
      const worldError=Math.hypot(p.x-reconstructed.x,p.z-reconstructed.z);
      maxDs=Math.max(maxDs,ds);maxDl=Math.max(maxDl,dl);maxWorldError=Math.max(maxWorldError,worldError);
    }
  }
  expect(maxDs).toBeLessThan(.15);
  expect(maxDl).toBeLessThan(.08);
  expect(maxWorldError).toBeLessThan(.05);
});

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

test('TRK-05: visual asphalt edges follow the physical corridor and grass stays below the road surface',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_WORLD__&&!!window.__RACING_RACE__);
  const result=await page.evaluate(()=>{
    window.__RACING_LIFECYCLE__.pauseForTest();
    const world=window.__RACING_WORLD__,track=window.__RACING_RACE__.track;
    const grass=world.scene.children.find(o=>o.isMesh&&o.material?.color?.getHex?.()===0x496b3f);
    const road=world.scene.children.find(o=>o.isMesh&&o.material?.color?.getHex?.()===0x25282c);
    if(!grass||!road)return{missing:true};
    const pos=road.geometry.getAttribute('position');
    let maxEdgeError=0,minRoadY=Infinity,maxRoadY=-Infinity;
    for(let i=0;i<pos.count;i++){
      const y=pos.getY(i);minRoadY=Math.min(minRoadY,y);maxRoadY=Math.max(maxRoadY,y);
      if(i%60!==0&&i%60!==1)continue;
      const back=track.worldToTrack(pos.getX(i),pos.getZ(i));
      const halfWidth=track.sample(back.s).halfWidth;
      maxEdgeError=Math.max(maxEdgeError,Math.abs(Math.abs(back.lateral)-halfWidth));
    }
    return{missing:false,maxEdgeError,minRoadY,maxRoadY,grassY:grass.position.y};
  });
  expect(result.missing).toBeFalsy();
  expect(result.maxEdgeError).toBeLessThan(.12);
  expect(result.minRoadY-result.grassY).toBeGreaterThan(.04);
  expect(result.maxRoadY-result.minRoadY).toBeLessThan(1e-7);
});

test('VIS-01: rendered tyres contact the asphalt instead of floating above it',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__RACING_WORLD__&&!!window.__RACING_RACE__);
  const result=await page.evaluate(()=>{
    window.__RACING_LIFECYCLE__.pauseForTest();
    const world=window.__RACING_WORLD__,snap=window.__RACING_RACE__.snapshot();
    world.update(snap);
    let maxContactError=0,minBodyBottom=Infinity,wheelCount=0;
    for(const group of world.carGroups.values()){
      for(const child of group.children){
        if(child.geometry?.type==='CylinderGeometry'){
          wheelCount++;
          const r=child.geometry.parameters?.radiusTop??world.worldGeometry.wheelRadius;
          const bottom=group.position.y+child.position.y-r;
          maxContactError=Math.max(maxContactError,Math.abs(bottom-world.worldGeometry.roadY));
        }else if(child.geometry?.type==='BoxGeometry'){
          const h=child.geometry.parameters?.height??0;
          minBodyBottom=Math.min(minBodyBottom,group.position.y+child.position.y-h*.5*child.scale.y);
        }
      }
    }
    return{maxContactError,minBodyBottom,wheelCount,roadY:world.worldGeometry.roadY,carBaseY:world.worldGeometry.carBaseY};
  });
  expect(result.wheelCount).toBe(24*4);
  expect(result.maxContactError).toBeLessThan(1e-6);
  expect(result.minBodyBottom).toBeGreaterThan(result.roadY+.05);
  expect(result.carBaseY).toBeCloseTo(.04,8);
});
