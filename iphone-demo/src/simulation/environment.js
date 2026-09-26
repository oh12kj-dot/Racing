const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;

export const TYRE_COMPOUND=Object.freeze({SLICK:'SLICK',INTERMEDIATE:'INTERMEDIATE',WET:'WET'});
export const SURFACE_SECTORS=48;
export const DEFAULT_FORECAST_HORIZON_SECONDS=120;

export function tyreWeatherGrip(compound,wetness){
  const w=clamp(wetness??0,0,1);
  if(compound===TYRE_COMPOUND.WET)return clamp(.90+.075*w,.90,.975);
  if(compound===TYRE_COMPOUND.INTERMEDIATE){
    if(w<=.35)return .94+.05*(w/.35);
    if(w<=.65)return .99-.03*((w-.35)/.30);
    return clamp(.96-.10*((w-.65)/.35),.86,.96);
  }
  return clamp(1-.40*Math.pow(w,1.08),.60,1);
}

export function tyreIdealTemperature(compound,wetness){
  const w=clamp(wetness??0,0,1);
  if(compound===TYRE_COMPOUND.WET)return 72-4*w;
  if(compound===TYRE_COMPOUND.INTERMEDIATE)return 82-6*w;
  return 92-7*w;
}

function normalizeRainTimeline(config,initialRainRate){
  const raw=Array.isArray(config.rainTimeline)?config.rainTimeline:[];
  const points=[{time:0,rainRate:initialRainRate,order:-1}];
  raw.forEach((point,index)=>{
    const time=Number(point?.time);
    const rainRate=Number(point?.rainRate);
    if(!Number.isFinite(time)||time<0||!Number.isFinite(rainRate))return;
    points.push({time,rainRate:clamp(rainRate,0,1),order:index});
  });
  points.sort((a,b)=>a.time-b.time||a.order-b.order);
  const merged=[];
  for(const point of points){
    const normalized={time:point.time,rainRate:point.rainRate};
    if(merged.length&&Math.abs(merged[merged.length-1].time-point.time)<1e-9)merged[merged.length-1]=normalized;
    else merged.push(normalized);
  }
  return merged;
}

export function rainRateAt(environment,time){
  const timeline=environment?.rainTimeline;
  if(!Array.isArray(timeline)||timeline.length===0)return clamp(environment?.rainRate??0,0,1);
  const t=Math.max(0,Number.isFinite(time)?time:0);
  if(t<=timeline[0].time)return timeline[0].rainRate;
  for(let i=1;i<timeline.length;i++){
    const next=timeline[i];
    if(t>next.time)continue;
    const prev=timeline[i-1];
    const span=Math.max(1e-9,next.time-prev.time);
    const u=clamp((t-prev.time)/span,0,1);
    return prev.rainRate+(next.rainRate-prev.rainRate)*u;
  }
  return timeline[timeline.length-1].rainRate;
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

function evolveWetness(wetness,environment,dt,dryingScale=1,rainRate=environment.rainRate){
  const rain=clamp(rainRate??0,0,1);
  const rainGain=rain*.010*(1-wetness);
  const drying=rain<.05
    ?environment.dryingRate*.0015*(.35+wetness)*dryingScale
    :environment.dryingRate*.00025*wetness*dryingScale;
  return clamp(wetness+(rainGain-drying)*dt,0,1);
}

function projectWetness(environment,startWetness,horizon,dryingScale=1){
  let wetness=clamp(startWetness??0,0,1);
  let elapsed=0;
  const total=Math.max(0,horizon||0);
  while(elapsed<total-1e-9){
    const dt=Math.min(5,total-elapsed);
    const sampleTime=environment.elapsed+elapsed+dt*.5;
    wetness=evolveWetness(wetness,environment,dt,dryingScale,rainRateAt(environment,sampleTime));
    elapsed+=dt;
  }
  return wetness;
}

function refreshForecast(environment){
  ensureSurface(environment);
  const horizon=clamp(environment.forecastHorizonSeconds??DEFAULT_FORECAST_HORIZON_SECONDS,10,600);
  environment.forecastHorizonSeconds=horizon;
  environment.forecastRainRate=rainRateAt(environment,environment.elapsed+horizon);
  environment.forecastRacingLineWetness=projectWetness(environment,environment.racingLineWetness,horizon,1.04);
  const delta=environment.forecastRacingLineWetness-environment.racingLineWetness;
  environment.forecastTrend=delta>.06?'WETTER':delta<-.06?'DRIER':'STEADY';
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
  const initialRainRate=clamp(config.rainRate??0,0,1);
  const rainTimeline=normalizeRainTimeline(config,initialRainRate);
  const environment={
    wetness,
    rainRate:rainTimeline[0]?.rainRate??initialRainRate,
    rainTimeline,
    rainTimelineKey:rainTimeline.map(point=>`${point.time.toFixed(3)}:${point.rainRate.toFixed(4)}`).join('|'),
    forecastHorizonSeconds:clamp(config.forecastHorizonSeconds??DEFAULT_FORECAST_HORIZON_SECONDS,10,600),
    forecastRainRate:initialRainRate,
    forecastRacingLineWetness:wetness,
    forecastTrend:'STEADY',
    dryingRate:clamp(config.dryingRate??1,0,3),
    ambientTemp:clamp(config.ambientTemp??24,-5,45),
    visibility:clamp(1-initialRainRate*.45-wetness*.18,.35,1),
    elapsed:0,
    surfaceLine:Array(SURFACE_SECTORS).fill(wetness),
    surfaceOffLine:Array(SURFACE_SECTORS).fill(wetness),
    racingLineWetness:wetness,
    offLineWetness:wetness
  };
  refreshForecast(environment);
  return environment;
}

export function stepEnvironment(environment,dt,cars=null,track=null){
  environment.elapsed+=dt;
  environment.rainRate=rainRateAt(environment,environment.elapsed);
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
  refreshForecast(environment);
  return environment;
}

export function environmentSnapshot(environment){
  ensureSurface(environment);
  refreshForecast(environment);
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
    forecastHorizonSeconds:environment.forecastHorizonSeconds,
    forecastRainRate:clamp(environment.forecastRainRate,0,1),
    forecastRacingLineWetness:clamp(environment.forecastRacingLineWetness,0,1),
    forecastTrend:environment.forecastTrend,
    dryingRate:environment.dryingRate,
    ambientTemp:environment.ambientTemp,
    visibility:environment.visibility,
    condition:wetness<.08?'DRY':wetness<.38?'DAMP':'WET'
  });
}