import {createRace as createLegacyRace} from '../v42-race.js';
import {LOG_POLICY,SUZUKA_PIT} from './config.js';

export function createRace(W,statusEl,settings={}){
  const R=createLegacyRace(W,statusEl,settings),baseUpdate=R.update;
  const generation={id:`run-${Date.now().toString(36)}`,startedAt:Date.now(),persistent:true,maxGenerations:LOG_POLICY.persistedGenerations};
  const prevPit=[];
  function poseTrack(c){const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);}
  function update(dt){
    for(const c of R.cars){
      prevPit[c.id]=c.pitState;
      if(c.pitState==='ENTRY'&&!W.inPitWindow?.(c.s))c.laneTarget=Math.max(c.laneTarget||0,Math.min(SUZUKA_PIT.mergeTrackOffset-.25,3.8));
    }
    baseUpdate(dt);
    for(const c of R.cars){
      if(prevPit[c.id]==='EXIT'&&c.pitState==='NONE'&&!c.retired){
        c.lane=Math.min(SUZUKA_PIT.mergeTrackOffset,4.05);c.laneTarget=c.lane;c.pitLaneStatus='MERGE';poseTrack(c);
      }
    }
  }
  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='logGeneration')return generation;
    return Reflect.get(target,prop,target);
  }});
}
