const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const PROFILE={
  formula:{fuel:110,burn:.34,wear:.0105},
  hyper:{fuel:90,burn:.48,wear:.0090},
  lmh:{fuel:90,burn:.47,wear:.0090},
  proto:{fuel:75,burn:.42,wear:.0095},
  gt:{fuel:115,burn:.50,wear:.0078},
  supercar:{fuel:105,burn:.53,wear:.0085},
  touring:{fuel:100,burn:.45,wear:.0074}
};

export function createSystems(type){
  const p=PROFILE[type]||PROFILE.gt;
  return{
    fuelCapacity:p.fuel,
    fuel:p.fuel*.64,
    burnPerKm:p.burn,
    tyreWear:0,
    tyreTemp:82,
    brakeTemp:310,
    engineTemp:88,
    grip:1,
    fuelUsed:0,
    serviceCount:0
  };
}

export function gripFactor(car){
  const s=car.systems;
  const tempPenalty=Math.abs(s.tyreTemp-92)/125;
  const wearPenalty=Math.max(0,s.tyreWear-.18)*.24;
  const damagePenalty=(car.incident?.damage||0)*.10;
  return clamp(1.015-tempPenalty-wearPenalty-damagePenalty,.76,1.02);
}

export function stepSystems(car,dt){
  const s=car.systems;
  const km=car.v*dt/1000;
  const fuelUse=km*s.burnPerKm*(.72+.45*car.throttle);
  s.fuel=Math.max(0,s.fuel-fuelUse);
  s.fuelUsed+=fuelUse;

  const latLoad=Math.min(1.5,Math.abs(car.laneA)/(Math.max(1,car.spec.laneChangeG*9.81)));
  const slip=Math.min(2,Math.abs(car.laneV)/3.6);
  s.tyreWear=clamp(s.tyreWear+km*(PROFILE[car.type]?.wear||.009)*(1+latLoad*.8+slip*.25),0,1);
  const tyreTarget=76+car.v*.19+latLoad*17+Math.abs(car.brake)*8;
  s.tyreTemp+=clamp(tyreTarget-s.tyreTemp,-18,18)*dt*.18;
  const brakeTarget=170+car.brake*720+car.v*1.8;
  s.brakeTemp+=clamp(brakeTarget-s.brakeTemp,-260,260)*dt*.28;
  const engineTarget=84+car.throttle*23+Math.max(0,car.v-60)*.08;
  s.engineTemp+=clamp(engineTarget-s.engineTemp,-12,12)*dt*.08;
  s.grip=gripFactor(car);
}

export function needsPit(car){
  const s=car.systems;
  return s.tyreWear>.58||s.fuel<Math.max(8,s.fuelCapacity*.12)||s.engineTemp>112;
}

export function serviceSystems(car){
  const s=car.systems;
  s.fuel=Math.min(s.fuelCapacity,Math.max(s.fuel,s.fuelCapacity*.82));
  s.tyreWear=0;
  s.tyreTemp=80;
  s.brakeTemp=Math.min(s.brakeTemp,260);
  s.engineTemp=Math.min(s.engineTemp,94);
  s.grip=1;
  s.serviceCount++;
  if(car.incident)car.incident.damage=Math.max(0,car.incident.damage-.32);
}
