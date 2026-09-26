import {createEnvironment as createV21Environment} from './v21-environment.js';

export function createEnvironment(W,R,settings={}){
  const E=createV21Environment(W,R,settings),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  let radarClock=0,radar={updatedAt:0,horizons:[],segments:[]};

  function globalAt(t){
    switch(settings.weather){
      case'SUNNY':return{weather:'SUNNY',rain:0,cloud:.12};
      case'CLOUDY':return{weather:'CLOUDY',rain:0,cloud:.70};
      case'LIGHT_RAIN':return{weather:'LIGHT RAIN',rain:.38,cloud:.90};
      case'RAIN':return{weather:'RAIN',rain:.82,cloud:1};
      default:{const p=((t%330)+330)%330;if(p<70)return{weather:'SUNNY',rain:0,cloud:.12};if(p<125)return{weather:'CLOUDY',rain:0,cloud:.62};if(p<190)return{weather:'LIGHT RAIN',rain:.38,cloud:.88};if(p<245)return{weather:'RAIN',rain:.82,cloud:1};if(p<290)return{weather:'DRYING',rain:.10,cloud:.58};return{weather:'SUNNY',rain:0,cloud:.18};}
    }
  }

  function localRain(frac,t){
    const g=globalAt(t).rain;if(g<=.001)return 0;
    if(settings.weather&&settings.weather!=='DYNAMIC')return g;
    const drift=t*.0018,ang=(frac-drift)*Math.PI*2;
    const cell=.58+.30*Math.cos(ang)+.18*Math.cos(ang*2+1.35)+.12*Math.sin(ang*3-.55);
    return clamp(g*clamp(cell,.18,1.22),0,1);
  }
  function rainAt(s,offsetSeconds=0){const frac=((Number(s)||0)/Math.max(1,W.total)%1+1)%1;return localRain(frac,R.race.t+offsetSeconds);}
  function buildRadar(){
    const horizons=[0,60,180,300,600],segments=24;
    const rows=horizons.map(sec=>({seconds:sec,global:globalAt(R.race.t+sec),values:Array.from({length:segments},(_,i)=>localRain(i/segments,R.race.t+sec))}));
    radar={updatedAt:R.race.t,horizons:rows,segments:rows[0]?.values||[]};
    W.env.radar=radar;W.env.rainAt=rainAt;
  }
  buildRadar();
  const baseUpdate=E.update;
  function update(dt){baseUpdate(dt);radarClock+=dt;if(radarClock>=.5){radarClock=0;buildRadar();}}
  return new Proxy(E,{get(target,prop){if(prop==='update')return update;if(prop==='radar')return radar;if(prop==='rainAt')return rainAt;return Reflect.get(target,prop,target);}});
}
