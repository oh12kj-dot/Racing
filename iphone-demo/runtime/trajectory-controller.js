const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrapAngle=a=>{const tau=Math.PI*2;return((a+Math.PI)%tau+tau)%tau-Math.PI;};

const classTune={
  formula:{latG:3.2,steer:.34,rate:2.30,wheelbase:3.6},
  hyper:{latG:2.55,steer:.38,rate:2.00,wheelbase:3.1},lmh:{latG:2.55,steer:.38,rate:2.00,wheelbase:3.1},proto:{latG:2.60,steer:.39,rate:2.00,wheelbase:3.0},
  gt:{latG:1.95,steer:.43,rate:1.75,wheelbase:2.85},supercar:{latG:1.80,steer:.45,rate:1.70,wheelbase:2.75},touring:{latG:1.70,steer:.46,rate:1.65,wheelbase:2.70}
};

export function createTrajectoryController(W,R,{mobile=false}={}){
  const states=new Map(),total=Math.max(1,Number(W.total)||1),metrics={updates:0,arbitrations:0,safetyVetoes:0,pitApproaches:0,mergeFrames:0,maxLaneAccel:0,maxYawError:0};
  const tuneFor=c=>classTune[c?.type]||classTune.gt;
  const lineAt=(c,s=c.s)=>clamp(Number(W.racingLineFor?.(s,c.racingLineMode||'OPTIMAL')??W.racingLineAt?.(s)??0)||0,-3.35,3.35);
  const progress=c=>Number(c?._v8Progress??((c?.lap||0)*total+(c?.s||0)))||0;
  const nearLongitudinal=(a,b)=>Math.abs(progress(a)-progress(b));
  const trackPose=(c,yawError=0)=>{
    if(!c?.mesh)return;const q=W.sample(c.s,c.lane);if(!q?.p||!q?.t)return;
    c.mesh.position.copy(q.p);c.mesh.position.y+=.12;
    const base=Math.atan2(q.t.x,q.t.z),slip=clamp(Number(c.slipAngle)||0,-.55,.55);c.mesh.rotation.y=base+yawError+slip*.35;
  };
  function stateFor(c){
    let s=states.get(c.id);if(!s){s={lane:Number(c.lane)||0,laneV:0,laneA:0,yawError:0,steer:0,steerRate:0,target:Number(c.laneTarget)||Number(c.lane)||0,source:'INIT'};states.set(c.id,s);}return s;
  }
  function capture(){
    const snap=new Map();for(const c of R.cars||[]){const s=stateFor(c);s.lane=Number.isFinite(Number(c.lane))?Number(c.lane):s.lane;snap.set(c.id,{lane:s.lane,laneV:s.laneV,s:c.s,pitState:c.pitState,phase:c._runtimePitPhase||'',spin:c.spinState||'NONE'});}return snap;
  }
  function legacyIntent(c){return clamp(Number.isFinite(Number(c.laneTarget))?Number(c.laneTarget):Number(c.lane)||0,-3.65,3.65);}
  function intent(c){
    const legacy=legacyIntent(c),ideal=lineAt(c),phase=String(c._runtimePitPhase||'');
    if(c.pitState==='ENTRY'&&!W.inPitWindow?.(c.s)){metrics.pitApproaches++;return{target:legacy,source:'PIT_APPROACH'};}
    if(phase==='MERGE'){metrics.mergeFrames++;return{target:ideal,source:'PIT_MERGE'};}
    if(c.hazardAvoiding)return{target:legacy,source:'HAZARD'};
    if((c.avoid||0)>.05)return{target:legacy,source:'COLLISION_AVOID'};
    if(c.blueFlag)return{target:legacy,source:'BLUE_FLAG'};
    if(c.battleState==='ATTACK'||c.racecraftState==='ATTACK'||c.racecraftState==='SWITCHBACK')return{target:legacy,source:'ATTACK'};
    if(c.battleState==='DEFEND'||c.racecraftState==='DEFEND')return{target:legacy,source:'DEFEND'};
    if(c.coolingMode)return{target:legacy,source:'COOLING'};
    return{target:ideal*.82+legacy*.18,source:'RACING_LINE'};
  }
  function safetyConstrain(c,target){
    let out=target;
    for(const o of R.cars||[]){
      if(o===c||o.retired||o.pitState!=='NONE'||c.pitState!=='NONE')continue;
      const longitudinal=nearLongitudinal(c,o),body=((c.length||5)+(o.length||5))*.5;if(longitudinal>body+8.5)continue;
      const safe=((c.width||2)+(o.width||2))*.5+.46,other=Number(o.lane)||0,current=(Number(c.lane)||0)-other,desired=out-other;
      const crosses=current===0||desired===0||Math.sign(current)!==Math.sign(desired),narrows=Math.abs(desired)<Math.abs(current);
      if((crosses||narrows)&&Math.abs(desired)<safe){const dir=current===0?(c.id<o.id?-1:1):Math.sign(current);out=clamp(other+dir*safe,-3.65,3.65);metrics.safetyVetoes++;}
    }
    return out;
  }
  function updateCar(c,dt){
    const st=stateFor(c),tune=tuneFor(c),phase=String(c._runtimePitPhase||'');
    if(c.retired||c.pitState==='STOP'||c._runtimePitQueued||c._runtimeReleaseWait){st.lane=Number(c.lane)||st.lane;st.laneV=0;st.laneA=0;st.yawError=0;st.steer=0;return;}
    if((c.pitState==='ENTRY'&&W.inPitWindow?.(c.s))||c.pitState==='EXIT'){
      st.lane=Number(c.lane)||st.lane;st.laneV=0;st.laneA=0;st.yawError=0;st.steer=0;return;
    }
    if(c.spinState==='SLIDE'){
      st.lane=Number(c.lane)||st.lane;st.laneV=clamp(st.laneV,-5,5);st.yawError=clamp(Number(c.slipAngle)||0,-.65,.65);trackPose(c,st.yawError);return;
    }
    const request=intent(c);let target=safetyConstrain(c,request.target);st.target=target;st.source=request.source;metrics.arbitrations++;
    const v=Math.max(1,Number(c.v)||0),skill=clamp(Number(c.driver?.racecraft)||.84,.65,1),cons=clamp(Number(c.driverProfile?.consistency)||1,.90,1.08),aggr=clamp(Number(c.driver?.aggression)||.6,.35,.97);
    const lookAhead=clamp(5+v*.34,7,31),error=target-st.lane,desiredYaw=clamp(Math.atan2(error,lookAhead),-.36,.36);
    const maxLatA=tune.latG*9.81*clamp(.68+.32*skill,.72,1)*clamp(.92+(cons-1)*.7,.86,1.05),response=clamp(2.15+skill*1.75+aggr*.45,2.6,4.45);
    const maxLaneV=clamp(2.0+v*.035,2.2,4.8),desiredLaneV=clamp(Math.tan(desiredYaw)*v,-maxLaneV,maxLaneV);
    const wantedA=clamp(error*response+(desiredLaneV-st.laneV)*(2.3+skill),-maxLatA,maxLatA),jerkLimit=maxLatA*(mobile?3.0:3.8),deltaA=clamp(wantedA-st.laneA,-jerkLimit*dt,jerkLimit*dt);st.laneA+=deltaA;
    st.laneV=clamp(st.laneV+st.laneA*dt,-maxLaneV,maxLaneV);
    if(Math.abs(error)<.035&&Math.abs(st.laneV)<.25){st.lane=target;st.laneV*=.5;}else st.lane+=st.laneV*dt;
    st.lane=clamp(st.lane,-3.72,3.72);if(st.lane===-3.72||st.lane===3.72)st.laneV*=.35;
    const yawFromMotion=Math.asin(clamp(st.laneV/v,-.48,.48)),wheelbase=tune.wheelbase,maxSteer=tune.steer*clamp(1.12-v/130,.52,1),desiredSteer=clamp(Math.atan2(wheelbase*Math.tan(yawFromMotion),Math.max(2,v*.10)),-maxSteer,maxSteer),maxStep=tune.rate*dt;
    const oldSteer=st.steer;st.steer+=clamp(desiredSteer-st.steer,-maxStep,maxStep);st.steerRate=(st.steer-oldSteer)/Math.max(.001,dt);st.yawError=wrapAngle(yawFromMotion);
    c.lane=st.lane;c.laneTarget=target;c.steeringAngle=st.steer;c.steeringRate=st.steerRate;c.lateralVelocity=st.laneV;c.lateralAcceleration=st.laneA;c.yawError=st.yawError;c.trajectorySource=request.source;c.trajectoryTarget=target;
    trackPose(c,st.yawError);metrics.maxLaneAccel=Math.max(metrics.maxLaneAccel,Math.abs(st.laneA));metrics.maxYawError=Math.max(metrics.maxYawError,Math.abs(st.yawError));
  }
  function update(dt){const step=clamp(Number(dt)||.016,.001,.05);for(const c of R.cars||[])updateCar(c,step);metrics.updates++;}
  function diagnostics(){return{owner:'runtime-trajectory-controller-v1',...metrics,cars:[...states.entries()].map(([id,s])=>({id,lane:s.lane,laneV:s.laneV,laneA:s.laneA,yawError:s.yawError,steer:s.steer,target:s.target,source:s.source}))};}
  return{capture,update,diagnostics};
}
