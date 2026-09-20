const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const TYRE_COMPOUND=Object.freeze({SLICK:'SLICK',WET:'WET'});

export function tyreWeatherGrip(compound,wetness){
  const w=clamp(wetness??0,0,1);
  if(compound===TYRE_COMPOUND.WET)return clamp(.90+.075*w,.90,.975);
  return clamp(1-.40*Math.pow(w,1.08),.60,1);
}

export function tyreIdealTemperature(compound,wetness){
  const w=clamp(wetness??0,0,1);
  return compound===TYRE_COMPOUND.WET?72-4*w:92-7*w;
}

export function createEnvironment(config={}){
  const wetness=clamp(config.initialWetness??0,0,1);
  const rainRate=clamp(config.rainRate??0,0,1);
  return{
    wetness,
    rainRate,
    dryingRate:clamp(config.dryingRate??1,0,3),
    ambientTemp:clamp(config.ambientTemp??24,-5,45),
    visibility:clamp(1-rainRate*.45-wetness*.18,.35,1),
    elapsed:0
  };
}

export function stepEnvironment(environment,dt){
  environment.elapsed+=dt;
  const rainGain=environment.rainRate*.010*(1-environment.wetness);
  const drying=environment.rainRate<.05?environment.dryingRate*.0015*(.35+environment.wetness):environment.dryingRate*.00025*environment.wetness;
  environment.wetness=clamp(environment.wetness+(rainGain-drying)*dt,0,1);
  environment.visibility=clamp(1-environment.rainRate*.45-environment.wetness*.18,.35,1);
  return environment;
}

export function environmentSnapshot(environment){
  const wetness=clamp(environment.wetness,0,1);
  return Object.freeze({
    wetness,
    rainRate:clamp(environment.rainRate,0,1),
    dryingRate:environment.dryingRate,
    ambientTemp:environment.ambientTemp,
    visibility:environment.visibility,
    condition:wetness<.08?'DRY':wetness<.38?'DAMP':'WET'
  });
}
