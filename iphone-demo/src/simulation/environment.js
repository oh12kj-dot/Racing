const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;

export const TYRE_COMPOUND=Object.freeze({SLICK:'SLICK',WET:'WET'});
export const SURFACE_SECTORS=48;

export function tyreWeatherGrip(compound,wetness){
  const w=clamp(wetness??0,0,1);
  if(compound===TYRE_COMPOUND.WET)return clamp(.90+.075*w,.90,.975);
  return clamp(1-.40*Math.pow(w,1.08),.60,1);
}

export function tyreIdealTemperature(compound,wetness){
  const w=clamp(wetness??0,0,1);
  return compound===TYRE_COMPOUND.WET?72-4*w:92-7*w;
}

function ensureSurface(environment){
  const base=clamp(environment.wetness??0,0,1);
  if(!Array.isArray(environment.surfaceLine)||environment.surfaceLine.length!==SURFACE_SECTORS){
    environment.surfaceLine=Array(SURFACE_SECTORS).fill(base);
  }
  if(!Array.isArray(environment.surfaceOffLine)||environment.surfaceOffLine.length!==SURFACE_SECTORS){
    environment.surfaceOffLine=Array(SURFACE_SECTORS).fill(base);
  }
  environment.racingLineWetness=mean(environment.surfaceLine);
  environment.offLineWetness=mean(environment.surfaceOffLine);
}

function evolveWetness(wetness,environment,dt,dryingScale=1){
  const rainGain=environment.rainRate*.010*(1-wetness);
  const drying=environment.rainRate<.05
    ?environment.dryingRate*.0015*(.35+wetness)*dryingScale
    :environment.dryingRate*.00025*wetness*dryingScale;
  return clamp(wetness+(rainGain-drying)*dt,0,1);
}

function sectorPosition(environment,track,s){
  const total=Math.max(1,track?.total??1);
  const wrapped=track?.wrapS?track.wrapS(s):((s%total)+total)%total;
  const position=wrapped/total*SURFACE_SECTORS;
  const index=Math.floor(position)%SURFACE_SECTORS;
  return{index,next:(index+1)%SURFACE_SECTORS,t:position-Math.floor(position)};
}

export function surfaceConditionAt(environment,track,s,lane=0){
  if(!environment)return{wetness:0,standingWater:0,lineWetness:0,offLineWetness:0,offLineBlend:0};
  ensureSurface(environment);
  const p=sectorPosition(environment,track,s);
  const interpolate=values=>values[p.index]+(values[p.next]-values[p.index])*p.t;
  const lineWetness=clamp(interpolate(environment.surfaceLine),0,1);
  const offLineWetness=clamp(interpolate(environment.surfaceOffLine),0,1);
  const ideal=track?.idealLane?track.idealLane(s):0;
  const offLineBlend=clamp(Math.abs((lane??ideal)-ideal)/3.2,0,1);
  const wetness=clamp(lineWetness+(offLineWetness-lineWetness)*offLineBlend,0,1);
  // Deep water first becomes significant away from the repeatedly displaced
  // racing line. It remains a grip input; it never writes vehicle speed.
  const depth=clamp((wetness-.68)/.32,0,1);
  const standingWater=depth*(.45+.55*offLineBlend);
  return{wetness,standingWater,lineWetness,offLineWetness,offLineBlend};
}

export function createEnvironment(config={}){
  const wetness=clamp(config.initialWetness??0,0,1);
  const rainRate=clamp(config.rainRate??0,0,1);
  const environment={
    wetness,
    rainRate,
    dryingRate:clamp(config.dryingRate??1,0,3),
    ambientTemp:clamp(config.ambientTemp??24,-5,45),
    visibility:clamp(1-rainRate*.45-wetness*.18,.35,1),
    elapsed:0,
    surfaceLine:Array(SURFACE_SECTORS).fill(wetness),
    surfaceOffLine:Array(SURFACE_SECTORS).fill(wetness),
    racingLineWetness:wetness,
    offLineWetness:wetness
  };
  return environment;
}

export function stepEnvironment(environment,dt,cars=null,track=null){
  environment.elapsed+=dt;
  environment.wetness=evolveWetness(environment.wetness,environment,dt,1);
  ensureSurface(environment);

  for(let i=0;i<SURFACE_SECTORS;i++){
    // Exposed off-line asphalt sheds water slightly less efficiently than the
    // repeatedly swept racing line even before traffic displacement is applied.
    environment.surfaceLine[i]=evolveWetness(environment.surfaceLine[i],environment,dt,1.04);
    environment.surfaceOffLine[i]=evolveWetness(environment.surfaceOffLine[i],environment,dt,.88);
  }

  if(track&&Array.isArray(cars)){
    for(const car of cars){
      if(car.retired||car.finished||car.pit?.phase!=='TRACK'||car.v<6)continue;
      const p=sectorPosition(environment,track,car.s);
      const ideal=track.idealLane(car.s);
      const offLineBlend=clamp(Math.abs(car.lane-ideal)/3.2,0,1);
      const trafficDry=.0016*(.35+clamp(car.v/70,0,1.25))*dt;
      environment.surfaceLine[p.index]=clamp(environment.surfaceLine[p.index]-trafficDry*(1-offLineBlend),0,1);
      environment.surfaceOffLine[p.index]=clamp(environment.surfaceOffLine[p.index]-trafficDry*offLineBlend*.55,0,1);
    }
  }

  environment.racingLineWetness=mean(environment.surfaceLine);
  environment.offLineWetness=mean(environment.surfaceOffLine);
  environment.visibility=clamp(1-environment.rainRate*.45-environment.wetness*.18,.35,1);
  return environment;
}

export function environmentSnapshot(environment){
  ensureSurface(environment);
  const wetness=clamp(environment.wetness,0,1);
  const racingLineWetness=clamp(environment.racingLineWetness,0,1);
  const offLineWetness=clamp(environment.offLineWetness,0,1);
  const maxWetness=Math.max(...environment.surfaceOffLine,...environment.surfaceLine);
  const standingWater=clamp((maxWetness-.68)/.32,0,1);
  return Object.freeze({
    wetness,
    racingLineWetness,
    offLineWetness,
    standingWater,
    rainRate:clamp(environment.rainRate,0,1),
    dryingRate:environment.dryingRate,
    ambientTemp:environment.ambientTemp,
    visibility:environment.visibility,
    condition:wetness<.08?'DRY':wetness<.38?'DAMP':'WET'
  });
}
