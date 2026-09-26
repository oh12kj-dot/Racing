export function createRuntimeRegression(W,R){
  const failures=[],counts=new Map();let acc=0,last={ok:true,checks:0,failures:[]};
  const finite=n=>Number.isFinite(Number(n));
  const push=(code,data={})=>{counts.set(code,(counts.get(code)||0)+1);failures.push({t:R.race?.t||0,code,...data});while(failures.length>80)failures.shift();};

  function run(){
    const current=[];let checks=0;
    const fail=(code,data={})=>{current.push({code,...data});push(code,data);};
    const serviceTeams=new Map();
    for(const c of R.cars){
      checks+=4;
      if(!finite(c.s)||!finite(c.v)||!finite(c.lane))fail('NON_FINITE_CAR_STATE',{id:c.id,s:c.s,v:c.v,lane:c.lane});
      if(c.pitState==='STOP'){
        const bs=W.pitBoxS?.(c.teamId),total=W.total||1,d=finite(bs)?Math.min(Math.abs(c.s-bs),total-Math.abs(c.s-bs)):Infinity;
        if(d>.45)fail('PIT_STOP_OFF_BOX',{id:c.id,team:c.teamId,d});
        if(Math.abs(c.v||0)>.01)fail('PIT_STOP_MOVING',{id:c.id,v:c.v});
        const team=c.teamId??0;if(serviceTeams.has(team))fail('DOUBLE_SERVICE_SAME_TEAM',{team,a:serviceTeams.get(team),b:c.id});else serviceTeams.set(team,c.id);
      }
      if(c._runtimePitQueued&&c.pitState!=='ENTRY')fail('QUEUE_STATE_MISMATCH',{id:c.id,state:c.pitState});
      if(c.pitState==='NONE'&&!c.retired&&W.barrierContact?.(c))fail('BARRIER_RESIDUAL_OVERLAP',{id:c.id,state:c.spinState||'NONE'});
    }
    checks++;
    const pit=R.pitStateDiagnostics;if(pit?.cars?.some(x=>x.queued&&x.state!=='ENTRY'))fail('PIT_DIAGNOSTIC_QUEUE_MISMATCH');
    last={ok:current.length===0,checks,failures:current,t:R.race?.t||0,totalFailures:failures.length,counts:Object.fromEntries(counts)};
    try{window.__RACING_REGRESSION__=last;}catch{}
    return last;
  }
  function update(dt){acc+=dt;if(acc>=1){acc%=1;run();}}
  function diagnostics(){return{...last,recent:failures.slice(-30)};}
  return{update,run,diagnostics,get ok(){return last.ok},get failures(){return failures.slice()},get last(){return last}};
}
