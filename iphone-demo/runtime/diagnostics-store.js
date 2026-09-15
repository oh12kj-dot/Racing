import {LOG_POLICY} from './config.js';

const KEY='racing_diagnostics_v1';
const now=()=>Date.now();

function safeParse(raw){try{return JSON.parse(raw||'[]');}catch{return[];}}
function loadAll(){
  try{
    const a=safeParse(localStorage.getItem(KEY));
    if(!Array.isArray(a))return[];
    const cutoff=now()-LOG_POLICY.persistedDays*86400000;
    return a.filter(x=>x&&Number(x.savedAt)>=cutoff).slice(-LOG_POLICY.persistedGenerations);
  }catch{return[];}
}
function compactCar(c={}){return{id:c.id,speed:c.speed,raw:c.raw,target:c.target,accel:c.accel,jerk:c.jerk,throttle:c.throttle,brake:c.brake,mode:c.mode,line:c.line,lineDeviation:c.lineDeviation,latUse:c.latUse,pit:c.pit,spin:c.spin,damage:c.damage};}
function compactDynamics(a=[]){
  if(!Array.isArray(a)||!a.length)return[];
  const max=Math.max(1,LOG_POLICY.dynamicsPersistSamples||120),stride=Math.max(1,Math.ceil(a.length/max)),out=[];
  for(let i=Math.max(0,a.length-max*stride);i<a.length;i+=stride){const x=a[i];out.push({t:x?.t,cars:(x?.cars||[]).map(compactCar)});}
  const last=a[a.length-1];if(last&&out[out.length-1]?.t!==last.t)out.push({t:last.t,cars:(last.cars||[]).map(compactCar)});
  return out.slice(-max);
}
function compact(payload){
  return{
    version:payload.version,
    generation:payload.generation,
    savedAt:now(),capturedAt:payload.capturedAt,
    device:payload.device,quality:payload.quality,circuitAudit:payload.circuitAudit,
    latest:payload.latest,samples:(payload.samples||[]).slice(-LOG_POLICY.diagnosticSamples),
    camera:payload.camera,audio:payload.audio,
    audioTrace:(payload.audioTrace||[]).slice(-LOG_POLICY.audioTrace),
    events:(payload.events||[]).slice(-60),radio:(payload.radio||[]).slice(-40),
    dynamics:compactDynamics(payload.dynamics),pit:payload.pit,
    retention:payload.retention
  };
}
function fit(list){
  let out=list.slice(-LOG_POLICY.persistedGenerations);
  let text=JSON.stringify(out);
  while(text.length>LOG_POLICY.maxStoredChars&&out.length>1){out.shift();text=JSON.stringify(out);}
  if(text.length>LOG_POLICY.maxStoredChars&&out.length===1){
    const x=out[0];
    while(text.length>LOG_POLICY.maxStoredChars&&x.dynamics?.length>12){x.dynamics=x.dynamics.filter((_,i)=>i%2===0);text=JSON.stringify(out);}
    while(text.length>LOG_POLICY.maxStoredChars&&x.samples?.length>10){x.samples=x.samples.filter((_,i)=>i%2===0);text=JSON.stringify(out);}
  }
  return{text,out};
}
export function persistGeneration(payload){
  try{
    const item=compact(payload),all=loadAll(),id=item.generation?.id;
    const filtered=all.filter(x=>x.generation?.id!==id);filtered.push(item);
    const {text,out}=fit(filtered);localStorage.setItem(KEY,text);return out;
  }catch{return[];}
}
export function getPersistedGenerations(){return loadAll();}
export function clearPersistedGenerations(){try{localStorage.removeItem(KEY);}catch{}return true;}
export function diagnosticsStorageInfo(){const a=loadAll();let chars=0;try{chars=(localStorage.getItem(KEY)||'').length;}catch{}return{key:KEY,generations:a.length,maxGenerations:LOG_POLICY.persistedGenerations,maxAgeDays:LOG_POLICY.persistedDays,chars,maxChars:LOG_POLICY.maxStoredChars};}
