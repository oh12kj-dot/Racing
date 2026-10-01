import {buildWorld as buildV5World} from './world-core.js';

export function buildWorld(THREE, TRACK){
  const W=buildV5World(THREE,TRACK);
  W.env={timeOfDay:14.2,cloud:0.18,rain:0,wetness:0,temperature:27,weather:'SUNNY'};
  W.setWetness=(value)=>{ W.env.wetness=Math.max(0,Math.min(1,value)); };
  return W;
}
