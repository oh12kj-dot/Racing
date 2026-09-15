import {createRace as createV18Race} from './v18-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV18Race(W,statusEl,settings),baseUpdate=R.update,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),total=W.total,wrap=v=>((v%total)+total)%total;
  const perf={formula:[88,8.8,20.5,1.10,.97,800,1],hyper:[82,7.4,17.8,1.04,.99,1030,.84],lmh:[81.5,7.3,17.6,1.04,.99,1030,.835],proto:[80.5,7.15,17.3,1.03,1,950,.82],gt:[73.5,6.15,15.7,.96,1.01,1300,.74],supercar:[75,6,15.1,1,.98,1450,.72],touring:[67.5,5.45,14.5,.91,1.02,1320,.67]};
  for(const c of R.cars){const p=perf[c.type]||perf.gt;c.classPerformance={top:p[0],accel:p[1],brake:p[2],tyre:p[3],wet:p[4],mass:p[5],paceIndex:p[6]};c.massKg=p[5];c.paceIndex=p[6];}
  if(Array.isArray(R.qualifying)&&R.qualifying.length){for(const q of R.qualifying){const c=R.cars[q.carId],p=perf[c?.type]||perf.gt;q.time=q.time/p[6];}R.qualifying.sort((a,b)=>a.time-b.time);if(R.sessionPhase==='QUALIFYING')R.qualifying.forEach((q,pos)=>{const c=R.cars[q.carId],row=Math.floor(pos/2),col=pos%2;c._v8Progress=-row*12.4;c.s=wrap(-row*12.4);c.lap=row===0?0:-1;c.position=pos+1;c.prevPosition=pos+1;c.lane=(col?-1:1)*2.55+(row%2?.14:-.14);c.laneTarget=c.lane;c.v=0;const s=W.sample(c.s,c.lane);c.mesh.position.copy(s.p);c.mesh.position.y+=.12;c.mesh.rotation.y=Math.atan2(s.t.x,s.t.z);});}
  function tune(c){const p=perf[c.type]||perf.gt,m=c.machine||{},load=clamp(W.braking?.(c.s)||0,0,1),wet=W.env?.wetness||0,wetScale=1-(1-p[4])*wet;c._v18BaseMax=p[0]*(m.power||1)*(.985+.015*(m.aero||1))*wetScale;c._v18BaseAccel=p[1]*(m.power||1)*(1-load*.10*(c.type==='formula'?.35:1));c._v18BaseBrake=p[2]*(m.brake||1);}
  function update(dt){for(const c of R.cars)tune(c);baseUpdate(dt);}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='classPerformance')return perf;return Reflect.get(target,prop,target);}});
}
