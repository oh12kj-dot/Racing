import {createRace as createV6Race} from './v6-race.js';

export function createRace(W,statusEl){
  const base=createV6Race(W,statusEl);
  const {startReplay,history,replay,...race}=base;
  return race;
}
