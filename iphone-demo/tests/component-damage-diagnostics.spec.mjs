import {test} from '@playwright/test';
import {createRaceSimulation} from '../src/simulation/race.js';
import {FIXED_DT} from '../src/config.js';

const zeroAll=car=>{
  const d=car.incident?.componentDamage;
  if(!d)return;
  d.aero=0;d.powertrain=0;d.steering=0;d.brakes=0;
};

function runVariant(name,neutralize){
  const sim=createRaceSimulation(0x1111,{raceLaps:40});
  const firstDamage=new Set();
  const priorRecoveries=new Map(sim.cars.map(c=>[c.id,0]));
  const steps=Math.round(100/FIXED_DT);
  for(let i=0;i<steps;i++){
    sim.update(FIXED_DT);
    const time=(i+1)*FIXED_DT;
    for(const car of sim.cars){
      const d=car.incident?.componentDamage||{};
      const total=(d.aero||0)+(d.powertrain||0)+(d.steering||0)+(d.brakes||0);
      if(name==='normal'&&total>1e-9&&!firstDamage.has(car.id)){
        firstDamage.add(car.id);
        console.log('DAMAGE_DIAG_FIRST',JSON.stringify({time:+time.toFixed(3),id:car.id,name:car.name,damage:+(car.incident.damage||0).toFixed(6),componentDamage:d,v:+car.v.toFixed(3),lane:+car.lane.toFixed(3),steer:+car.steer.toFixed(4),brake:+car.brake.toFixed(3),spin:+(car.incident.spinTimer||0).toFixed(3)}));
      }
      const prior=priorRecoveries.get(car.id)||0;
      if(name==='normal'&&car.diagnostics.recoveries>prior){
        console.log('DAMAGE_DIAG_RECOVERY',JSON.stringify({time:+time.toFixed(3),id:car.id,name:car.name,recoveries:car.diagnostics.recoveries,damage:+(car.incident.damage||0).toFixed(6),componentDamage:d,v:+car.v.toFixed(3),lane:+car.lane.toFixed(3),laneV:+car.laneV.toFixed(3),steer:+car.steer.toFixed(4),brake:+car.brake.toFixed(3),yaw:+car.yaw.toFixed(4),yawRate:+car.yawRate.toFixed(4),spin:+(car.incident.spinTimer||0).toFixed(3),racecraft:car.racecraft?.state,pit:car.pit?.phase}));
      }
      priorRecoveries.set(car.id,car.diagnostics.recoveries);
    }
    neutralize?.(sim.cars);
  }
  const snap=sim.snapshot();
  console.log('DAMAGE_DIAG_VARIANT',JSON.stringify({name,recoveries:snap.diagnostics.recoveries,contacts:snap.diagnostics.contacts,barrierContacts:snap.diagnostics.barrierContacts}));
}

test('DIAG component damage channel isolation for fixed seed 0x1111',()=>{
  runVariant('normal');
  runVariant('no-steering',cars=>cars.forEach(c=>{if(c.incident?.componentDamage)c.incident.componentDamage.steering=0;}));
  runVariant('no-brakes',cars=>cars.forEach(c=>{if(c.incident?.componentDamage)c.incident.componentDamage.brakes=0;}));
  runVariant('no-steering-brakes',cars=>cars.forEach(c=>{if(c.incident?.componentDamage){c.incident.componentDamage.steering=0;c.incident.componentDamage.brakes=0;}}));
  runVariant('no-detailed',cars=>cars.forEach(zeroAll));
});
