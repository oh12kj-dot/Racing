import {buildWorld as buildWorldSimulation} from './world-simulation.js';
import {SUZUKA_PIT} from './config.js';

export function buildWorld(THREE,TRACK,settings={},circuitName='SUZUKA'){
  const W=buildWorldSimulation(THREE,TRACK,settings,circuitName);
  if(!/suzuka/i.test(String(circuitName||'')))return W;

  const total=W.total,entry=SUZUKA_PIT.entryUF,full=SUZUKA_PIT.fullUF,exitBegin=SUZUKA_PIT.exitBeginUF,exitEnd=SUZUKA_PIT.exitEndUF;
  const lane=Number(W.pitLaneOffset)||13.6,box=Number(W.pitBoxOffset)||18.1,limit=Number(W.pitSpeedLimit)||22.22;
  const mod1=x=>((x%1)+1)%1,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>t*t*(3-2*t);
  const phaseForS=s=>{const f=mod1((Number(s)||0)/total);return(f<entry?f+1:f)-entry;};
  const fullP=full-entry,exitBeginP=exitBegin-entry,exitEndP=exitEnd-entry;

  function pitOffsetAtS(s){
    const p=phaseForS(s);
    if(p<0||p>exitEndP)return 0;
    if(p<fullP)return lane*smooth(clamp(p/Math.max(.0001,fullP),0,1));
    if(p<=exitBeginP)return lane;
    return lane*(1-smooth(clamp((p-exitBeginP)/Math.max(.0001,exitEndP-exitBeginP),0,1)));
  }
  function inPitWindow(s){const p=phaseForS(s);return p>=0&&p<=exitEndP;}
  function inPitSpeedZone(s){const p=phaseForS(s);return p>=fullP&&p<=exitBeginP;}
  function pitPose(s,teamId=0,state='ENTRY'){
    if(state==='STOP'){
      const bs=W.pitBoxS?.(teamId)??total*mod1(.0035+clamp(Number(teamId)||0,0,9)*.0052),q=W.sample(bs,box);
      return{p:q.p,t:q.t,side:q.side,rotationY:Math.atan2(q.t.x,q.t.z),s:bs,offset:box};
    }
    const off=pitOffsetAtS(s),q=W.sample(s,off);
    return{p:q.p,t:q.t,side:q.side,rotationY:Math.atan2(q.t.x,q.t.z),s,offset:off};
  }

  W.pitLaneOffset=lane;W.pitBoxOffset=box;W.pitSpeedLimit=limit;
  W.pitEntryFraction=mod1(entry);W.pitExitFraction=mod1(exitEnd);
  W.pitUnwrappedFraction=s=>{const f=mod1((Number(s)||0)/total);return f<entry?f+1:f;};
  W.pitOffsetAtS=pitOffsetAtS;W.inPitWindow=inPitWindow;W.inPitSpeedZone=inPitSpeedZone;W.pitPose=pitPose;
  W.realisticPitLayout={owner:'runtime-pit-realism-v1',entryUF:entry,fullUF:full,exitBeginUF:exitBegin,exitEndUF:exitEnd,totalMeters:(exitEnd-entry)*total,speedZoneMeters:(exitBegin-full)*total,mergeAfterLineMeters:(exitEnd-1)*total};
  return W;
}
