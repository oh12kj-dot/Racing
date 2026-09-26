import {createRace as createV12Race} from './v12-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV12Race(W,statusEl,settings),baseUpdate=R.update,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const frameRateAlpha=(per60,dt)=>{const a=clamp(Number(per60)||0,0,.999),frames=Math.max(0,Number(dt)||0)*60;return 1-Math.pow(1-a,frames);};
  W.setupGridTheatre?.(R.cars);W.pitCars=R.cars;
  for(const c of R.cars){c.hybridCharge=Number.isFinite(c.hybridCharge)?c.hybridCharge:1;c.flatSpot=!!c.flatSpot;c.damageState='OK';c._strategyWearRate=.085;}
  function strategy(c){const lapsLeft=Math.max(0,R.race.lapsTarget-Math.max(0,c.lap||0)),wearRate=Math.max(.035,c._strategyWearRate||.08),life=Math.max(0,(.84-(c.wear||0))/wearRate),wet=W.env?.wetness||0,need=life<lapsLeft*.82||(wet>.42&&!['WET','INTERMEDIATE'].includes(c.compound))||(wet<.18&&['WET','INTERMEDIATE'].includes(c.compound)),st=R.getStandings(),idx=st.indexOf(c),ahead=idx>0?st[idx-1]:null,behind=idx>=0&&idx<st.length-1?st[idx+1]:null,gapA=ahead?Math.max(0,((ahead._v8Progress??0)-(c._v8Progress??0))/Math.max(1,c.v)):99,gapB=behind?Math.max(0,((c._v8Progress??0)-(behind._v8Progress??0))/Math.max(1,c.v)):99;return{lapsLeft,tyreLifeLaps:life,window:need?'BOX NOW':life<lapsLeft*1.25?'WINDOW OPEN':'STAY OUT',undercut:gapA<3.5&&life<lapsLeft*1.4?'STRONG':'LOW',overcut:gapB<2.5&&c.driver?.tireCare>.84?'POSSIBLE':'LOW',fuel:c.fuel??1,fuelKg:c.fuelKg??null,charge:c.hybridCharge??1,compound:c.compound};}
  function updateDamage(c){const d=c.damage||0;c.damageState=d>.68?'HEAVY':d>.34?'MODERATE':d>.10?'LIGHT':'OK';W.updateCarDamage?.(c);}
  function tyre(c,dt){const old=c._pitCompatWearPrev??c.wear??0,delta=Math.max(0,(c.wear||0)-old),sampleRate=delta/Math.max(dt,.001)*80,alpha=frameRateAlpha(.015,dt);c._pitCompatWearPrev=c.wear;c._strategyWearRate+=(sampleRate-c._strategyWearRate)*alpha;if(c.pitState==='STOP'&&(c.wear||0)<.08)c.flatSpot=false;W.updateTyreVisual?.(c);}
  function update(dt){baseUpdate(dt);for(const c of R.cars){if(c.retired)continue;updateDamage(c);tyre(c,dt);}W.updateGridTheatre?.(R.cars,R.sessionPhase,R.race.t,R.race.green);W.updateRecoveries?.(dt);}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='pitStrategy')return R.cars.map(c=>({carId:c.id,...strategy(c)}));if(prop==='strategyFor')return c=>strategy(typeof c==='object'?c:R.cars[Number(c)]);if(prop==='pitServiceCompatibility')return{owner:'runtime-pit-state-and-strategy-authority',mutatesTimer:false,mutatesFuel:false,mutatesDamage:false};return Reflect.get(target,prop,target);}});
}
