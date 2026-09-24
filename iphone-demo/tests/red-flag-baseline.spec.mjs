import {test,expect} from '@playwright/test';
import {FIXED_DT} from '../src/config.js';
import {createRaceSimulation} from '../src/simulation/race.js';

const TAU=Math.PI*2;
const wrapAngle=a=>((a+Math.PI)%TAU+TAU)%TAU-Math.PI;
function signedDelta(track,a,b){
  let d=track.wrapS(b.s)-track.wrapS(a.s);
  if(d>track.total*.5)d-=track.total;
  if(d<-track.total*.5)d+=track.total;
  return d;
}

test('RED-10: normal dry race and pit cycles do not falsely escalate to red',()=>{
  const sim=createRaceSimulation(0x51afe,{raceLaps:80});
  let sawRed=false,firstRed=null,lastSeenEventId=0;
  const contactDiagnostics=[];
  for(let i=0;i<Math.round(180/FIXED_DT);i++){
    sim.update(FIXED_DT);
    const fresh=sim.events.filter(event=>event.id>lastSeenEventId);
    if(fresh.length)lastSeenEventId=Math.max(...fresh.map(event=>event.id));
    for(const event of fresh.filter(event=>event.type==='CONTACT')){
      const car=sim.cars.find(c=>c.id===event.carId);
      if(!car)continue;
      const nearest=sim.cars.filter(o=>o!==car&&!o.retired&&!o.finished&&o.pit.phase!=='SERVICE')
        .map(o=>({o,d:signedDelta(sim.track,car,o)}))
        .sort((a,b)=>Math.hypot(a.d,car.lane-a.o.lane)-Math.hypot(b.d,car.lane-b.o.lane))[0];
      contactDiagnostics.push({
        t:+event.time.toFixed(3),id:car.id,other:nearest?.o.id??null,
        ds:nearest?+nearest.d.toFixed(3):null,dLane:nearest?+(car.lane-nearest.o.lane).toFixed(3):null,
        v:+car.v.toFixed(3),otherV:nearest?+nearest.o.v.toFixed(3):null,
        target:+(car.targetSpeed??0).toFixed(3),otherTarget:nearest?+(nearest.o.targetSpeed??0).toFixed(3):null,
        state:car.racecraft?.state??null,otherState:nearest?.o.racecraft?.state??null,
        source:car.controlSource,otherSource:nearest?.o.controlSource,
        fuel:+(car.systems?.fuel??0).toFixed(3),otherFuel:nearest?+(nearest.o.systems?.fuel??0).toFixed(3):null,
        mass:+(car.mass??0).toFixed(3),otherMass:nearest?+(nearest.o.mass??0).toFixed(3):null
      });
      if(contactDiagnostics.length>14)contactDiagnostics.shift();
    }
    if(sim.raceControl.flag==='RED'){
      sawRed=true;
      if(!firstRed){
        const snap=sim.snapshot();
        firstRed={
          time:+snap.time.toFixed(3),
          incidentIds:[...sim.raceControl.incidentIds],
          cars:sim.raceControl.incidentIds.map(id=>{
            const car=sim.cars.find(c=>c.id===id);
            if(!car)return{id};
            const velocityHeading=sim.track.sample(car.s).heading+Math.atan2(car.laneV,Math.max(4,car.v));
            return{
              id:car.id,
              lap:car.lap,
              s:+car.s.toFixed(2),
              v:+car.v.toFixed(3),
              lane:+car.lane.toFixed(3),
              laneV:+car.laneV.toFixed(3),
              damage:+car.incident.damage.toFixed(3),
              spinTimer:+car.incident.spinTimer.toFixed(3),
              yawRate:+car.yawRate.toFixed(3),
              slipAngle:+(car.tyre?.slipAngle||0).toFixed(3),
              bodySlip:+Math.abs(wrapAngle(velocityHeading-car.yaw)).toFixed(3),
              source:car.controlSource
            };
          }),
          contactDiagnostics:[...contactDiagnostics],
          recentEvents:sim.events.filter(event=>event.time>snap.time-18).map(event=>({
            t:+event.time.toFixed(3),type:event.type,carId:event.carId,text:event.text
          }))
        };
      }
    }
  }
  expect(sim.snapshot().diagnostics.finite).toBeTruthy();
  expect(sawRed,firstRed?`false RED: ${JSON.stringify(firstRed)}`:'false RED').toBeFalsy();
  expect(sim.events.some(event=>event.type==='RED')).toBeFalsy();
});
