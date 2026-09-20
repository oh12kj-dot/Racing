function passed(prev,current,mark,total){
  prev=((prev%total)+total)%total;current=((current%total)+total)%total;
  if(prev<=current)return prev<mark&&current>=mark;
  return mark>prev||mark<=current;
}

export function createTiming(){
  return{
    lapStart:null,
    sectorStamp:null,
    sectorIndex:0,
    currentSectors:[],
    lastLap:null,
    bestLap:null,
    laps:[],
    sectors:[]
  };
}

export function updateTiming(car,track,time){
  const t=car.timing;
  if(car.lap<0)return;
  if(t.lapStart==null){
    t.lapStart=time;t.sectorStamp=time;t.sectorIndex=0;t.currentSectors=[];
  }
  const marks=track.sectors;
  for(let i=0;i<2;i++){
    if(i===t.sectorIndex&&passed(car.lastS,car.s,marks[i],track.total)){
      const split=time-t.sectorStamp;
      t.currentSectors.push(split);t.sectors.push({lap:car.lap,sector:i+1,time:split});
      t.sectorStamp=time;t.sectorIndex++;
    }
  }
  if(passed(car.lastS,car.s,0,track.total)&&car.lap>0){
    const lapTime=time-t.lapStart;
    if(lapTime>5){
      const first=t.currentSectors[0]||0,second=t.currentSectors[1]||0;
      const third=Math.max(0,lapTime-first-second);
      t.currentSectors=[first,second,third];
      t.sectors.push({lap:car.lap-1,sector:3,time:third});
      t.lastLap=lapTime;t.bestLap=t.bestLap==null?lapTime:Math.min(t.bestLap,lapTime);
      t.laps.push({lap:car.lap-1,time:lapTime,sectors:[first,second,third]});
      if(t.laps.length>12)t.laps.shift();
    }
    t.lapStart=time;t.sectorStamp=time;t.sectorIndex=0;t.currentSectors=[];
  }
}
