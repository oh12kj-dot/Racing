const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function signedDelta(track,a,b){
  let d=track.wrapS(b.s)-track.wrapS(a.s);
  if(d>track.total*.5)d-=track.total;
  if(d<-track.total*.5)d+=track.total;
  return d;
}

export function computeTrafficAero(car,cars,track){
  const neutral={wake:0,dragFactor:1,downforceFactor:1,sourceId:null};
  if(car.retired||car.finished||car.pit?.phase!=='TRACK')return neutral;

  let bestWake=0,sourceId=null;
  for(const other of cars){
    if(other===car||other.retired||other.finished||other.pit?.phase!=='TRACK')continue;
    const gap=signedDelta(track,car,other);
    if(gap<=3||gap>55)continue;

    const lateral=Math.abs(car.lane-other.lane);
    const alignment=clamp(1-lateral/3.8,0,1);
    if(alignment<=0)continue;

    const distance=clamp((55-gap)/48,0,1);
    const speedMatch=clamp(1-Math.abs(car.v-other.v)/45,.45,1);
    const wake=alignment*distance*speedMatch;
    if(wake>bestWake){bestWake=wake;sourceId=other.id;}
  }

  const draft=clamp((car.spec.draftGain??.10)*bestWake,0,.24);
  const dirty=clamp((car.spec.dirtyAirLoss??.06)*bestWake,0,.24);
  return{
    wake:bestWake,
    dragFactor:1-draft,
    downforceFactor:1-dirty,
    sourceId
  };
}
