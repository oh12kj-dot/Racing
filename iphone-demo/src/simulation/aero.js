const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function neutral(){return{leaderId:null,draftStrength:0,dirtyAirStrength:0,dragFactor:1,downforceFactor:1};}

export function aeroEffectFor(car,cars,track){
  if(car.retired||car.finished||car.pit?.phase!=='TRACK')return neutral();
  let best=null;
  for(const other of cars){
    if(other===car||other.retired||other.finished||other.pit?.phase!=='TRACK')continue;
    const gap=track.signedDistance(car.s,other.s);
    if(gap<=2||gap>62)continue;
    const lateral=Math.abs(car.lane-other.lane);
    const wakeWidth=Math.max(2.1,(car.width+other.width)*.72+gap*.018);
    if(lateral>wakeWidth*1.8)continue;
    const alignment=Math.exp(-1.55*(lateral/wakeWidth)**2);
    const draftWindow=clamp((62-gap)/56,0,1);
    const dirtyWindow=clamp((42-gap)/36,0,1);
    const score=draftWindow*alignment;
    if(!best||score>best.score)best={other,gap,alignment,draftWindow,dirtyWindow,score};
  }
  if(!best)return neutral();
  const draftStrength=clamp(best.draftWindow*best.alignment,0,1);
  const dirtyAirStrength=clamp(best.dirtyWindow*best.alignment,0,1);
  const draftGain=car.spec.draftGain??.06;
  const dirtyAirLoss=car.spec.dirtyAirLoss??.06;
  return{
    leaderId:best.other.id,
    draftStrength,
    dirtyAirStrength,
    dragFactor:clamp(1-draftGain*draftStrength,.82,1),
    downforceFactor:clamp(1-dirtyAirLoss*dirtyAirStrength,.72,1)
  };
}

export function buildAeroField(cars,track){
  const field=new Map();
  for(const car of cars)field.set(car.id,aeroEffectFor(car,cars,track));
  return field;
}
