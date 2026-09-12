import {createRace as createV18Race} from './v18-race.js';
export function createRace(W,statusEl,settings={}){
 const R=createV18Race(W,statusEl,settings),baseUpdate=R.update,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const perf={formula:[88,8.8,20.5,.20,1.10,.97,800,1],hyper:[82,7.4,17.8,.055,1.04,.99,1030,.84],lmh:[81.5,7.3,17.6,.045,1.04,.99,1030,.835],proto:[80.5,7.15,17.3,.035,1.03,1,950,.82],gt:[73.5,6.15,15.7,-.085,.96,1.01,1300,.74],supercar:[75,6,15.1,-.105,1,.98,1450,.72],touring:[67.5,5.45,14.5,-.165,.91,1.02,1320,.67]};
 for(const c of R.cars){const p=perf[c.type]||perf.gt;c.classPerformance={top:p[0],accel:p[1],brake:p[2],corner:p[3],tyre:p[4],wet:p[5],mass:p[6],paceIndex:p[7]};c.massKg=p[6];c.paceIndex=p[7];}
 function tune(c){const p=perf[c.type]||perf.gt,m=c.machine||{},load=clamp(W.braking?.(c.s)||0,0,1),wet=W.env?.wetness||0,corner=clamp(1+p[3]*load,.72,1.24),wetScale=1-(1-p[5])*wet;c._v18BaseMax=p[0]*(m.power||1)*(.985+.015*(m.aero||1))*corner*wetScale;c._v18BaseAccel=p[1]*(m.power||1)*(1-load*.10*(c.type==='formula'?.35:1));c._v18BaseBrake=p[2]*(m.brake||1);}
 function update(dt){const wear=R.cars.map(c=>c.wear||0),fuel=R.cars.map(c=>c.fuel||0);for(const c of R.cars)tune(c);baseUpdate(dt);for(let i=0;i<R.cars.length;i++){const c=R.cars[i],p=perf[c.type]||perf.gt,dw=Math.max(0,(c.wear||0)-wear[i]);c.wear=clamp(wear[i]+dw*p[4],0,1);const df=Math.max(0,fuel[i]-(c.fuel||0)),ff=c.type==='formula'?1.08:(['hyper','lmh','proto'].includes(c.type)?1.03:.96);c.fuel=clamp(fuel[i]-df*ff,0,1);if(c.type!=='formula'){c.drsEligible=false;c.drsActive=false;if(c.radioWarnings)c.radioWarnings.drs=false;}}}
 return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='classPerformance')return perf;return Reflect.get(target,prop,target);}});
}
