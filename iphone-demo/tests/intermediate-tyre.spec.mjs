import {test,expect} from '@playwright/test';
import {FIXED_DT,buildEntrants} from '../src/config.js';
import {createTrack} from '../src/simulation/track.js';
import {createVehicleState} from '../src/simulation/vehicle.js';
import {TYRE_COMPOUND} from '../src/simulation/environment.js';
import {planPit} from '../src/simulation/pit.js';

test('WET-18: intermediate tyres are installed only by physical pit service',()=>{
  const entry=buildEntrants().find(e=>e.type==='gt');
  const car=createVehicleState(entry,120,2),track=createTrack();
  car.systems.tyreCompound=TYRE_COMPOUND.SLICK;
  car.pit.phase='SERVICE';
  car.pit.requested=true;
  car.pit.serviceTimer=0;
  car.pit.serviceApplied=false;
  car.pit.servicePlan={tyres:true,tyreCompound:TYRE_COMPOUND.INTERMEDIATE};
  car.v=0;

  expect(car.systems.tyreCompound).toBe(TYRE_COMPOUND.SLICK);
  planPit(car,[car],track,FIXED_DT);
  expect(car.systems.tyreCompound).toBe(TYRE_COMPOUND.INTERMEDIATE);
  expect(car.pit.serviceApplied).toBeTruthy();
});

test('WET-19: mobile telemetry abbreviates INTERMEDIATE as INT without changing authoritative compound',async({page})=>{
  await page.goto('/iphone-demo/index.html?runtimeTest=1',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {createUI}=await import('/iphone-demo/src/presentation/ui.js');
    const root=document.createElement('div');
    document.body.appendChild(root);
    const car={
      id:99,number:'99',name:'Test Car',spec:{label:'GT'},v:42,lap:1,blueFlag:false,
      racecraft:{state:'SETUP'},pit:{phase:'TRACK'},
      systems:{tyreCompound:'INTERMEDIATE',tyreWear:.12,tyreTemp:78,fuel:55,failed:false,engineTemp:96,mechanicalStress:.08,powerDerate:0}
    };
    const row={carId:99,overallPosition:1,classPosition:1,status:'RUNNING',pitStops:0,currentLap:2,currentLapTime:40,lastLap:90,bestLap:89,gapToLeaderMeters:0,intervalMeters:0,gapToLeaderSeconds:0,intervalSeconds:0};
    const snapshot={flag:'GREEN',restartPhase:'GREEN',RACE_LAPS:8,lap:2,time:120,environment:{condition:'DAMP',wetness:.32},classification:[row],order:[car],events:[]};
    createUI(root).update(snapshot,{mode:'FOLLOW',tracked:car});
    return{
      telemetry:root.querySelector('#telemetry')?.textContent||'',
      leaderboard:root.querySelector('.lb-class')?.textContent||'',
      authoritative:car.systems.tyreCompound
    };
  });
  expect(result.authoritative).toBe('INTERMEDIATE');
  expect(result.telemetry).toContain('TYRE INT');
  expect(result.leaderboard).toContain('· INT ·');
  expect(result.telemetry).not.toContain('INTERMEDIATE');
});
