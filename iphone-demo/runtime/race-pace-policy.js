import {createRace as createV24Race} from './v24-race.js';

export function createRace(W,statusEl,settings={}){
  const R=createV24Race(W,statusEl,settings),baseUpdate=R.update;
  const pace={formula:{cornerCoeff:.63,power:1,target:[91,98]},hyper:{cornerCoeff:.69,power:.995,target:[105,115]},lmh:{cornerCoeff:.69,power:.995,target:[105,115]},proto:{cornerCoeff:.71,power:.995,target:[103,114]},gt:{cornerCoeff:.77,power:.995,target:[118,128]},supercar:{cornerCoeff:.80,power:.99,target:[120,132]},touring:{cornerCoeff:.84,power:.985,target:[128,145]}};
  const scEnabled=settings.safetyCar!==false;let lastFlag=R.flag,lastSCAt=-999,scCount=0;
  for(const c of R.cars){c._v25BaseError=Number(c.driver?.errorRate||0);c._v25Pace=pace[c.type]||pace.gt;}
  function incidentRateScale(){if(!scEnabled)return 0;const wet=W.env?.wetness||0,rain=W.env?.rain||0;if(wet>.72||rain>.55)return .27;if(wet>.35||rain>.20)return .23;return .18;}
  function prepareIncidentRates(){const scale=incidentRateScale();for(const c of R.cars)if(c.driver)c.driver.errorRate=c._v25BaseError*scale;}
  function restoreIncidentRates(){for(const c of R.cars)if(c.driver)c.driver.errorRate=c._v25BaseError;}
  function updateSCState(){if(lastFlag!=='SC'&&R.flag==='SC'){lastSCAt=R.race.t;scCount++;R.events?.push({id:`pace-sc-${Date.now()}-${Math.random()}`,type:'SC_POLICY',t:R.race.t,carId:null,data:{count:scCount,cooldown:70}});}lastFlag=R.flag;}
  function update(dt){prepareIncidentRates();try{baseUpdate(dt);}finally{restoreIncidentRates();}updateSCState();}
  return new Proxy(R,{get(target,prop){if(prop==='update')return update;if(prop==='safetyCarPolicy')return{mode:scEnabled?'REALISTIC':'OFF',count:scCount,lastSCAt,cooldownRemaining:Math.max(0,70-(R.race.t-lastSCAt)),incidentScale:incidentRateScale()};if(prop==='paceTargets')return pace;return Reflect.get(target,prop,target);}});
}
