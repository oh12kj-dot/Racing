import {createRace as createV27Race} from './v27-race.js';
import {trafficFollowPolicy} from './vehicle-performance-spec.js';

export function createRace(W,statusEl,settings={}){
  const R=createV27Race(W,statusEl,settings),baseUpdate=R.update,total=Math.max(1,W.total||1),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%total)+total)%total;
  let gridNormalised=false,raceStartAt=null,parallelLaunchEscapes=0;
  const progress=c=>c?._v8Progress??((c?.lap||0)*total+(c?.s||0)),gap=(a,b)=>wrap((b?.s||0)-(a?.s||0));
  const frameRateAlpha=(per60,dt)=>{const a=clamp(Number(per60)||0,0,.999),frames=Math.max(0,Number(dt)||0)*60;return 1-Math.pow(1-a,frames);};
  function pose(c){const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);}
  function normaliseGridStart(){if(gridNormalised)return;const phase=R.sessionPhase;if(phase==='QUALIFYING'||phase==='FORMATION')return;const grid=Array.isArray(R.qualifying)&&R.qualifying.length?R.qualifying.map(x=>x.carId):R.getStandings().map(c=>c.id);grid.forEach((id,pos)=>{const c=R.cars[id];if(!c)return;const row=Math.floor(pos/2),col=pos%2,p=-row*12.4;c._v8Progress=p;c.s=wrap(p);c.lap=row===0?0:-1;c.position=pos+1;c.prevPosition=pos+1;c.v=0;c.lane=(col?-1:1)*2.55+(row%2?.14:-.14);c.laneTarget=c.lane;c.pitState='NONE';c.pitTimer=0;c.pitLaneStatus='TRACK';c._serviceExtra=false;c._repairAdded=false;c._pitFailure=null;c._v24PitFailure=null;c._doubleStackWait=0;c.lastLapStart=R.race.t;c.sectorStart=R.race.t;pose(c);});gridNormalised=true;}
  function nearestAhead(c){let car=null,dist=Infinity;for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE')continue;const d=gap(c,o);if(d>0&&d<dist){dist=d;car=o;}}return{car,dist};}
  function requestLaunchCap(c,cap){const x=Math.max(0,Number(cap)||0),old=c.launchSpeedCap;c.launchSpeedCap=old!=null&&Number.isFinite(Number(old))?Math.min(Number(old),x):x;}
  function launchParallelEscape(c,f,dist){
    const currentLat=Math.abs((c.lane||0)-(f.lane||0)),plannedLat=Math.abs((Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):(c.lane||0))-(Number.isFinite(Number(f.laneTarget))?Number(f.laneTarget):(f.lane||0))),body=((c.length||5)+(f.length||5))*.5,physicalLat=((c.width||2)+(f.width||2))*.5,safeLat=physicalLat+.08;
    const policy=trafficFollowPolicy({followerType:c.type,leaderType:f.type,gapM:dist,speedMps:c.v||0,leaderSpeedMps:f.v||0,bodyGapM:body,currentLateralM:currentLat,plannedLateralM:plannedLat,safeLateralM:safeLat,physicalLateralM:physicalLat,passIntent:false});
    c.launchTrafficPolicy={leaderId:f.id,...policy};return policy.parallelEscape===true;
  }
  function launchDiscipline(dt){
    for(const c of R.cars){c.launchSpeedCap=null;c.launchTrafficPolicy=null;}
    const phase=R.sessionPhase;if(phase==='QUALIFYING'||phase==='FORMATION'||R.flag!=='GREEN'||R.race.t<(R.race.green||0))return;if(raceStartAt===null)raceStartAt=R.race.t;const age=R.race.t-raceStartAt;if(age>14)return;
    for(const c of R.cars){if(c.retired||c.pitState!=='NONE')continue;const a=nearestAhead(c);if(!a.car)continue;const f=a.car,body=((c.length||5)+(f.length||5))*.5,lat=Math.abs((c.lane||0)-(f.lane||0)),sameChannel=lat<((c.width||2)+(f.width||2))*.62,parallelEscape=sameChannel&&launchParallelEscape(c,f,a.dist);
      if(sameChannel&&!parallelEscape&&a.dist<body+9){const clearance=Math.max(0,a.dist-body),room=clamp((clearance-3.5)/5.5,0,1),cap=f.v+.12+room*.45;requestLaunchCap(c,cap);c.overtake=Math.min(c.overtake||0,.22);c.avoid=Math.max(c.avoid||0,.8);}
      else if(parallelEscape)parallelLaunchEscapes++;
      if(a.dist<34&&!parallelEscape){const holdPer60=clamp(.30-age*.012,.14,.30),hold=frameRateAlpha(holdPer60,dt);c.laneTarget+=(c.lane-c.laneTarget)*hold;}
      for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE')continue;const longitudinal=Math.min(Math.abs((o.s||0)-(c.s||0)),total-Math.abs((o.s||0)-(c.s||0)));if(longitudinal>((c.length||5)+(o.length||5))*.55+1.2)continue;const lateral=(c.lane||0)-(o.lane||0),need=((c.width||2)+(o.width||2))*.53+.28;if(Math.abs(lateral)<need){const dir=lateral===0?(c.id%2?1:-1):Math.sign(lateral),step=frameRateAlpha(.22,dt);c.laneTarget=clamp(c.laneTarget+dir*(need-Math.abs(lateral))*step,-3.72,3.72);}}
    }
  }
  function isHazard(c){return!!c&&!c.recovered&&c.pitState==='NONE'&&(c.retired||c.spinState==='SLIDE'||c.spinState==='RECOVER'||(c.incident||0)>.15||((c.v||0)<7&&R.race.t>(R.race.green||0)+2));}
  function laneScore(me,target,hazard){let score=3.8-Math.abs(target)*.18;for(const o of R.cars){if(o===me||o===hazard||o.retired||o.pitState!=='NONE')continue;const d=gap(me,o);if(d>55)continue;const safe=((me.width||2)+(o.width||2))*.56+.45,lat=Math.abs((o.lane||0)-target);if(lat<safe)score-=7*(1-d/55);else score+=Math.min(2,lat-safe)*.18;}return score;}
  function avoidHazards(dt){if(R.sessionPhase==='QUALIFYING'||R.sessionPhase==='FORMATION')return;for(const c of R.cars){if(c.retired||c.pitState!=='NONE'||isHazard(c))continue;let h=null,d=Infinity;for(const o of R.cars){if(o===c||!isHazard(o))continue;const x=gap(c,o);if(x>0&&x<d&&x<78){d=x;h=o;}}c.hazardAvoiding=false;if(!h)continue;const clearance=((c.width||2)+(h.width||2))*.5+1.25,opts=[clamp((h.lane||0)-clearance,-3.55,3.55),clamp((h.lane||0)+clearance,-3.55,3.55)];opts.sort((a,b)=>laneScore(c,b,h)-laneScore(c,a,h));const target=opts[0],score=laneScore(c,target,h);c.hazardAvoiding=true;c.avoid=Math.max(c.avoid||0,1.8);c.overtake=Math.max(c.overtake||0,1.2);if(score>0){const urgency=clamp((65-d)/55,0,.88),blend=frameRateAlpha(.12+urgency*.28,dt);c.laneTarget+=(target-c.laneTarget)*blend;}const lateralClear=Math.abs((c.lane||0)-(h.lane||0))>clearance*.78;if(d<30&&!lateralClear){const safe=Math.max(5,(h.v||0)+Math.max(0,(d-8)*.22)),brake=(c.brakeNominal||c.brake||15),strength=d<15?.95:.70;if((c.v||0)>safe)c.v=Math.max(safe,c.v-brake*dt*strength);}}}
  // Pit admission is intentionally not time-gated here. Real races can require a
  // lap-one stop after contact, a puncture, a mechanical problem or a sudden
  // weather mismatch. race-pit-strategy owns the cause-based admission decision.
  function update(dt){normaliseGridStart();launchDiscipline(dt);baseUpdate(dt);avoidHazards(dt);}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='spinControl')return{suppressed:0,mode:'incident-probability-controlled-at-source'};if(prop==='startControl')return{gridNormalised,raceStartAt,parallelLaunchEscapes};return Reflect.get(target,prop,target);}});
}