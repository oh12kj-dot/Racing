import {createRace as createV11Race} from './v11-race.js';

export function createRace(W,statusEl,settings={}){
  const base=createV11Race(W,statusEl,settings),originalUpdate=base.update;
  const serviceTime={formula:2.6,proto:3.1,hyper:3.3,lmh:3.2,gt:4.1,supercar:4.3,touring:4.7};
  function update(dt){
    const before=base.cars.map(c=>({state:c.pitState,timer:c.pitTimer}));
    originalUpdate(dt);
    const detailed=[];
    for(let i=0;i<base.cars.length;i++){
      const c=base.cars[i],b=before[i];if(c.retired)continue;
      if(b.state!=='STOP'&&c.pitState==='STOP'){
        const min=serviceTime[c.type]||3.5;
        if((c.pitTimer||0)<min)c.pitTimer=min;
        c._pitStopInitial=Math.max(min,c.pitTimer||min);
      }
      if(c.pitState==='STOP'){
        const initial=Math.max(.1,c._pitStopInitial||c.pitTimer||3),left=Math.max(0,c.pitTimer||0),p=Math.max(0,Math.min(1,1-left/initial));
        const phase=p<.12?'CREW OUT':p<.24?'JACKS':p<.38?'WHEEL GUNS':p<.60?'WHEELS OFF':p<.74?'NEW TYRES':p<.86?'TORQUE':p<.94?'DROP CAR':'RELEASE';
        c.pitLaneStatus=phase;detailed.push({teamId:c.teamId,carId:c.id,progress:p,phase});W.animatePitStopCar?.(c,p);
      }else if(b.state==='STOP'&&c.pitState!=='STOP')W.resetPitStopCar?.(c);
    }
    W.updateDetailedPitCrews?.(detailed,dt);
  }
  return new Proxy(base,{get(target,prop){if(prop==='update')return update;return Reflect.get(target,prop,target);}});
}
