import {createRace as createV27Race} from './v27-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV27Race(W,statusEl,settings),baseUpdate=R.update,total=W.total;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%total)+total)%total;
  let gridNormalised=false,raceStartAt=null;
  const lastKeptSpin=new Map(),suppressedSpins=[];

  function progress(c){return c?._v8Progress??((c?.lap||0)*total+(c?.s||0));}
  function gap(a,b){return wrap((b?.s||0)-(a?.s||0));}
  function pose(c){const q=W.sample(c.s,c.lane);c.mesh.position.copy(q.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(q.t.x,q.t.z);}

  function normaliseGridStart(){
    if(gridNormalised)return;
    const phase=R.sessionPhase;
    if(phase==='QUALIFYING'||phase==='FORMATION')return;
    const grid=Array.isArray(R.qualifying)&&R.qualifying.length?R.qualifying.map(x=>x.carId):R.getStandings().map(c=>c.id);
    grid.forEach((id,pos)=>{
      const c=R.cars[id];if(!c)return;
      const row=Math.floor(pos/2),col=pos%2,p=-row*12.4;
      c._v8Progress=p;c.s=wrap(p);c.lap=row===0?0:-1;c.position=pos+1;c.prevPosition=pos+1;c.v=0;
      c.lane=(col?-1:1)*2.55+(row%2?.14:-.14);c.laneTarget=c.lane;
      c.pitState='NONE';c.pitTimer=0;c.pitLaneStatus='TRACK';c._serviceExtra=false;c._repairAdded=false;c._pitFailure=null;c._v24PitFailure=null;c._doubleStackWait=0;
      c.lastLapStart=R.race.t;c.sectorStart=R.race.t;pose(c);
    });
    gridNormalised=true;
  }

  function nearestAhead(c){let car=null,dist=Infinity;for(const o of R.cars){if(o===c||o.retired||o.pitState!=='NONE')continue;const d=gap(c,o);if(d>0&&d<dist){dist=d;car=o;}}return{car,dist};}

  function launchDiscipline(dt){
    const phase=R.sessionPhase;if(phase==='QUALIFYING'||phase==='FORMATION'||R.flag!=='GREEN')return;
    if(R.race.t<(R.race.green||0))return;
    if(raceStartAt===null)raceStartAt=R.race.t;
    const age=R.race.t-raceStartAt;if(age>14)return;
    for(const c of R.cars){
      if(c.retired||c.pitState!=='NONE')continue;
      const a=nearestAhead(c);if(!a.car)continue;const f=a.car;
      const body=((c.length||5)+(f.length||5))*.5,lat=Math.abs((c.lane||0)-(f.lane||0));
      const sameChannel=lat<((c.width||2)+(f.width||2))*.62;
      if(sameChannel&&a.dist<body+7.5){
        const room=clamp((a.dist-body)/7.5,0,1),cap=f.v+.35+room*1.25;
        c.v=Math.min(c.v,cap);c.overtake=Math.min(c.overtake||0,.22);c.avoid=Math.max(c.avoid||0,.8);
      }
      if(a.dist<34){
        const hold=clamp(.30-age*.012,.14,.30);c.laneTarget+=(c.lane-c.laneTarget)*hold;
      }
      // Leave room when the launch forms two abreast. Three-wide attempts are delayed
      // until the field has opened up, rather than forbidden completely.
      for(const o of R.cars){
        if(o===c||o.retired||o.pitState!=='NONE')continue;
        const longitudinal=Math.abs(progress(c)-progress(o));if(longitudinal>((c.length||5)+(o.length||5))*.55+1.2)continue;
        const lateral=(c.lane||0)-(o.lane||0),need=((c.width||2)+(o.width||2))*.53+.28;
        if(Math.abs(lateral)<need){const dir=lateral===0?(c.id%2?1:-1):Math.sign(lateral);c.laneTarget=clamp(c.laneTarget+dir*(need-Math.abs(lateral))*.22,-3.72,3.72);}
      }
    }
  }

  function isHazard(c){return !!c&&!c.recovered&&c.pitState==='NONE'&&(c.retired||c.spinState==='SLIDE'||c.spinState==='RECOVER'||(c.incident||0)>.15||((c.v||0)<7&&R.race.t>(R.race.green||0)+2));}
  function laneScore(me,target,hazard){
    let score=3.8-Math.abs(target)*.18;
    for(const o of R.cars){if(o===me||o===hazard||o.retired||o.pitState!=='NONE')continue;const d=gap(me,o);if(d>55)continue;const safe=((me.width||2)+(o.width||2))*.56+.45,lat=Math.abs((o.lane||0)-target);if(lat<safe)score-=7*(1-d/55);else score+=Math.min(2,lat-safe)*.18;}
    return score;
  }
  function avoidHazards(dt){
    if(R.sessionPhase==='QUALIFYING'||R.sessionPhase==='FORMATION')return;
    for(const c of R.cars){
      if(c.retired||c.pitState!=='NONE'||isHazard(c))continue;
      let h=null,d=Infinity;for(const o of R.cars){if(o===c||!isHazard(o))continue;const x=gap(c,o);if(x>0&&x<d&&x<78){d=x;h=o;}}
      c.hazardAvoiding=false;if(!h)continue;
      const clearance=((c.width||2)+(h.width||2))*.5+1.25;
      const opts=[clamp((h.lane||0)-clearance,-3.55,3.55),clamp((h.lane||0)+clearance,-3.55,3.55)];
      opts.sort((a,b)=>laneScore(c,b,h)-laneScore(c,a,h));const target=opts[0],score=laneScore(c,target,h);
      c.hazardAvoiding=true;c.avoid=Math.max(c.avoid||0,1.8);c.overtake=Math.max(c.overtake||0,1.2);
      if(score>0){const urgency=clamp((65-d)/55,0,.88);c.laneTarget=c.laneTarget+(target-c.laneTarget)*(.12+urgency*.28);}
      const lateralClear=Math.abs((c.lane||0)-(h.lane||0))>clearance*.78;
      if(d<30&&!lateralClear){const safe=Math.max(5,(h.v||0)+Math.max(0,(d-8)*.22));c.v=Math.min(c.v,safe);}
      if(d<15&&!lateralClear)c.v=Math.max(0,c.v-(c.brakeNominal||c.brake||15)*dt*.85);
    }
  }

  function suppressExcessSpins(beforeEventIds,beforeState){
    const events=R.events||[],now=R.race.t,newSpins=events.filter(e=>e?.type==='SPIN'&&!beforeEventIds.has(e.id));
    for(const e of newSpins){
      const c=R.cars[e.carId];if(!c)continue;
      const wet=W.env?.wetness||0,wear=c.wear||0,startAge=raceStartAt==null?999:now-raceStartAt,last=lastKeptSpin.get(c.id)??-999;
      let keep=startAge<18?.06:.20;
      if(wet>.25)keep+=.10;if(wet>.55)keep+=.18;if(c.hydroplaning)keep=.78;
      if(wear>.65)keep+=.10;if(wear>.82)keep+=.10;
      if(c.tyreCondition==='BLISTERING'||c.tyreCondition==='GRAINING')keep+=.07;
      if((c.aeroRear??1)<(c.aeroFront??1)-.16)keep+=.16;
      if(now-last<45)keep=Math.min(keep,.04);
      keep=clamp(keep,.03,.82);
      if(Math.random()<keep){lastKeptSpin.set(c.id,now);continue;}
      const b=beforeState.get(c.id);
      c.spinState='RECOVER';c.spinTimer=.26;c.spinSeverity=Math.min(c.spinSeverity||0,.22);c.slipAngle=0;c.counterSteer=0;c.laneTarget=clamp((b?.laneTarget??c.laneTarget)*.75,-3.5,3.5);
      const ix=events.findIndex(x=>x===e||x.id===e.id);if(ix>=0)events.splice(ix,1);
      const radio=R.radio;if(Array.isArray(radio))for(let i=radio.length-1;i>=0;i--){const m=radio[i];if(m.carId===c.id&&m.kind==='DRIVER'&&Math.abs((m.t??0)-now)<.15&&String(m.text||'').toLowerCase().includes('lost the rear'))radio.splice(i,1);}
      suppressedSpins.push({carId:c.id,t:now});while(suppressedSpins.length>30)suppressedSpins.shift();
    }
  }

  function update(dt){
    normaliseGridStart();
    launchDiscipline(dt);avoidHazards(dt);
    const beforeEventIds=new Set((R.events||[]).map(e=>e.id));
    const beforeState=new Map(R.cars.map(c=>[c.id,{laneTarget:c.laneTarget,spinState:c.spinState}]));
    baseUpdate(dt);
    suppressExcessSpins(beforeEventIds,beforeState);
    // A newly spinning car is known only after the base physics step. Give the field
    // an immediate first avoidance command rather than waiting a full visual frame.
    avoidHazards(dt);
    // No pit starts are currently modelled as a sporting penalty. During the launch,
    // only a genuine post-green failure/puncture may send a car to pit entry.
    if(raceStartAt!==null&&R.race.t-raceStartAt<10){for(const c of R.cars){if(c.pitState==='ENTRY'&&!c.fault&&!(c.wheelState||[]).some(w=>w.puncture)){c.pitState='NONE';c.pitTimer=0;c.pitLaneStatus='TRACK';}}}
  }

  return new Proxy(R,{get(target,prop){
    if(prop==='update')return update;
    if(prop==='spinControl')return{suppressed:suppressedSpins.length,last:[...suppressedSpins]};
    if(prop==='startControl')return{gridNormalised,raceStartAt};
    return Reflect.get(target,prop,target);
  }});
}
