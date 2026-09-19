import {buildWorld as buildV23World} from './world-pit-animation.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildV23World(THREE,TRACK,settings,circuitName);
  const baseSpawn=W.spawnRecovery?.bind(W),baseUpdate=W.updateRecoveries?.bind(W),tasks=new Map();

  W.spawnRecovery=(car,reason='INCIDENT')=>{
    if(!car)return null;
    const existing=tasks.get(car.id);
    if(existing&&!existing.done)return existing;
    baseSpawn?.(car,reason);
    const task={carId:car.id,reason,age:0,duration:16,progress:0,done:false,startedAt:performance.now()};
    tasks.set(car.id,task);
    return task;
  };

  W.updateRecoveries=(dt=.016)=>{
    baseUpdate?.(dt);
    for(const task of tasks.values()){
      if(task.done)continue;
      task.age+=Math.max(0,dt);
      task.progress=Math.min(1,task.age/task.duration);
      if(task.age>=task.duration){task.done=true;task.progress=1;}
    }
  };

  W.recoveryFor=id=>tasks.get(Number(id))||null;
  W.recoveryActive=id=>{const t=tasks.get(Number(id));return !!t&&!t.done;};
  W.activeRecoveries=()=>[...tasks.values()].filter(t=>!t.done).map(t=>({...t}));
  W.recoveryHistory=()=>[...tasks.values()].map(t=>({...t}));
  return W;
}
