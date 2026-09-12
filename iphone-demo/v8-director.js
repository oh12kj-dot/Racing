export function createDirector(R){
  let focus=0,shot='TV',banner='',bannerTimer=0,lastEventId=null,manualHold=0;
  const priorities={RETIREMENT:110,INCIDENT:100,MECHANICAL:94,SAFETY_CAR:92,FINISH:90,YELLOW:82,OVERTAKE:78,PIT_STOP:64,FASTEST_LAP:58,PIT_EXIT:42,GREEN_FLAG:35};
  function label(e){
    if(!e)return'';const c=e.carId!==null?R.cars[e.carId]:null;
    switch(e.type){
      case'RETIREMENT':return `${c?.name||'CAR'} RETIRED`;
      case'MECHANICAL':return `${c?.name||'CAR'} ${e.data.fault}`;
      case'INCIDENT':return `${c?.name||'CAR'} INCIDENT`;
      case'SAFETY_CAR':return 'SAFETY CAR DEPLOYED';
      case'YELLOW':return 'YELLOW FLAG';
      case'GREEN_FLAG':return 'GREEN FLAG';
      case'OVERTAKE':return `${c?.name||'CAR'} OVERTAKE · P${e.data.to}`;
      case'FASTEST_LAP':return `${c?.name||'CAR'} FASTEST LAP`;
      case'PIT_STOP':return `${c?.name||'CAR'} PIT STOP`;
      case'PIT_EXIT':return `${c?.name||'CAR'} PIT EXIT · ${e.data.compound}`;
      case'FINISH':return `${c?.name||'CAR'} WINS`;
      default:return e.type?.replaceAll('_',' ')||'';
    }
  }
  function newestEvent(){
    let chosen=null;
    for(const e of R.events){
      if(e.id===lastEventId)chosen=null;
    }
    const unseen=lastEventId?R.events.slice(Math.max(0,R.events.findIndex(e=>e.id===lastEventId)+1)):R.events;
    for(const e of unseen){if(!chosen||(priorities[e.type]||0)>(priorities[chosen.type]||0))chosen=e;}
    if(R.events.length)lastEventId=R.events[R.events.length-1].id;
    return chosen;
  }
  function update(dt){
    if(bannerTimer>0)bannerTimer-=dt;if(manualHold>0)manualHold-=dt;
    if(R.sessionPhase==='QUALIFYING'){
      const q=R.qualifying?.[0],c=q?R.cars[q.carId]:null;if(c)focus=c.id;shot='TV';banner='QUALIFYING';bannerTimer=.3;return;
    }
    const e=newestEvent();
    if(e){
      const c=e.carId!==null?R.cars[e.carId]:null;if(c)focus=c.id;banner=label(e);bannerTimer=3;
      if(['RETIREMENT','MECHANICAL','INCIDENT'].includes(e.type))shot='HELI';
      else if(e.type==='OVERTAKE')shot='CHASE';
      else if(e.type==='PIT_STOP'||e.type==='PIT_EXIT')shot='TV';
      else if(e.type==='FASTEST_LAP'||e.type==='FINISH')shot='CHASE';
    }else if(manualHold<=0){
      const lead=R.getStandings()[0];if(lead)focus=lead.id;const phase=(R.race.t|0)%21;shot=phase<7?'TV':phase<14?'CHASE':'HELI';
    }
  }
  function userFocus(id){focus=id;manualHold=12;}
  return{update,userFocus,get focus(){return focus},get shot(){return shot},get banner(){return bannerTimer>0?banner:''}};
}
