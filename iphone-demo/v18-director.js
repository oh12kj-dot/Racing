import {createDirector as createBaseDirector} from './v8-director-final.js';

export function createDirector(R){
  const base=createBaseDirector(R);let focus=0,shot='TV',pipFocus=null,pipActive=false,userHold=0,spinHold=0;const seen=new Set();
  function progress(c){return c._v8Progress??((c.lap||0)*1e6+c.s);}
  function battles(){const st=R.getStandings(),out=[];for(let i=1;i<st.length;i++){const a=st[i-1],b=st[i];if(a.retired||b.retired||a.pitState!=='NONE'||b.pitState!=='NONE')continue;const d=Math.max(0,progress(a)-progress(b)),gap=d/Math.max(8,b.v),lat=Math.abs((a.lane||0)-(b.lane||0)),score=Math.max(0,3.2-gap)*2.2+(d<16?2.2:0)+(lat>1.3&&d<12?2.5:0)+(b.battleState==='ATTACK'?1.6:0)+(a.battleState==='DEFEND'?1.2:0);if(score>1.4)out.push({a,b,d,gap,score});}return out.sort((x,y)=>y.score-x.score);}
  function spinEvent(){let picked=null;for(const e of R.events){if(seen.has(e.id))continue;seen.add(e.id);if(e.type==='SPIN'||e.type==='LOCKUP')picked=e;}if(seen.size>260){const keep=new Set(R.events.map(e=>e.id));for(const id of [...seen])if(!keep.has(id))seen.delete(id);}return picked;}
  function update(dt){base.update(dt);if(userHold>0)userHold-=dt;if(spinHold>0)spinHold-=dt;focus=base.focus;shot=base.shot;pipActive=false;pipFocus=null;const se=spinEvent();if(se?.carId!=null){focus=se.carId;shot=se.type==='SPIN'?'HELI':'CHASE';spinHold=2.8;}if(userHold>0||R.sessionPhase==='QUALIFYING'||base.banner)return;const bs=battles();if(spinHold<=0&&bs[0]){focus=bs[0].b.id;shot=bs[0].d<10?'CHASE':'TV';}const secondary=bs.find((x,i)=>i>0&&x.a.id!==focus&&x.b.id!==focus&&x.score>2.6);if(secondary){pipFocus=secondary.b.id;pipActive=true;}}
  function userFocus(id){userHold=12;base.userFocus(id);focus=id;pipActive=false;}
  return{update,userFocus,get focus(){return focus},get shot(){return shot},get banner(){return base.banner},get pipFocus(){return pipFocus},get pipActive(){return pipActive},get battles(){return battles().slice(0,4).map(x=>({lead:x.a.id,chaser:x.b.id,gap:x.gap,distance:x.d,score:x.score}))}};
}
